package observability

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUsageEmptyDatabase(t *testing.T) {
	setupDB(t)
	withErrorLog(t, false)

	usage, err := GetUsage(Range7d, 0, 0, "token", "", "day", 0, testNow())
	require.NoError(t, err)

	assert.Empty(t, usage.Rows)
	assert.Empty(t, usage.Trend)
	assert.Nil(t, usage.Matrix, "未传 matrix 时不得返回矩阵")
	assert.Equal(t, UsageTotals{}, usage.Totals)
	assert.Equal(t, failureSourcePerfMetrics, usage.DataSource.FailureSource)
}

func TestGetUsageDimensionAggregates(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	t.Run("token dimension", func(t *testing.T) {
		usage, err := GetUsage(Range7d, 0, 0, "token", "", "day", 0, now)
		require.NoError(t, err)
		require.Len(t, usage.Rows, 2)

		byKey := map[string]UsageRow{}
		for _, row := range usage.Rows {
			byKey[row.Key] = row
		}
		first := byKey["1"]
		assert.Equal(t, "key-a", first.Label)
		assert.Equal(t, int64(1), first.Calls)
		assert.Equal(t, int64(100), first.PromptTokens)
		assert.Equal(t, int64(200), first.CompletionTokens)
		assert.Equal(t, int64(300), first.TotalTokens)
		assert.Equal(t, int64(50), first.CachedTokens)
		assert.Equal(t, int64(500000), first.Quota)
		assert.Equal(t, 1.0, first.CostUsd)
		assert.Equal(t, 3000.0, first.AverageLatencyMs)
		assert.Equal(t, 120.0, first.AverageTtftMs)

		second := byKey["2"]
		assert.Equal(t, "key-b", second.Label)
		assert.Equal(t, int64(2), second.Calls)
		assert.Equal(t, int64(40), second.TotalTokens)
		assert.Equal(t, int64(500000), second.Quota)
		assert.Equal(t, 1500.0, second.AverageLatencyMs)
		assert.Equal(t, 80.0, second.AverageTtftMs)
		assert.Equal(t, int64(1), second.FailureCalls)
		assert.Equal(t, int64(1), second.SuccessCalls)

		assert.Equal(t, UsageTotals{Calls: 3, TotalTokens: 340, Quota: 1000000, CostUsd: 2}, usage.Totals)
	})

	t.Run("channel dimension joins names", func(t *testing.T) {
		usage, err := GetUsage(Range7d, 0, 0, "channel", "", "day", 0, now)
		require.NoError(t, err)
		require.Len(t, usage.Rows, 2)
		assert.Equal(t, "claude-ch", usage.Rows[0].Label)
		assert.Equal(t, "11", usage.Rows[0].Key)
		assert.Equal(t, "openai-ch", usage.Rows[1].Label)
	})

	t.Run("channel type dimension resolves provider names", func(t *testing.T) {
		usage, err := GetUsage(Range7d, 0, 0, "channel_type", "", "day", 0, now)
		require.NoError(t, err)
		require.Len(t, usage.Rows, 2)
		labels := []string{usage.Rows[0].Label, usage.Rows[1].Label}
		assert.ElementsMatch(t, []string{"OpenAI", "Anthropic"}, labels)
	})

	t.Run("model dimension", func(t *testing.T) {
		usage, err := GetUsage(Range7d, 0, 0, "model", "", "day", 0, now)
		require.NoError(t, err)
		require.Len(t, usage.Rows, 2)
		assert.Equal(t, "claude-3", usage.Rows[0].Key)
		assert.Equal(t, int64(40), usage.Rows[0].TotalTokens)
	})

	t.Run("group dimension uses reserved column", func(t *testing.T) {
		usage, err := GetUsage(Range7d, 0, 0, "group", "", "day", 0, now)
		require.NoError(t, err)
		require.Len(t, usage.Rows, 2)
		keys := []string{usage.Rows[0].Key, usage.Rows[1].Key}
		assert.ElementsMatch(t, []string{"default", "vip"}, keys)
	})
}

func TestGetUsageTrendBuckets(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	daily, err := GetUsage(Range7d, 0, 0, "token", "", "day", 0, now)
	require.NoError(t, err)
	require.Len(t, daily.Trend, 1, "同一天的 3 条日志落在同一个日桶")
	assert.Equal(t, int64(3), daily.Trend[0].Calls)
	assert.Equal(t, int64(340), daily.Trend[0].TotalTokens)
	assert.Equal(t, int64(1000000), daily.Trend[0].Quota)
	assert.Equal(t, int64(1), daily.Trend[0].FailureCalls)

	hourly, err := GetUsage(Range7d, 0, 0, "token", "", "hour", 0, now)
	require.NoError(t, err)
	assert.Len(t, hourly.Trend, 3, "24h 内按小时分桶应得到 3 个桶")
	total := int64(0)
	for _, point := range hourly.Trend {
		total += point.Calls
	}
	assert.Equal(t, int64(3), total)
}

// 用量分析页的 token 维度必须与仪表盘 Top 排行同口径：名字取 tokens 表的当前名，
// 同一 token 改名后不得因历史名拆成多行，tokens 表查不到时才回退历史名。
// 夹具 setupTopTokenFixture 里 token 4 有两批不同 token_name（改名前后各一条）
// 且 tokens 表给出当前名，token 9 在日志里有名字但 tokens 表没有对应行。
func TestGetUsageTokenLabelUsesCurrentName(t *testing.T) {
	_, now := setupTopTokenFixture(t)
	withErrorLog(t, true)

	usage, err := GetUsage(Range7d, 0, 0, "token", "", "day", 0, now)
	require.NoError(t, err)

	byKey := map[string]UsageRow{}
	for _, row := range usage.Rows {
		byKey[row.Key] = row
	}
	require.Len(t, byKey, 2, "同一 token_id 改名后只能聚合出一行")

	// ① tokens 表有当前名：显示当前名而非任一历史名。
	current := byKey["4"]
	assert.Equal(t, "mac | Hermes | OpenAI", current.Label)
	assert.Equal(t, int64(2), current.Calls, "改名前后两批日志必须合并计数")
	assert.Equal(t, int64(3000), current.TotalTokens)

	// ② tokens 表查不到该 id：回退到日志里的历史名，不得留空。
	fallback := byKey["9"]
	assert.Equal(t, "bulk-key", fallback.Label)
	assert.Equal(t, int64(3), fallback.Calls)
}

func TestGetUsageMatrix(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, false)

	usage, err := GetUsage(Range7d, 0, 0, "token", "token_model", "day", 0, now)
	require.NoError(t, err)
	require.NotNil(t, usage.Matrix)
	assert.Len(t, usage.Matrix.Cells, 2)

	// 先按总 token 倒序出现，故单元格按热度排列。
	assert.ElementsMatch(t, []string{"1", "2"}, usage.Matrix.XLabels)
	assert.Equal(t, []string{"gpt-4o", "claude-3"}, usage.Matrix.YLabels)

	cell := usage.Matrix.Cells[0]
	assert.Equal(t, 0, cell.X)
	assert.Equal(t, 0, cell.Y)
	assert.Equal(t, int64(1), cell.Calls)
	assert.Equal(t, int64(300), cell.TotalTokens)
	assert.Equal(t, int64(500000), cell.Quota)
}

func TestGetUsageRejectsUnknownDimensionAndMatrix(t *testing.T) {
	setupDB(t)
	_, err := GetUsage(Range7d, 0, 0, "nope", "", "day", 0, testNow())
	require.Error(t, err)
	_, err = GetUsage(Range7d, 0, 0, "token", "nope", "day", 0, testNow())
	require.Error(t, err)
	_, err = GetUsage(RangeCustom, 0, 0, "token", "", "day", 0, testNow())
	require.Error(t, err)
}
