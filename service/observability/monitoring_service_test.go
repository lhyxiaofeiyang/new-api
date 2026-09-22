package observability

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestsEmptyDatabase(t *testing.T) {
	setupDB(t)
	withErrorLog(t, false)

	page, err := GetRequests(Range24h, 0, 0, Filters{}, testNow())
	require.NoError(t, err)

	assert.Empty(t, page.Items)
	assert.Equal(t, int64(0), page.Total)
	assert.Equal(t, 1, page.Page)
	assert.Equal(t, defaultPageSize, page.PageSize)
	assert.Equal(t, Aggregate{}, page.Aggregate)
}

func TestGetRequestsIncludesOtherDerivedFields(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	page, err := GetRequests(Range24h, 0, 0, Filters{}, now)
	require.NoError(t, err)
	require.Len(t, page.Items, 3)
	assert.Equal(t, int64(3), page.Total)
	assert.Equal(t, Aggregate{
		Calls:            3,
		TotalTokens:      340,
		Quota:            1000000,
		AverageLatencyMs: 2000,
	}, page.Aggregate)

	// 默认按 created_at 倒序：req-3 最新。
	items := map[string]RequestItem{}
	for _, item := range page.Items {
		items[item.RequestId] = item
	}

	first := items["req-1"]
	assert.Equal(t, 10, first.ChannelId)
	assert.Equal(t, "openai-ch", first.ChannelName)
	assert.Equal(t, 1, first.ChannelType)
	assert.Equal(t, "gpt-4o", first.ModelName)
	assert.Equal(t, "default", first.Group)
	// 用户列来自 users JOIN（username 必须一并返回）。
	assert.Equal(t, 1, first.UserId)
	assert.Equal(t, "root", first.Username)
	assert.Equal(t, 300, first.TotalTokens)
	assert.Equal(t, 50, first.CachedTokens)
	assert.Equal(t, 0.5, first.CacheRatio)
	assert.Equal(t, int64(3000), first.UseTimeMs)
	assert.Equal(t, int64(120), first.TtftMs)
	assert.True(t, first.IsStream)
	assert.Equal(t, []RetryAttempt{
		{Index: 0, ChannelId: 10, ElapsedMs: 10, Action: "retry"},
		{Index: 1, ChannelId: 11, ElapsedMs: 40, Action: "stop"},
	}, first.RetryChain)
	assert.False(t, first.IsFailed)
	assert.Nil(t, first.FailStatusCode)
	assert.Nil(t, first.FailSummary)

	// req-2 有同 request_id 的错误日志，必须被标注为失败。
	failed := items["req-2"]
	assert.True(t, failed.IsFailed)
	require.NotNil(t, failed.FailStatusCode)
	assert.Equal(t, 500, *failed.FailStatusCode)
	require.NotNil(t, failed.FailSummary)
	assert.Equal(t, "upstream 500", *failed.FailSummary)
	assert.Empty(t, failed.RetryChain, "无 request_policy 时重试链为空数组")

	// req-3 无 frt 字段，首字节按 0 返回。
	third := items["req-3"]
	assert.Zero(t, third.TtftMs)
	assert.Zero(t, third.CachedTokens)
	assert.False(t, third.IsStream)
}

func TestGetRequestsFilters(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	t.Run("token filter", func(t *testing.T) {
		page, err := GetRequests(Range24h, 0, 0, Filters{TokenId: 2}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)
	})

	t.Run("channel and type filters", func(t *testing.T) {
		page, err := GetRequests(Range24h, 0, 0, Filters{ChannelId: 10}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(1), page.Total)

		page, err = GetRequests(Range24h, 0, 0, Filters{ChannelType: 14}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)
	})

	t.Run("model and group filters", func(t *testing.T) {
		page, err := GetRequests(Range24h, 0, 0, Filters{ModelName: "claude-3"}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)

		page, err = GetRequests(Range24h, 0, 0, Filters{Group: "vip"}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)
	})

	t.Run("stream filter", func(t *testing.T) {
		stream := true
		page, err := GetRequests(Range24h, 0, 0, Filters{IsStream: &stream}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(1), page.Total)

		notStream := false
		page, err = GetRequests(Range24h, 0, 0, Filters{IsStream: &notStream}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)
	})

	t.Run("keyword matches token or model", func(t *testing.T) {
		page, err := GetRequests(Range24h, 0, 0, Filters{Keyword: "key-b"}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(2), page.Total)

		page, err = GetRequests(Range24h, 0, 0, Filters{Keyword: "gpt"}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(1), page.Total)

		// 用户输入的通配符必须被转义，不能退化为全表匹配。
		page, err = GetRequests(Range24h, 0, 0, Filters{Keyword: "%"}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(0), page.Total)
	})

	t.Run("only failed reads error logs", func(t *testing.T) {
		page, err := GetRequests(Range24h, 0, 0, Filters{OnlyFailed: true}, now)
		require.NoError(t, err)
		assert.Equal(t, int64(1), page.Total)
		require.Len(t, page.Items, 1)
		assert.True(t, page.Items[0].IsFailed)
		assert.Equal(t, "req-2", page.Items[0].RequestId)
		require.NotNil(t, page.Items[0].FailStatusCode)
		assert.Equal(t, 500, *page.Items[0].FailStatusCode)
	})
}

func TestGetRequestsPagingAndSorting(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, false)

	page, err := GetRequests(Range24h, 0, 0, Filters{PageSize: 2, Sort: "quota", Order: "desc"}, now)
	require.NoError(t, err)
	assert.Equal(t, int64(3), page.Total)
	assert.Equal(t, 1, page.Page)
	assert.Equal(t, 2, page.PageSize)
	assert.Len(t, page.Items, 2)
	assert.Equal(t, 500000, page.Items[0].Quota)
	assert.Equal(t, 500000, page.Items[1].Quota)

	second, err := GetRequests(Range24h, 0, 0, Filters{Page: 2, PageSize: 2}, now)
	require.NoError(t, err)
	assert.Len(t, second.Items, 1)
	assert.Equal(t, 2, second.Page)

	// 未列入白名单的排序字段回退到 created_at。
	fallback, err := GetRequests(Range24h, 0, 0, Filters{Sort: "id OR 1=1", Order: "desc"}, now)
	require.NoError(t, err)
	require.Len(t, fallback.Items, 3)
	assert.Equal(t, "req-3", fallback.Items[0].RequestId)

	// 页码/页大小越界时收敛到合法范围。
	clamped, err := GetRequests(Range24h, 0, 0, Filters{Page: 0, PageSize: 100000}, now)
	require.NoError(t, err)
	assert.Equal(t, 1, clamped.Page)
	assert.Equal(t, maxPageSize, clamped.PageSize)
}

func TestGetRequestsTimeRangeBoundaries(t *testing.T) {
	db := setupDB(t)
	withErrorLog(t, false)
	start := testNow().Add(-2 * time.Hour).Unix()
	end := testNow().Add(-1 * time.Hour).Unix()

	// 起点包含、终点不包含。
	insertLog(t, db, logRow{createdAt: start, logType: 2, requestId: "at-start"})
	insertLog(t, db, logRow{createdAt: end - 1, logType: 2, requestId: "just-before-end"})
	insertLog(t, db, logRow{createdAt: end, logType: 2, requestId: "at-end"})
	insertLog(t, db, logRow{createdAt: start - 1, logType: 2, requestId: "before-start"})

	page, err := GetRequests(RangeCustom, start, end, Filters{}, testNow())
	require.NoError(t, err)
	assert.Equal(t, int64(2), page.Total)

	ids := []string{page.Items[0].RequestId, page.Items[1].RequestId}
	assert.ElementsMatch(t, []string{"at-start", "just-before-end"}, ids)
}

func TestGetExportRequests(t *testing.T) {
	_, now := setupFixture(t)
	withErrorLog(t, true)

	t.Run("empty export", func(t *testing.T) {
		exported, err := GetExportRequests(Range24h, 0, 0, Filters{TokenId: 999}, 0, now)
		require.NoError(t, err)
		assert.Empty(t, exported.Rows)
		assert.Equal(t, int64(0), exported.Total)
		assert.False(t, exported.Truncated)
		assert.Equal(t, failureSourceErrorLog, exported.DataSource.FailureSource)
	})

	t.Run("export ignores paging and honours limit", func(t *testing.T) {
		exported, err := GetExportRequests(Range24h, 0, 0, Filters{Page: 5, PageSize: 1}, 0, now)
		require.NoError(t, err)
		assert.Equal(t, int64(3), exported.Total)
		assert.Len(t, exported.Rows, 3, "导出不受 page/page_size 影响")
		assert.False(t, exported.Truncated)

		limited, err := GetExportRequests(Range24h, 0, 0, Filters{}, 2, now)
		require.NoError(t, err)
		assert.Len(t, limited.Rows, 2)
		assert.Equal(t, int64(3), limited.Total)
		assert.True(t, limited.Truncated)

		// 超过导出上限时收敛到 MaxExportRows。
		clamped, err := GetExportRequests(Range24h, 0, 0, Filters{}, MaxExportRows*2, now)
		require.NoError(t, err)
		assert.Len(t, clamped.Rows, 3)
		assert.False(t, clamped.Truncated)
	})

	t.Run("only failed export keeps failure details", func(t *testing.T) {
		exported, err := GetExportRequests(Range24h, 0, 0, Filters{OnlyFailed: true}, 0, now)
		require.NoError(t, err)
		require.Len(t, exported.Rows, 1)
		assert.Equal(t, "req-2", exported.Rows[0].RequestId)
		assert.True(t, exported.Rows[0].IsFailed)
		require.NotNil(t, exported.Rows[0].FailStatusCode)
		assert.Equal(t, 500, *exported.Rows[0].FailStatusCode)
	})

	t.Run("export rejects invalid range", func(t *testing.T) {
		_, err := GetExportRequests(RangeCustom, 0, 0, Filters{}, 0, now)
		require.Error(t, err)
	})
}
