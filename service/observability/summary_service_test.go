package observability

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetSummaryEmptyDatabase(t *testing.T) {
	setupDB(t)
	withErrorLog(t, true)

	summary, err := GetSummary(Range24h, 0, 0, testNow())
	require.NoError(t, err)

	assert.Equal(t, SummaryCounters{}, summary.Summary, "空库必须返回全零计数")
	assert.Equal(t, failureSourceErrorLog, summary.DataSource.FailureSource)
	assert.True(t, summary.DataSource.ErrorLogEnabled)
	assert.Empty(t, summary.TopModels)
	assert.Empty(t, summary.Traffic)
	assert.Len(t, summary.HourlyActivity, 24)
	assert.Len(t, summary.HealthTimeline, healthBuckets)
	for _, point := range summary.HealthTimeline {
		assert.Zero(t, point.Calls)
		assert.Zero(t, point.Failures)
	}
}

func TestGetSummaryAggregatesExactNumbers(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	counters := summary.Summary
	assert.Equal(t, int64(3), counters.TotalCalls)
	// success_calls / success_rate 与 total_calls 同源（logs type=2），
	// 失败数来自错误日志，两者相加不等于总调用数是有意为之：含重试请求。
	assert.Equal(t, int64(3), counters.SuccessCalls)
	assert.Equal(t, int64(1), counters.FailureCalls)
	assert.Equal(t, 100.0, counters.SuccessRate)
	assert.Equal(t, int64(115), counters.PromptTokens)
	assert.Equal(t, int64(225), counters.CompletionTokens)
	assert.Equal(t, int64(340), counters.TotalTokens)
	assert.Equal(t, int64(50), counters.CachedTokens)
	assert.Equal(t, int64(1000000), counters.TotalQuota)
	assert.Equal(t, 2.0, counters.TotalCostUsd)
	assert.Equal(t, 2000.0, counters.AverageLatencyMs)
	assert.Equal(t, 100.0, counters.AverageTtftMs)
	assert.Equal(t, int64(1), counters.StreamCalls)
	assert.Equal(t, int64(2), counters.UniqueTokens)
	assert.Equal(t, int64(2), counters.UniqueChannels)
	assert.Equal(t, int64(2), counters.UniqueModels)

	assert.Equal(t, Range{Start: now.Add(-24 * time.Hour).Unix(), End: now.Unix(), Range: Range24h}, summary.Range)
	assert.True(t, summary.DataSource.ErrorLogEnabled)
	assert.Equal(t, failureSourceErrorLog, summary.DataSource.FailureSource)
	assert.Equal(t, int64(3), summary.DataSource.LogRows)

	// Top 榜按调用数排序，渠道名必须来自 channels JOIN。
	require.Len(t, summary.TopModels, 2)
	assert.Equal(t, "claude-3", summary.TopModels[0].ModelName)
	assert.Equal(t, int64(2), summary.TopModels[0].Calls)
	assert.Equal(t, int64(40), summary.TopModels[0].TotalTokens)

	require.Len(t, summary.TopTokens, 2)
	assert.Equal(t, TopToken{TokenId: 2, TokenName: "key-b", Calls: 2, TotalTokens: 40, Quota: 500000}, summary.TopTokens[0])

	require.Len(t, summary.TopChannels, 2)
	assert.Equal(t, TopChannel{ChannelId: 11, ChannelName: "claude-ch", Calls: 2, TotalTokens: 40, Quota: 500000}, summary.TopChannels[0])
	assert.Equal(t, "openai-ch", summary.TopChannels[1].ChannelName)

	// 流量按小时分桶（24h 区间）：3 条消费日志落在 3 个不同小时。
	require.Len(t, summary.Traffic, 3)
	assert.Equal(t, int64(100), summary.Traffic[0].PromptTokens)
	assert.Equal(t, int64(500000), summary.Traffic[0].Quota)

	// 24 小时活跃分布：3 条消费日志分布在 3 个不同小时。
	total := int64(0)
	for _, activity := range summary.HourlyActivity {
		total += activity.Calls
	}
	assert.Equal(t, int64(3), total)
}

func TestGetSummaryFallsBackToPerfMetrics(t *testing.T) {
	db, now := setupFixture(t)
	withErrorLog(t, false)
	require.NoError(t, db.Create(&model.PerfMetric{
		ModelName:    "gpt-4o",
		Group:        "default",
		BucketTs:     bucketStart(now.Add(-30*time.Minute).Unix(), 300),
		RequestCount: 10,
		SuccessCount: 9,
	}).Error)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	assert.Equal(t, failureSourcePerfMetrics, summary.DataSource.FailureSource)
	assert.Equal(t, int64(10), summary.Summary.TotalCalls)
	assert.Equal(t, int64(9), summary.Summary.SuccessCalls)
	assert.Equal(t, int64(1), summary.Summary.FailureCalls)
	assert.Equal(t, 90.0, summary.Summary.SuccessRate)
	// 错误日志关闭时健康时间线不得伪造失败数。
	for _, point := range summary.HealthTimeline {
		assert.Zero(t, point.Failures)
	}
}

func TestGetSummaryHealthTimelineBucketsFailures(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	require.Len(t, summary.HealthTimeline, healthBuckets)
	// 时间线按窗口末端对齐，步长固定 10 分钟。
	last := summary.HealthTimeline[healthBuckets-1]
	assert.Equal(t, bucketStart(now.Unix(), healthBucketSeconds), last.Ts)
	for i := 1; i < len(summary.HealthTimeline); i++ {
		assert.Equal(t, last.Ts-int64(healthBuckets-1-i)*healthBucketSeconds, summary.HealthTimeline[i].Ts)
	}

	var calls, failures int64
	for _, point := range summary.HealthTimeline {
		calls += point.Calls
		failures += point.Failures
	}
	assert.Equal(t, int64(3), calls)
	assert.Equal(t, int64(1), failures)
}

func TestGetSummaryRejectsInvalidRange(t *testing.T) {
	setupDB(t)
	_, err := GetSummary(RangeCustom, 0, 0, testNow())
	require.Error(t, err)
	_, err = GetSummary("nope", 0, 0, testNow())
	require.Error(t, err)
}

func TestGetRollingCountsLastMinute(t *testing.T) {
	db, now := setupFixture(t)
	insertLog(t, db, logRow{
		createdAt: now.Add(-30 * time.Second).Unix(), logType: 2, requestId: "req-recent",
		promptTokens: 7, completionTokens: 3, modelName: "gpt-4o",
	})
	// 超过 60 秒的日志不计入实时速率。
	insertLog(t, db, logRow{
		createdAt: now.Add(-90 * time.Second).Unix(), logType: 2, requestId: "req-old",
		promptTokens: 100, completionTokens: 100, modelName: "gpt-4o",
	})

	rolling, err := getRolling(now)
	require.NoError(t, err)
	assert.Equal(t, int64(1), rolling.Rpm)
	assert.Equal(t, int64(10), rolling.Tpm)
}
