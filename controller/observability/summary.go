package observability

import (
	"github.com/QuantumNous/new-api/common"
	obs "github.com/QuantumNous/new-api/service/observability"

	"github.com/gin-gonic/gin"
)

// GetSummary 返回仪表盘首屏的聚合数据。
func GetSummary(c *gin.Context) {
	rangeName, start, end := parseTimeRange(c)
	summary, err := obs.GetSummary(rangeName, start, end, requestNow(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}
