package observability

import (
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	obs "github.com/QuantumNous/new-api/service/observability"

	"github.com/gin-gonic/gin"
)

// GetRequests 返回请求监控明细（分页 + 筛选 + 失败标注 + 重试链）。
func GetRequests(c *gin.Context) {
	rangeName, start, end := parseTimeRange(c)
	page, err := obs.GetRequests(rangeName, start, end, parseFilters(c), requestNow(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

// ExportRequests 导出当前筛选结果（CSV 默认，JSON 可选，上限 50000 行）。
// 导出内容不含任何密钥、请求/响应正文，也不含 user_id 之外的用户标识。
func ExportRequests(c *gin.Context) {
	rangeName, start, end := parseTimeRange(c)
	filters := parseFilters(c)
	limit, _ := strconv.Atoi(c.Query("limit"))
	exported, err := obs.GetExportRequests(rangeName, start, end, filters, limit, requestNow(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	rangeLabel := exported.Range.Range
	if rangeLabel == "" {
		rangeLabel = obs.Range24h
	}
	timestamp := time.Unix(exported.Range.End, 0).UTC().Format("20060102T150405Z")
	format := strings.ToLower(strings.TrimSpace(c.Query("format")))
	if format == "json" {
		c.Header("Content-Disposition", `attachment; filename="newapi-observability-`+rangeLabel+`-`+timestamp+`.json"`)
		common.ApiSuccess(c, exported)
		return
	}

	c.Header("Content-Disposition", `attachment; filename="newapi-observability-`+rangeLabel+`-`+timestamp+`.csv"`)
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Status(200)
	// Excel 需要 UTF-8 BOM 才能正确识别中文列名；此处用转义写法，源码内不得出现 BOM 字符。
	c.Writer.WriteString("\ufeff")
	if err := writeRequestsCSV(c.Writer, exported.Rows); err != nil {
		common.SysError("observability: 导出 CSV 失败: " + err.Error())
	}
}

func writeRequestsCSV(writer gin.ResponseWriter, rows []obs.RequestItem) error {
	if _, err := writer.WriteString(strings.Join(csvHeader, ",") + "\n"); err != nil {
		return err
	}
	for _, row := range rows {
		record := []string{
			strconv.Itoa(row.Id),
			strconv.FormatInt(row.CreatedAt, 10),
			row.RequestId,
			strconv.Itoa(row.TokenId),
			row.TokenName,
			strconv.Itoa(row.ChannelId),
			row.ChannelName,
			strconv.Itoa(row.ChannelType),
			row.ModelName,
			row.Group,
			strconv.Itoa(row.Quota),
			strconv.Itoa(row.PromptTokens),
			strconv.Itoa(row.CompletionTokens),
			strconv.Itoa(row.TotalTokens),
			strconv.Itoa(row.CachedTokens),
			strconv.FormatInt(row.UseTimeMs, 10),
			strconv.FormatInt(row.TtftMs, 10),
			strconv.FormatBool(row.IsStream),
			strconv.FormatBool(row.IsFailed),
			failureStatusCode(row),
			strings.Join(strings.Fields(failureSummary(row)), " "),
		}
		escaped := make([]string, 0, len(record))
		for _, value := range record {
			escaped = append(escaped, escapeCSVField(value))
		}
		if _, err := writer.WriteString(strings.Join(escaped, ",") + "\n"); err != nil {
			return err
		}
	}
	return nil
}

var csvHeader = []string{
	"id", "created_at", "request_id",
	"token_id", "token_name",
	"channel_id", "channel_name", "channel_type",
	"model_name", "group",
	"quota", "prompt_tokens", "completion_tokens", "total_tokens", "cached_tokens",
	"use_time_ms", "ttft_ms", "is_stream",
	"is_failed", "fail_status_code", "fail_summary",
}

// escapeCSVField 处理逗号、引号、换行与前导公式字符（CSV 注入防护）。
func escapeCSVField(value string) string {
	if needsFormulaGuard(value) {
		value = "'" + value
	}
	if !strings.ContainsAny(value, ",\"\n\r") {
		return value
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func needsFormulaGuard(value string) bool {
	if value == "" {
		return false
	}
	return strings.ContainsRune("=+-@\t\r", rune(value[0]))
}

func failureStatusCode(row obs.RequestItem) string {
	if row.FailStatusCode == nil {
		return ""
	}
	return strconv.Itoa(*row.FailStatusCode)
}

func failureSummary(row obs.RequestItem) string {
	if row.FailSummary == nil {
		return ""
	}
	return *row.FailSummary
}
