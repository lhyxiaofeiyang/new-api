package observability

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

// 维度定义：keySelect/labelSelect 只使用 SQL 通用表达式，三库行为一致。
// join 只在 label 需要当前名时使用（见 token 维度），派生表口径与 query.go 一致。
type dimensionSpec struct {
	name        string
	keySelect   string
	groupBy     string
	join        string
	labelSelect string
}

var dimensionSpecs = map[string]dimensionSpec{
	"token": {
		name:      "token",
		keySelect: "CAST(logs.token_id AS CHAR)",
		groupBy:   "logs.token_id",
		join:      tokensJoin,
		// 名字取 tokens 表的当前名：改名后同一 token_id 会留下多批历史名，
		// 与仪表盘 Top 排行保持同一口径。名称为空（含空串）或缺行时回退历史名，
		// 两者都拿不到才退回空串，避免显示成空白。
		labelSelect: "COALESCE(NULLIF(MAX(tk.name), ''), MAX(logs.token_name), '')",
	},
	"channel": {
		name:        "channel",
		keySelect:   "CAST(logs.channel_id AS CHAR)",
		groupBy:     "logs.channel_id",
		labelSelect: "MAX(COALESCE(channels.name, ''))",
	},
	"channel_type": {
		name:        "channel_type",
		keySelect:   "CAST(COALESCE(channels.type, 0) AS CHAR)",
		groupBy:     "channels.type",
		labelSelect: "CAST(COALESCE(channels.type, 0) AS CHAR)",
	},
	"model": {
		name:        "model",
		keySelect:   "logs.model_name",
		groupBy:     "logs.model_name",
		labelSelect: "logs.model_name",
	},
	"group": {
		name:        "group",
		keySelect:   "logs." + logGroupColumn(),
		groupBy:     "logs." + logGroupColumn(),
		labelSelect: "logs." + logGroupColumn(),
	},
}

// matrixSpecs 是热力矩阵的组合：X 为令牌/渠道/渠道类型，Y 固定为模型。
var matrixSpecs = map[string]struct {
	x dimensionSpec
	y dimensionSpec
}{
	"token_model":        {x: dimensionSpecs["token"], y: dimensionSpecs["model"]},
	"channel_model":      {x: dimensionSpecs["channel"], y: dimensionSpecs["model"]},
	"channel_type_model": {x: dimensionSpecs["channel_type"], y: dimensionSpecs["model"]},
}

type usageAggregateRow struct {
	Key              string `gorm:"column:key"`
	Label            string `gorm:"column:label"`
	Calls            int64  `gorm:"column:calls"`
	SuccessCalls     int64  `gorm:"column:success_calls"`
	PromptTokens     int64  `gorm:"column:prompt_tokens"`
	CompletionTokens int64  `gorm:"column:completion_tokens"`
	Quota            int64  `gorm:"column:quota"`
	LatencySum       int64  `gorm:"column:latency_sum"`
	LatencyCount     int64  `gorm:"column:latency_count"`
}

type usageOtherRow struct {
	Key   string `gorm:"column:key"`
	Other string `gorm:"column:other"`
}

type usageDetailRow struct {
	CreatedAt        int64 `gorm:"column:created_at"`
	PromptTokens     int64 `gorm:"column:prompt_tokens"`
	CompletionTokens int64 `gorm:"column:completion_tokens"`
	Quota            int64 `gorm:"column:quota"`
}

type usageMatrixRow struct {
	XKey        string `gorm:"column:x_key"`
	YKey        string `gorm:"column:y_key"`
	Calls       int64  `gorm:"column:calls"`
	TotalTokens int64  `gorm:"column:total_tokens"`
	Quota       int64  `gorm:"column:quota"`
}

type usageTotalsRow struct {
	Calls        int64 `gorm:"column:calls"`
	TotalTokens  int64 `gorm:"column:total_tokens"`
	Quota        int64 `gorm:"column:quota"`
	LatencySum   int64 `gorm:"column:latency_sum"`
	LatencyCount int64 `gorm:"column:latency_count"`
}

type averageAccumulator struct {
	sum   int64
	count int64
}

func (a averageAccumulator) average() float64 {
	return averageMs(a.sum, a.count)
}

// GetUsage 返回用量分析的多维聚合、趋势与可选热力矩阵。
func GetUsage(rangeName string, startRaw, endRaw int64, dimension, matrix, granularity string, limit int, now time.Time) (*Usage, error) {
	r, err := resolveRange(rangeName, startRaw, endRaw, Range7d, now)
	if err != nil {
		return nil, err
	}
	spec, ok := dimensionSpecs[dimension]
	if !ok {
		return nil, fmt.Errorf("不支持的 dimension: %s", dimension)
	}
	if limit <= 0 || limit > maxPageSize {
		limit = 50
	}
	out := &Usage{Rows: []UsageRow{}, Trend: []UsageTrendPoint{}}

	var totals usageTotalsRow
	err = consumeQuery(r, Filters{}).
		Select(`COUNT(*) AS calls,
			COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens,
			COALESCE(SUM(logs.quota), 0) AS quota,
			COALESCE(SUM(logs.use_time), 0) AS latency_sum,
			COALESCE(SUM(CASE WHEN logs.use_time > 0 THEN 1 ELSE 0 END), 0) AS latency_count`).
		Scan(&totals).Error
	if err != nil {
		common.SysError("observability: 汇总用量失败: " + err.Error())
		return nil, err
	}
	out.Totals = UsageTotals{
		Calls:       totals.Calls,
		TotalTokens: totals.TotalTokens,
		Quota:       totals.Quota,
		CostUsd:     quotaToUsd(totals.Quota),
	}
	out.DataSource = DataSource{
		ErrorLogEnabled: constant.ErrorLogEnabled,
		FailureSource:   failureSource(),
		LogRows:         totals.Calls,
	}

	aggregates := []usageAggregateRow{}
	query := consumeQuery(r, Filters{})
	if spec.join != "" {
		query = query.Joins(spec.join)
	}
	err = query.
		Select(fmt.Sprintf(`%s AS %s, %s AS label,
			COUNT(*) AS calls,
			COALESCE(SUM(CASE WHEN logs.use_time > 0 THEN 1 ELSE 0 END), 0) AS success_calls,
			COALESCE(SUM(logs.prompt_tokens), 0) AS prompt_tokens,
			COALESCE(SUM(logs.completion_tokens), 0) AS completion_tokens,
			COALESCE(SUM(logs.quota), 0) AS quota,
			COALESCE(SUM(logs.use_time), 0) AS latency_sum,
			COALESCE(SUM(CASE WHEN logs.use_time > 0 THEN 1 ELSE 0 END), 0) AS latency_count`,
			spec.keySelect, dimensionKeyAlias(), spec.labelSelect)).
		Group(spec.groupBy).
		Order("calls DESC").
		Limit(limit).
		Scan(&aggregates).Error
	if err != nil {
		common.SysError("observability: 维度聚合失败: " + err.Error())
		return nil, err
	}
	cachedByKey, ttftByKey := aggregatingOtherByDimension(r, spec)
	out.Rows = buildUsageRows(aggregates, spec, cachedByKey, ttftByKey, failureCountsByDimension(r, spec), totals.TotalTokens)

	detailRows := []usageDetailRow{}
	err = consumeQuery(r, Filters{}).
		Select("logs.created_at AS created_at, logs.prompt_tokens AS prompt_tokens, logs.completion_tokens AS completion_tokens, logs.quota AS quota").
		Scan(&detailRows).Error
	if err != nil {
		common.SysError("observability: 读取用量明细失败: " + err.Error())
		return nil, err
	}
	out.Trend = buildUsageTrend(detailRows, r, granularity)

	if matrix != "" {
		pair, ok := matrixSpecs[matrix]
		if !ok {
			return nil, fmt.Errorf("不支持的 matrix: %s", matrix)
		}
		out.Matrix, err = getUsageMatrix(r, matrix, pair.x, pair.y, limit)
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func buildUsageRows(aggregates []usageAggregateRow, spec dimensionSpec,
	cachedByKey map[string]int64, ttftByKey map[string]averageAccumulator, failureByKey map[string]int64,
	totalTokens int64) []UsageRow {
	rows := make([]UsageRow, 0, len(aggregates))
	for _, aggregate := range aggregates {
		rowTokens := aggregate.PromptTokens + aggregate.CompletionTokens
		successCalls := aggregate.SuccessCalls
		failureCalls := max(aggregate.Calls-successCalls, 0)
		if constant.ErrorLogEnabled {
			// 错误日志开启时，失败事件数来自错误日志，成功率与失败数口径一致。
			failureCalls = failureByKey[aggregate.Key]
			successCalls = max(aggregate.Calls-failureCalls, 0)
		}
		label := aggregate.Label
		if spec.name == "channel_type" {
			if channelType, ok := numericToInt64(aggregate.Key); ok {
				label = constant.GetChannelTypeName(int(channelType))
			}
		}
		rows = append(rows, UsageRow{
			Key:              aggregate.Key,
			Label:            label,
			Calls:            aggregate.Calls,
			SuccessCalls:     successCalls,
			FailureCalls:     failureCalls,
			PromptTokens:     aggregate.PromptTokens,
			CompletionTokens: aggregate.CompletionTokens,
			CachedTokens:     cachedByKey[aggregate.Key],
			TotalTokens:      rowTokens,
			Quota:            aggregate.Quota,
			CostUsd:          quotaToUsd(aggregate.Quota),
			AverageLatencyMs: averageMs(aggregate.LatencySum*1000, aggregate.LatencyCount),
			AverageTtftMs:    ttftByKey[aggregate.Key].average(),
			Share:            tokenShare(rowTokens, totalTokens),
		})
	}
	return rows
}

// tokenShare 是维度占总 token 的比例。
func tokenShare(rowTokens, totalTokens int64) float64 {
	if totalTokens <= 0 {
		return 0
	}
	return float64(rowTokens) / float64(totalTokens)
}

// aggregatingOtherByDimension 逐行解析 other 后按维度累加 cache_tokens 与 frt。
// SQL 侧不解析 JSON，因此这里把所有行拉回 Go 侧聚合。
func aggregatingOtherByDimension(r Range, spec dimensionSpec) (map[string]int64, map[string]averageAccumulator) {
	cached := map[string]int64{}
	ttft := map[string]averageAccumulator{}
	rows := []usageOtherRow{}
	err := consumeQuery(r, Filters{}).
		Select(fmt.Sprintf("%s AS %s, logs.other AS other", spec.keySelect, dimensionKeyAlias())).
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 读取维度 other 失败: " + err.Error())
		return cached, ttft
	}
	for _, row := range rows {
		other := parseOther(row.Other)
		if other == nil {
			continue
		}
		if value, ok := numericToInt64(other["cache_tokens"]); ok && value > 0 {
			cached[row.Key] += value
		}
		if value, ok := numericToInt64(other["frt"]); ok && value >= 0 {
			accumulator := ttft[row.Key]
			accumulator.sum += value
			accumulator.count++
			ttft[row.Key] = accumulator
		}
	}
	return cached, ttft
}

// failureCountsByDimension 在错误日志开启时按维度统计失败事件数。
func failureCountsByDimension(r Range, spec dimensionSpec) map[string]int64 {
	counts := map[string]int64{}
	if !constant.ErrorLogEnabled {
		return counts
	}
	rows := []struct {
		Key   string `gorm:"column:key"`
		Calls int64  `gorm:"column:calls"`
	}{}
	err := errorQuery(r, Filters{}).
		Select(fmt.Sprintf("%s AS %s, COUNT(*) AS calls", spec.keySelect, dimensionKeyAlias())).
		Group(spec.groupBy).
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 统计维度失败数失败: " + err.Error())
		return counts
	}
	for _, row := range rows {
		counts[row.Key] = row.Calls
	}
	return counts
}

// buildUsageTrend 在 Go 侧按粒度分桶趋势。
func buildUsageTrend(rows []usageDetailRow, r Range, granularity string) []UsageTrendPoint {
	size := trendBucketSeconds(granularity, r.End-r.Start)
	buckets := map[int64]*UsageTrendPoint{}
	for _, row := range rows {
		key := bucketStart(row.CreatedAt, size)
		point, ok := buckets[key]
		if !ok {
			point = &UsageTrendPoint{Ts: key}
			buckets[key] = point
		}
		point.Calls++
		point.TotalTokens += row.PromptTokens + row.CompletionTokens
		point.Quota += row.Quota
	}
	if constant.ErrorLogEnabled {
		failures := []errorPointRow{}
		err := errorQuery(r, Filters{}).Select("logs.created_at AS created_at").Scan(&failures).Error
		if err != nil {
			common.SysError("observability: 读取趋势失败明细失败: " + err.Error())
		}
		for _, row := range failures {
			if point, ok := buckets[bucketStart(row.CreatedAt, size)]; ok {
				point.FailureCalls++
			}
		}
	}
	trend := make([]UsageTrendPoint, 0, len(buckets))
	for _, point := range buckets {
		trend = append(trend, *point)
	}
	slices.SortFunc(trend, func(a, b UsageTrendPoint) int { return cmp.Compare(a.Ts, b.Ts) })
	return trend
}

// getUsageMatrix 返回维度组合的热力矩阵，X/Y 标签按出现顺序编号。
func getUsageMatrix(r Range, matrixName string, x, y dimensionSpec, limit int) (*Matrix, error) {
	rows := []usageMatrixRow{}
	err := consumeQuery(r, Filters{}).
		Select(fmt.Sprintf(`%s AS x_key, %s AS y_key, COUNT(*) AS calls,
			COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens,
			COALESCE(SUM(logs.quota), 0) AS quota`, x.keySelect, y.keySelect)).
		Group(x.groupBy + ", " + y.groupBy).
		Order("total_tokens DESC").
		Limit(limit * limit).
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 聚合热力矩阵失败: " + err.Error())
		return nil, err
	}

	xIndex := map[string]int{}
	yIndex := map[string]int{}
	matrix := &Matrix{XLabels: []string{}, YLabels: []string{}, Cells: []MatrixCell{}}
	for _, row := range rows {
		xi, ok := xIndex[row.XKey]
		if !ok {
			xi = len(matrix.XLabels)
			xIndex[row.XKey] = xi
			matrix.XLabels = append(matrix.XLabels, xAxisLabel(matrixName, row.XKey))
		}
		yi, ok := yIndex[row.YKey]
		if !ok {
			yi = len(matrix.YLabels)
			yIndex[row.YKey] = yi
			matrix.YLabels = append(matrix.YLabels, row.YKey)
		}
		matrix.Cells = append(matrix.Cells, MatrixCell{
			X: xi, Y: yi, Calls: row.Calls, TotalTokens: row.TotalTokens, Quota: row.Quota,
		})
	}
	return matrix, nil
}

// xAxisLabel 只对渠道类型维度做名称还原，其余维度直接用键值。
func xAxisLabel(matrixName string, key string) string {
	if matrixName == "channel_type_model" {
		if channelType, ok := numericToInt64(key); ok {
			return constant.GetChannelTypeName(int(channelType))
		}
	}
	return key
}
