package observability

import (
	"strconv"
	"strings"
	"time"

	obs "github.com/QuantumNous/new-api/service/observability"

	"github.com/gin-gonic/gin"
)

// parseTimeRange 读取 range / start / end（unix 秒）。
func parseTimeRange(c *gin.Context) (string, int64, int64) {
	start, _ := strconv.ParseInt(c.Query("start"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end"), 10, 64)
	return strings.TrimSpace(c.Query("range")), start, end
}

// parseFilters 读取请求监控 / 用量分析共用的筛选参数。
// 传参与响应用户输入无关的非法值一律按默认值处理，避免 500。
func parseFilters(c *gin.Context) obs.Filters {
	filters := obs.Filters{
		ModelName: strings.TrimSpace(c.Query("model_name")),
		Group:     strings.TrimSpace(c.Query("group")),
		Keyword:   strings.TrimSpace(c.Query("keyword")),
		Sort:      strings.TrimSpace(c.Query("sort")),
		Order:     strings.ToLower(strings.TrimSpace(c.Query("order"))),
	}
	filters.TokenId, _ = strconv.Atoi(c.Query("token_id"))
	filters.ChannelId, _ = strconv.Atoi(c.Query("channel_id"))
	filters.ChannelType, _ = strconv.Atoi(c.Query("channel_type"))
	filters.Page, _ = strconv.Atoi(c.Query("page"))
	filters.PageSize, _ = strconv.Atoi(c.Query("page_size"))
	filters.Limit, _ = strconv.Atoi(c.Query("limit"))
	filters.OnlyFailed, _ = strconv.ParseBool(c.Query("only_failed"))
	if raw := c.Query("is_stream"); raw != "" {
		if value, err := strconv.ParseBool(raw); err == nil {
			filters.IsStream = &value
		}
	}
	if filters.Order != "asc" {
		filters.Order = "desc"
	}
	return filters
}

func requestNow(c *gin.Context) time.Time {
	return time.Now()
}
