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
const summaryTotalsSelect = `COUNT(*) AS calls,
	COALESCE(SUM(CASE WHEN use_time > 0 THEN 1 ELSE 0 END), 0) AS success_calls,
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
	SuccessCalls     int64 `gorm:"column:success_calls"`
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

	counters := SummaryCounters{
		TotalCalls:       totals.Calls,
		SuccessCalls:     totals.SuccessCalls,
		FailureCalls:     failureCalls,
		SuccessRate:      successRate(totals.SuccessCalls, totals.Calls),
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
	if failureSource == failureSourcePerfMetrics {
		counters = perfMetricsCounters(r, counters)
	}

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

// getFailureStats 依据 ERROR_LOG_ENABLED 选择失败事件来源。
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

// perfMetricsCounters 在错误日志关闭时用 perf_metrics 的模型×分组 5 分钟桶
// 补出粗粒度成功率；调用量/token/额度仍来自 logs，避免口径混用。
func perfMetricsCounters(r Range, counters SummaryCounters) SummaryCounters {
	summaries, err := model.GetPerfMetricsSummaryAll(r.Start, r.End, nil)
	if err != nil {
		common.SysError("observability: 读取 perf_metrics 失败: " + err.Error())
		return counters
	}
	var total, success int64
	for _, s := range summaries {
		total += s.RequestCount
		success += s.SuccessCount
	}
	if total == 0 {
		return counters
	}
	counters.TotalCalls = total
	counters.SuccessCalls = success
	counters.FailureCalls = max(total-success, 0)
	counters.SuccessRate = successRate(success, total)
	return counters
}

func getTopDimensions(r Range) ([]TopModel, []TopToken, []TopChannel) {
	topModels := []TopModel{}
	err := consumeQuery(r, Filters{}).
		Select("logs.model_name AS model_name, COUNT(*) AS calls, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(logs.quota), 0) AS quota").
		Group("logs.model_name").
		Order("calls DESC").
		Limit(5).
		Scan(&topModels).Error
	if err != nil {
		common.SysError("observability: 统计 Top 模型失败: " + err.Error())
		topModels = []TopModel{}
	}

	topTokens := []TopToken{}
	err = consumeQuery(r, Filters{}).
		Select("logs.token_id AS token_id, logs.token_name AS token_name, COUNT(*) AS calls, COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens, COALESCE(SUM(logs.quota), 0) AS quota").
		Group("logs.token_id, logs.token_name").
		Order("calls DESC").
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
		Order("calls DESC").
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

// buildHourlyActivity 按本地时区统计 24 小时的调用分布，固定返回 24 项。
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
