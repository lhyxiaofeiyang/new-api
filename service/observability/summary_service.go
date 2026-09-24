package observability

import (
	"cmp"
	"math"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

// summaryTotalsSelect 只使用 COUNT/SUM 与 CASE WHEN，三库通用。
// 不在此处派生 success_calls：成功数必须由「总数 − 失败数」反推，
// 而失败数依赖错误日志开关（见 GetSummary），无法在单条 SQL 内决定。
const summaryTotalsSelect = `COUNT(*) AS calls,
	COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
	COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
	COALESCE(SUM(quota), 0) AS quota,
	COALESCE(SUM(use_time), 0) AS latency_sum,
	COALESCE(SUM(CASE WHEN use_time > 0 THEN 1 ELSE 0 END), 0) AS latency_count,
	COALESCE(SUM(CASE WHEN is_stream THEN 1 ELSE 0 END), 0) AS stream_calls`

const summaryUniqueSelect = `COUNT(DISTINCT CASE WHEN token_id > 0 THEN token_id END) AS unique_tokens,
	COUNT(DISTINCT CASE WHEN channel_id > 0 THEN channel_id END) AS unique_channels,
	COUNT(DISTINCT CASE WHEN model_name <> '' THEN model_name END) AS unique_models`

type summaryTotalsRow struct {
	Calls            int64 `gorm:"column:calls"`
	PromptTokens     int64 `gorm:"column:prompt_tokens"`
	CompletionTokens int64 `gorm:"column:completion_tokens"`
	Quota            int64 `gorm:"column:quota"`
	LatencySum       int64 `gorm:"column:latency_sum"`
	LatencyCount     int64 `gorm:"column:latency_count"`
	StreamCalls      int64 `gorm:"column:stream_calls"`
}

type summaryUniqueRow struct {
	UniqueTokens   int64 `gorm:"column:unique_tokens"`
	UniqueChannels int64 `gorm:"column:unique_channels"`
	UniqueModels   int64 `gorm:"column:unique_models"`
}

// summaryDetailRow 是逐行明细，用于 Go 侧时间分桶与 other.frt 提取
// （SQL 侧不解析 JSON）。
type summaryDetailRow struct {
	CreatedAt        int64  `gorm:"column:created_at"`
	PromptTokens     int64  `gorm:"column:prompt_tokens"`
	CompletionTokens int64  `gorm:"column:completion_tokens"`
	Quota            int64  `gorm:"column:quota"`
	Other            string `gorm:"column:other"`
}

type errorPointRow struct {
	CreatedAt int64 `gorm:"column:created_at"`
}

// GetSummary 聚合仪表盘首屏的全部数据。
func GetSummary(rangeName string, startRaw, endRaw int64, now time.Time) (*Summary, error) {
	r, err := resolveRange(rangeName, startRaw, endRaw, Range24h, now)
	if err != nil {
		return nil, err
	}
	out := &Summary{
		Range:          r,
		TopModels:      []TopModel{},
		TopTokens:      []TopToken{},
		TopChannels:    []TopChannel{},
		Traffic:        []TrafficPoint{},
		HourlyActivity: []HourlyActivity{},
		HealthTimeline: []HealthPoint{},
	}

	var totals summaryTotalsRow
	if err := consumeQuery(r, Filters{}).Select(summaryTotalsSelect).Scan(&totals).Error; err != nil {
		common.SysError("observability: 汇总消费日志失败: " + err.Error())
		return nil, err
	}
	var uniques summaryUniqueRow
	if err := consumeQuery(r, Filters{}).Select(summaryUniqueSelect).Scan(&uniques).Error; err != nil {
		common.SysError("observability: 统计去重维度失败: " + err.Error())
		return nil, err
	}

	details := []summaryDetailRow{}
	if err := consumeQuery(r, Filters{}).
		Select("logs.created_at AS created_at, logs.prompt_tokens AS prompt_tokens, logs.completion_tokens AS completion_tokens, logs.quota AS quota, logs.other AS other").
		Scan(&details).Error; err != nil {
		common.SysError("observability: 读取明细行失败: " + err.Error())
		return nil, err
	}

	ttftSum, ttftCount := sumTtftMs(details)
	cachedTokens := sumCachedTokens(details)
	failureCalls, failureSource := getFailureStats(r)
	if failureSource == failureSourcePerfMetrics {
		failureCalls = perfMetricsFailureEstimate(r)
	}
	// 失败数不得超过总数，否则 成功 = 总数 − 失败 与「三项加得平」无法同时成立。
	// 两种来源都可能超额：开启时重试会为同一次请求写出多条 type=5；
	// 关闭时 perf_metrics 的桶覆盖窗口与 logs 的行范围不一致（实测逐日覆盖率
	// 113%→28.8%）。截断后成功数下限 0，三项恒加得平。
	failureCalls = min(failureCalls, totals.Calls)

	counters := SummaryCounters{
		TotalCalls:       totals.Calls,
		FailureCalls:     failureCalls,
		SuccessCalls:     max(totals.Calls-failureCalls, 0),
		PromptTokens:     totals.PromptTokens,
		CompletionTokens: totals.CompletionTokens,
		CachedTokens:     cachedTokens,
		TotalTokens:      totals.PromptTokens + totals.CompletionTokens,
		TotalQuota:       totals.Quota,
		TotalCostUsd:     quotaToUsd(totals.Quota),
		AverageLatencyMs: averageMs(totals.LatencySum*1000, totals.LatencyCount),
		AverageTtftMs:    averageMs(ttftSum, ttftCount),
		StreamCalls:      totals.StreamCalls,
		UniqueTokens:     uniques.UniqueTokens,
		UniqueChannels:   uniques.UniqueChannels,
		UniqueModels:     uniques.UniqueModels,
	}
	counters.SuccessRate = successRate(counters.SuccessCalls, counters.TotalCalls)

	out.Summary = counters
	out.DataSource = DataSource{
		ErrorLogEnabled: constant.ErrorLogEnabled,
		FailureSource:   failureSource,
		LogRows:         totals.Calls,
	}
	out.Traffic = buildTraffic(details, r)
	out.HourlyActivity = buildHourlyActivity(details, now)
	out.HealthTimeline = buildHealthTimeline(details, r, now)
	out.TopModels, out.TopTokens, out.TopChannels = getTopDimensions(r)
	out.Rolling, err = getRolling(now)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// getFailureStats 依据 ERROR_LOG_ENABLED 返回失败事件数与来源。
// 开启：窗口内 logs.type=5 的准确行数；关闭：0，由 perfMetricsFailureEstimate 兜底估算。
func getFailureStats(r Range) (int64, string) {
	if constant.ErrorLogEnabled {
		var count int64
		if err := errorQuery(r, Filters{}).Count(&count).Error; err != nil {
			common.SysError("observability: 统计错误日志失败: " + err.Error())
			return 0, failureSourceErrorLog
		}
		return count, failureSourceErrorLog
	}
	return 0, failureSourcePerfMetrics
}

// perfMetricsFailureEstimate 在错误日志关闭时用 perf_metrics 的模型×分组 5 分钟桶
// 估算失败数：各桶 request_count − success_count 求和，下限 0。
// 只借它一个数——总数/成功数一律来自 logs，三项因此始终加得平，
// 也避免了旧实现「四项整体改用 perf_metrics」时覆盖率不足（实测逐日 113%→28.8%）
// 带来的总数漂移。
func perfMetricsFailureEstimate(r Range) int64 {
	summaries, err := model.GetPerfMetricsSummaryAll(r.Start, r.End, nil)
	if err != nil {
		common.SysError("observability: 读取 perf_metrics 失败: " + err.Error())
		return 0
	}
	var failures int64
	for _, s := range summaries {
		failures += s.RequestCount - s.SuccessCount
	}
	return max(failures, 0)
}

// tokensJoin 只暴露 id/name 两列，理由同 query.go 的 usersJoin：tokens 表也有
// key、used_quota 等同名列，整表 JOIN 会让本包未限定表名的列变成 ambiguous。
// 与 users/channels 一样，tokens 位于主库。
const tokensJoin = "LEFT JOIN (SELECT id, name FROM tokens) AS tk ON tk.id = logs.token_id"

func getTopDimensions(r Range) ([]TopModel, []TopToken, []TopChannel) {
	topModels := []TopModel{}
	err := consumeQuery(r, Filters{}).
		Select("logs.model_name AS model_name, COUNT(*) AS calls, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(logs.quota), 0) AS quota").
		Group("logs.model_name").
		Order("total_tokens DESC").
		Limit(5).
		Scan(&topModels).Error
	if err != nil {
		common.SysError("observability: 统计 Top 模型失败: " + err.Error())
		topModels = []TopModel{}
	}

	topTokens := []TopToken{}
	err = consumeQuery(r, Filters{}).
		Joins(tokensJoin).
		// logs.token_name 是请求发生当时的名字，改名后同一 token 会因它裂成多行；
		// 按 token_id 唯一分组，名字优先取 tokens 表的当前名，缺失时退回日志里的名字。
		Select("logs.token_id AS token_id, COALESCE(MAX(tk.name), MAX(logs.token_name), '') AS token_name, COUNT(*) AS calls, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(logs.quota), 0) AS quota").
		Group("logs.token_id").
		Order("total_tokens DESC").
		Limit(5).
		Scan(&topTokens).Error
	if err != nil {
		common.SysError("observability: 统计 Top 令牌失败: " + err.Error())
		topTokens = []TopToken{}
	}

	topChannels := []TopChannel{}
	err = consumeQuery(r, Filters{}).
		Select("logs.channel_id AS channel_id, COALESCE(channels.name, '') AS channel_name, COUNT(*) AS calls, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(logs.quota), 0) AS quota").
		Group("logs.channel_id, channels.name").
		Order("total_tokens DESC").
		Limit(5).
		Scan(&topChannels).Error
	if err != nil {
		common.SysError("observability: 统计 Top 渠道失败: " + err.Error())
		topChannels = []TopChannel{}
	}
	return topModels, topTokens, topChannels
}

// getRolling 统计近 60 秒的实时调用量与 token 量。
func getRolling(now time.Time) (Rolling, error) {
	var rolling Rolling
	since := now.Add(-60 * time.Second).Unix()
	err := model.LOG_DB.Table("logs").
		Where("logs.type = ?", model.LogTypeConsume).
		Where("logs.created_at >= ?", since).
		Select("COUNT(*) AS rpm, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS tpm").
		Scan(&rolling).Error
	if err != nil {
		common.SysError("observability: 统计实时速率失败: " + err.Error())
		return rolling, err
	}
	return rolling, nil
}

// buildTraffic 在 Go 侧按桶累加流量趋势。
func buildTraffic(rows []summaryDetailRow, r Range) []TrafficPoint {
	size := trafficBucketSeconds(r.End - r.Start)
	bucketSeconds := map[int64]*TrafficPoint{}
	for _, row := range rows {
		key := bucketStart(row.CreatedAt, size)
		point, ok := bucketSeconds[key]
		if !ok {
			point = &TrafficPoint{Ts: key}
			bucketSeconds[key] = point
		}
		point.Calls++
		point.PromptTokens += row.PromptTokens
		point.CompletionTokens += row.CompletionTokens
		point.Quota += row.Quota
	}
	return sortedTraffic(bucketSeconds)
}

// buildHourlyActivity 按本地时区的「小时 of day」(0–23) 统计调用分布，固定返回 24 项。
// now 仅用于取时区；传入区间跨多日时同一小时逐日累加。
func buildHourlyActivity(rows []summaryDetailRow, now time.Time) []HourlyActivity {
	hours := make([]HourlyActivity, 24)
	for i := range hours {
		hours[i].Hour = i
	}
	location := now.Location()
	for _, row := range rows {
		hours[time.Unix(row.CreatedAt, 0).In(location).Hour()].Calls++
	}
	return hours
}

// buildHealthTimeline 输出最近 24 小时的 10 分钟桶健康时间线（固定 144 项）。
func buildHealthTimeline(rows []summaryDetailRow, r Range, now time.Time) []HealthPoint {
	windowEnd := min(r.End, now.Unix())
	last := bucketStart(windowEnd, healthBucketSeconds)
	first := last - int64(healthBuckets-1)*healthBucketSeconds

	index := map[int64]int{}
	timeline := make([]HealthPoint, healthBuckets)
	for i := range timeline {
		ts := first + int64(i)*healthBucketSeconds
		timeline[i].Ts = ts
		index[ts] = i
	}
	for _, row := range rows {
		if row.CreatedAt < first || row.CreatedAt > windowEnd {
			continue
		}
		if i, ok := index[bucketStart(row.CreatedAt, healthBucketSeconds)]; ok {
			timeline[i].Calls++
		}
	}
	if constant.ErrorLogEnabled {
		failures := []errorPointRow{}
		err := errorQuery(r, Filters{}).
			Where("logs.created_at >= ? AND logs.created_at < ?", first, windowEnd).
			Select("logs.created_at AS created_at").
			Scan(&failures).Error
		if err != nil {
			common.SysError("observability: 读取健康时间线失败日志失败: " + err.Error())
		}
		for _, row := range failures {
			if i, ok := index[bucketStart(row.CreatedAt, healthBucketSeconds)]; ok {
				timeline[i].Failures++
			}
		}
	}
	return timeline
}

// sumTtftMs 在 Go 侧解析 other.frt（首字节毫秒）。
func sumTtftMs(rows []summaryDetailRow) (int64, int64) {
	var sum, count int64
	for _, row := range rows {
		other := parseOther(row.Other)
		if other == nil {
			continue
		}
		value, ok := numericToInt64(other["frt"])
		if !ok || value < 0 {
			continue
		}
		sum += value
		count++
	}
	return sum, count
}

// sumCachedTokens 复用已取回的明细行累加 other.cache_tokens，避免新增一次查询。
func sumCachedTokens(rows []summaryDetailRow) int64 {
	var sum int64
	for _, row := range rows {
		value, ok := numericToInt64(parseOther(row.Other)["cache_tokens"])
		if !ok || value < 0 {
			continue
		}
		sum += value
	}
	return sum
}

func sortedTraffic(buckets map[int64]*TrafficPoint) []TrafficPoint {
	points := make([]TrafficPoint, 0, len(buckets))
	for _, point := range buckets {
		points = append(points, *point)
	}
	slices.SortFunc(points, func(a, b TrafficPoint) int {
		return cmp.Compare(a.Ts, b.Ts)
	})
	return points
}

func successRate(success, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(success)/float64(total)*10000) / 100
}

func averageMs(sum, count int64) float64 {
	if count <= 0 {
		return 0
	}
	return math.Round(float64(sum)/float64(count)*100) / 100
}

// quotaToUsd 使用 New API 既有换算：额度 / QuotaPerUnit = 美元。
func quotaToUsd(quota int64) float64 {
	return math.Round(float64(quota)/common.QuotaPerUnit*10000) / 10000
}
