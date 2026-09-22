package observability

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	obs "github.com/QuantumNous/new-api/service/observability"

	"github.com/gin-gonic/gin"
)

// GetUsage 返回用量分析的多维聚合、趋势与可选热力矩阵。
func GetUsage(c *gin.Context) {
	rangeName, start, end := parseTimeRange(c)
	filters := parseFilters(c)
	dimension := strings.TrimSpace(c.Query("dimension"))
	matrix := strings.TrimSpace(c.Query("matrix"))
	granularity := strings.ToLower(strings.TrimSpace(c.Query("granularity")))

	usage, err := obs.GetUsage(rangeName, start, end, dimension, matrix, granularity, filters.Limit, requestNow(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, usage)
}
