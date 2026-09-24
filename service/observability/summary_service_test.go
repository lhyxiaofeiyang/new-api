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
	// 口径 v2：总数恒取自消费日志（logs type=2）；失败取错误日志准确行数；
	// 成功 = 总数 − 失败，三项因此永远加得平。
	assert.Equal(t, int64(2), counters.SuccessCalls)
	assert.Equal(t, int64(1), counters.FailureCalls)
	assert.Equal(t, 66.67, counters.SuccessRate)
	assert.Equal(t, counters.TotalCalls, counters.SuccessCalls+counters.FailureCalls)
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

	// Top 榜按 token 总数排序，渠道名必须来自 channels JOIN。
	require.Len(t, summary.TopModels, 2)
	assert.Equal(t, "gpt-4o", summary.TopModels[0].ModelName)
	assert.Equal(t, int64(1), summary.TopModels[0].Calls)
	assert.Equal(t, int64(300), summary.TopModels[0].TotalTokens)

	require.Len(t, summary.TopTokens, 2)
	assert.Equal(t, TopToken{TokenId: 1, TokenName: "key-a", Calls: 1, TotalTokens: 300, Quota: 500000}, summary.TopTokens[0])

	require.Len(t, summary.TopChannels, 2)
	assert.Equal(t, TopChannel{ChannelId: 10, ChannelName: "openai-ch", Calls: 1, TotalTokens: 300, Quota: 500000}, summary.TopChannels[0])
	assert.Equal(t, "claude-ch", summary.TopChannels[1].ChannelName)

	// 流量按小时分桶（24h 区间）：3 条消费日志落在 3 个不同小时。
	require.Len(t, summary.Traffic, 3)
	assert.Equal(t, int64(100), summary.Traffic[0].PromptTokens)
	assert.Equal(t, int64(500000), summary.Traffic[0].Quota)

	// 按小时分布（小时 of day）：3 条消费日志分布在 3 个不同小时。
	total := int64(0)
	for _, activity := range summary.HourlyActivity {
		total += activity.Calls
	}
	assert.Equal(t, int64(3), total)
	// 分桶口径必须是「本地时区的小时 of day」，不是「距区间末尾的偏移」：
	// testNow() = 09-20 12:00，3 条消费日志落在 3/2/1 小时前，即本地 09:00 / 10:00
	// / 11:00，因此只有这 3 个小时槽非零。若实现改成滑窗（按 r.End 反推下标），
	// 非零槽会移动到 21/22/23。
	callsByHour := map[int]int64{}
	for _, activity := range summary.HourlyActivity {
		if activity.Calls != 0 {
			callsByHour[activity.Hour] = activity.Calls
		}
	}
	assert.Equal(t, map[int]int64{9: 1, 10: 1, 11: 1}, callsByHour)
}

// 口径 v2 的关键回归：总数一律来自消费日志（logs type=2）的**行数**，
// use_time=0 的悬空行既不算失败也不算「非成功」，而是自然归入成功，
// 从而保证 成功 + 失败 == 总数（旧实现按 use_time>0 计成功，会漏掉这些行）。
func TestGetSummaryCountsZeroUseTimeRowsAsSuccess(t *testing.T) {
	db, now := setupFixture(t)
	withErrorLog(t, false)
	// 悬空行：type=2 但 use_time=0（无延迟记录），外加 1 条错误日志。
	insertLog(t, db, logRow{
		createdAt: now.Add(-10 * time.Minute).Unix(), logType: model.LogTypeConsume, requestId: "req-zero",
		tokenId: 1, tokenName: "key-a", channelId: 10, modelName: "gpt-4o",
		promptTokens: 1, completionTokens: 1, useTime: 0,
	})

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	counters := summary.Summary
	// 3 条夹具消费日志 + 1 条悬空行 = 4；总数只数行数，与 use_time 无关。
	assert.Equal(t, int64(4), counters.TotalCalls)
	// 测试夹具未写 perf_metrics，估算失败数为 0；悬空行必须落在成功侧。
	assert.Equal(t, int64(0), counters.FailureCalls)
	assert.Equal(t, int64(4), counters.SuccessCalls)
	assert.Equal(t, 100.0, counters.SuccessRate)
	assert.Equal(t, counters.TotalCalls, counters.SuccessCalls+counters.FailureCalls)
}

// 错误日志开启时失败数为准确值（logs type=5 行数），成功由总数反推。
func TestGetSummaryUsesErrorLogFailuresWhenEnabled(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	assert.Equal(t, failureSourceErrorLog, summary.DataSource.FailureSource)
	assert.Equal(t, int64(3), summary.Summary.TotalCalls)
	assert.Equal(t, int64(1), summary.Summary.FailureCalls, "失败数取 type=5 行数")
	assert.Equal(t, int64(2), summary.Summary.SuccessCalls)
	assert.Equal(t, summary.Summary.TotalCalls, summary.Summary.SuccessCalls+summary.Summary.FailureCalls)
}

// 错误日志关闭时失败数取 perf_metrics 估算（sum(request_count − success_count)，下限 0），
// 总数仍来自消费日志——两者不再互相顶替，Total Calls 卡片与请求明细表口径一致。
func TestGetSummaryEstimatesFailuresFromPerfMetrics(t *testing.T) {
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
	// 总数来自 logs（3 条消费日志），不是 perf_metrics 的 10。
	assert.Equal(t, int64(3), summary.Summary.TotalCalls)
	assert.Equal(t, int64(1), summary.Summary.FailureCalls, "估算失败数 = 10 − 9")
	assert.Equal(t, int64(2), summary.Summary.SuccessCalls)
	assert.Equal(t, 66.67, summary.Summary.SuccessRate)
	assert.Equal(t, summary.Summary.TotalCalls, summary.Summary.SuccessCalls+summary.Summary.FailureCalls)
	// 错误日志关闭时健康时间线不得伪造失败数。
	for _, point := range summary.HealthTimeline {
		assert.Zero(t, point.Failures)
	}
}

// 口径 v2 的上限规则：failure = min(failure_raw, total)。
// 估算值可能超过消费日志总数（perf_metrics 覆盖窗口与 logs 不一致，
// 实测逐日覆盖率最高 113%），此时失败截到总数、成功下限 0，三项仍加得平。
func TestGetSummaryClampsEstimatedFailuresToTotal(t *testing.T) {
	db, now := setupFixture(t)
	withErrorLog(t, false)
	require.NoError(t, db.Create(&model.PerfMetric{
		ModelName:    "gpt-4o",
		Group:        "default",
		BucketTs:     bucketStart(now.Add(-30*time.Minute).Unix(), 300),
		RequestCount: 99,
		SuccessCount: 90,
	}).Error)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	// 3 条消费日志，估算失败 9 → 截到 3，成功 0。
	assert.Equal(t, int64(3), summary.Summary.TotalCalls)
	assert.Equal(t, int64(3), summary.Summary.FailureCalls, "失败上限 = 总数")
	assert.Equal(t, int64(0), summary.Summary.SuccessCalls)
	assert.Equal(t, 0.0, summary.Summary.SuccessRate)
	assert.Equal(t, summary.Summary.TotalCalls, summary.Summary.SuccessCalls+summary.Summary.FailureCalls)
}

// 上限规则的另一触发条件：错误日志开启时，一次请求重试会写出多条 type=5，
// 于是失败行数可能多于消费行数——同样截到总数，不得出现「成功率 < 0」或三项加不平。
func TestGetSummaryClampsErrorLogFailuresToTotal(t *testing.T) {
	db, now := setupDB(t), testNow()
	withErrorLog(t, true)
	insertLog(t, db, logRow{
		createdAt: now.Add(-10 * time.Minute).Unix(), logType: model.LogTypeConsume, requestId: "req-retried",
		tokenId: 1, tokenName: "key-a", channelId: 10, modelName: "gpt-4o",
		promptTokens: 1, completionTokens: 1, useTime: 5,
	})
	for _, requestId := range []string{"req-retried", "req-retried", "req-retried"} {
		insertLog(t, db, logRow{
			createdAt: now.Add(-9 * time.Minute).Unix(), logType: model.LogTypeError, requestId: requestId,
			tokenId: 1, tokenName: "key-a", channelId: 10, modelName: "gpt-4o",
			content: "upstream 500",
		})
	}

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	// 1 条消费日志，3 条错误日志 → 失败截到 1，成功 0。
	assert.Equal(t, int64(1), summary.Summary.TotalCalls)
	assert.Equal(t, int64(1), summary.Summary.FailureCalls, "失败上限 = 总数")
	assert.Equal(t, int64(0), summary.Summary.SuccessCalls)
	assert.Equal(t, 0.0, summary.Summary.SuccessRate)
	assert.Equal(t, summary.Summary.TotalCalls, summary.Summary.SuccessCalls+summary.Summary.FailureCalls)
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

// 同一 token 改名后，消费日志里会同时存在改名前后的两批 token_name。Top 令牌
// 必须先按 token_id 合并，再取 tokens 表的当前名，否则同一个 key 会裂成多行
// （前端 key 冲突），改名前的调用数也会被算成另一个令牌。
func TestGetSummaryMergesRenamedTokenAndOrdersByTokens(t *testing.T) {
	_, now := setupTopTokenFixture(t)
	withErrorLog(t, true)

	summary, err := GetSummary(Range24h, 0, 0, now)
	require.NoError(t, err)

	require.Len(t, summary.TopTokens, 2, "同一 token_id 只能出现一行")
	// token 4：两批日志合并后 2 次调用、3000 token（改名前的行不得再单独成行）。
	// 改名发生在 1 小时前，且此处断言的是当前名而非任一历史名。
	assert.Equal(t, TopToken{
		TokenId: 4, TokenName: "mac | Hermes | OpenAI",
		Calls: 2, TotalTokens: 3000, Quota: 500000,
	}, summary.TopTokens[0])
	// token 9：调用数（3）超过 token 4，token 数（800）却远低于它——两种排序口径
	// 会给出相反名次，因此 1 号位属于 token 4 只可能来自「按 token 数排序」。
	assert.Equal(t, TopToken{
		TokenId: 9, TokenName: "bulk-key",
		Calls: 3, TotalTokens: 800, Quota: 100000,
	}, summary.TopTokens[1])
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
