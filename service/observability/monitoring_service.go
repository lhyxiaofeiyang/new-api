package observability

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"gorm.io/gorm"
)

const (
	defaultPageSize = 20
	maxPageSize     = 500
	// MaxExportRows 是导出接口（CSV/JSON）的行数上限。
	MaxExportRows = 50000
)

// monitoringRow 是请求明细的行投影（含 other/content 供 Go 侧解析）。
type monitoringRow struct {
	Id               int    `gorm:"column:id"`
	CreatedAt        int64  `gorm:"column:created_at"`
	RequestId        string `gorm:"column:request_id"`
	TokenId          int    `gorm:"column:token_id"`
	TokenName        string `gorm:"column:token_name"`
	ChannelId        int    `gorm:"column:channel_id"`
	ChannelName      string `gorm:"column:channel_name"`
	ChannelType      int    `gorm:"column:channel_type"`
	ModelName        string `gorm:"column:model_name"`
	Group            string `gorm:"column:group"`
	UserId           int    `gorm:"column:user_id"`
	Username         string `gorm:"column:username"`
	Quota            int    `gorm:"column:quota"`
	PromptTokens     int    `gorm:"column:prompt_tokens"`
	CompletionTokens int    `gorm:"column:completion_tokens"`
	UseTime          int    `gorm:"column:use_time"`
	IsStream         bool   `gorm:"column:is_stream"`
	Other            string `gorm:"column:other"`
	Content          string `gorm:"column:content"`
}

type requestAggregateRow struct {
	Calls        int64 `gorm:"column:calls"`
	TotalTokens  int64 `gorm:"column:total_tokens"`
	Quota        int64 `gorm:"column:quota"`
	LatencySum   int64 `gorm:"column:latency_sum"`
	LatencyCount int64 `gorm:"column:latency_count"`
}

// failureRow 是错误日志中用于标注失败结果的字段。
type failureRow struct {
	CreatedAt int64  `gorm:"column:created_at"`
	RequestId string `gorm:"column:request_id"`
	TokenId   int    `gorm:"column:token_id"`
	ModelName string `gorm:"column:model_name"`
	Content   string `gorm:"column:content"`
	Other     string `gorm:"column:other"`
}

func normalizePaging(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

func monitoringSelect() string {
	group := logGroupColumn()
	return fmt.Sprintf(`logs.id AS id, logs.created_at AS created_at, logs.request_id AS request_id,
	logs.token_id AS token_id, logs.token_name AS token_name,
	logs.channel_id AS channel_id, COALESCE(channels.name, '') AS channel_name, COALESCE(channels.type, 0) AS channel_type,
	logs.model_name AS model_name, logs.%s AS %s, logs.user_id AS user_id, COALESCE(u.username, '') AS username,
	logs.quota AS quota, logs.prompt_tokens AS prompt_tokens, logs.completion_tokens AS completion_tokens,
	logs.use_time AS use_time, logs.is_stream AS is_stream, logs.other AS other, logs.content AS content`,
		group, group)
}

func monitoringBase(r Range, f Filters) *gorm.DB {
	if f.OnlyFailed {
		return errorQuery(r, f)
	}
	return consumeQuery(r, f)
}

func orderClause(f Filters) string {
	column, ok := sortColumns[f.Sort]
	if !ok {
		column = "logs.created_at"
	}
	direction := "DESC"
	if f.Order == "asc" {
		direction = "ASC"
	}
	return column + " " + direction + ", logs.id " + direction
}

// GetRequests 返回请求监控明细（分页 + 筛选 + 失败标注 + 重试链）。
func GetRequests(rangeName string, startRaw, endRaw int64, f Filters, now time.Time) (*RequestPage, error) {
	r, err := resolveRange(rangeName, startRaw, endRaw, Range24h, now)
	if err != nil {
		return nil, err
	}
	page, pageSize := normalizePaging(f.Page, f.PageSize)
	out := &RequestPage{Items: []RequestItem{}, Page: page, PageSize: pageSize}

	if err := monitoringBase(r, f).Count(&out.Total).Error; err != nil {
		common.SysError("observability: 统计请求明细失败: " + err.Error())
		return nil, err
	}

	var aggregate requestAggregateRow
	if err := monitoringBase(r, f).
		Select(`COUNT(*) AS calls,
			COALESCE(SUM(logs.prompt_tokens + logs.completion_tokens), 0) AS total_tokens,
			COALESCE(SUM(logs.quota), 0) AS quota,
			COALESCE(SUM(logs.use_time), 0) AS latency_sum,
			COALESCE(SUM(CASE WHEN logs.use_time > 0 THEN 1 ELSE 0 END), 0) AS latency_count`).
		Scan(&aggregate).Error; err != nil {
		common.SysError("observability: 汇总请求明细失败: " + err.Error())
		return nil, err
	}
	out.Aggregate = Aggregate{
		Calls:            aggregate.Calls,
		TotalTokens:      aggregate.TotalTokens,
		Quota:            aggregate.Quota,
		AverageLatencyMs: averageMs(aggregate.LatencySum*1000, aggregate.LatencyCount),
	}

	rows := []monitoringRow{}
	err = monitoringBase(r, f).
		Select(monitoringSelect()).
		Order(orderClause(f)).
		Limit(pageSize).
		Offset((page - 1) * pageSize).
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 读取请求明细失败: " + err.Error())
		return nil, err
	}
	out.Items = buildRequestItems(rows, r, f.OnlyFailed)
	return out, nil
}

// GetExportRequests 返回导出用的明细行（不含分页，受 MaxExportRows 约束）。
func GetExportRequests(rangeName string, startRaw, endRaw int64, f Filters, limit int, now time.Time) (*ExportRequest, error) {
	r, err := resolveRange(rangeName, startRaw, endRaw, Range24h, now)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > MaxExportRows {
		limit = MaxExportRows
	}
	out := &ExportRequest{Rows: []RequestItem{}, Range: r}

	if err := monitoringBase(r, f).Count(&out.Total).Error; err != nil {
		common.SysError("observability: 统计导出范围失败: " + err.Error())
		return nil, err
	}
	rows := []monitoringRow{}
	err = monitoringBase(r, f).
		Select(monitoringSelect()).
		Order(orderClause(f)).
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 读取导出明细失败: " + err.Error())
		return nil, err
	}
	out.Rows = buildRequestItems(rows, r, f.OnlyFailed)
	out.Truncated = out.Total > int64(len(out.Rows))
	out.DataSource = DataSource{
		ErrorLogEnabled: constant.ErrorLogEnabled,
		FailureSource:   failureSource(),
		LogRows:         int64(len(out.Rows)),
	}
	return out, nil
}

func failureSource() string {
	if constant.ErrorLogEnabled {
		return failureSourceErrorLog
	}
	return failureSourcePerfMetrics
}

// buildRequestItems 把行投影转换为 API 明细，并补齐 other 中的派生字段。
// 失败明细是跨表按 key 关联的（无共享主键）。
func buildRequestItems(rows []monitoringRow, r Range, rowsAreFailures bool) []RequestItem {
	items := make([]RequestItem, 0, len(rows))
	if len(rows) == 0 {
		return items
	}
	byRequestId, byFallback := map[string]failureInfo{}, map[string]failureInfo{}
	if !rowsAreFailures && constant.ErrorLogEnabled {
		byRequestId, byFallback = loadFailureIndex(r)
	}
	for _, row := range rows {
		other := parseOther(row.Other)
		item := RequestItem{
			Id:               row.Id,
			CreatedAt:        row.CreatedAt,
			RequestId:        row.RequestId,
			TokenId:          row.TokenId,
			TokenName:        row.TokenName,
			ChannelId:        row.ChannelId,
			ChannelName:      row.ChannelName,
			ChannelType:      row.ChannelType,
			ModelName:        row.ModelName,
			Group:            row.Group,
			UserId:           row.UserId,
			Username:         row.Username,
			Quota:            row.Quota,
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			TotalTokens:      row.PromptTokens + row.CompletionTokens,
			UseTimeMs:        int64(row.UseTime) * 1000,
			IsStream:         row.IsStream,
			RetryChain:       retryChainFromOther(other),
			CacheRatio:       otherFloat(other["cache_ratio"]),
			CachedTokens:     int(otherInt64(other["cache_tokens"])),
			TtftMs:           otherInt64(other["frt"]),
		}
		var failure failureInfo
		if rowsAreFailures {
			failure = failureInfoFromLog(parseOther(row.Other), row.Content)
		} else if info, ok := byRequestId[row.RequestId]; ok && row.RequestId != "" {
			failure = info
		} else if info, ok := byFallback[failureFallbackKey(row.CreatedAt, row.TokenId, row.ModelName)]; ok {
			failure = info
		}
		if failure.found {
			item.IsFailed = true
			item.FailStatusCode = failure.statusCode
			item.FailSummary = failure.summary
		}
		items = append(items, item)
	}
	return items
}

type failureInfo struct {
	found      bool
	statusCode *int
	summary    *string
}

func failureFallbackKey(createdAt int64, tokenId int, modelName string) string {
	return fmt.Sprintf("%d|%d|%s", createdAt, tokenId, modelName)
}

// loadFailureIndex 一次性载入区间内的错误日志并按 request_id / 兜底键建索引，
// 避免逐行查询。
func loadFailureIndex(r Range) (map[string]failureInfo, map[string]failureInfo) {
	byRequestId := map[string]failureInfo{}
	byFallback := map[string]failureInfo{}
	rows := []failureRow{}
	err := errorQuery(r, Filters{}).
		Select("logs.created_at AS created_at, logs.request_id AS request_id, logs.token_id AS token_id, logs.model_name AS model_name, logs.content AS content, logs.other AS other").
		Order("logs.created_at DESC, logs.id DESC").
		Scan(&rows).Error
	if err != nil {
		common.SysError("observability: 读取失败明细失败: " + err.Error())
		return byRequestId, byFallback
	}
	for _, row := range rows {
		other := parseOther(row.Other)
		info := failureInfoFromLog(other, row.Content)
		if !info.found {
			continue
		}
		if row.RequestId != "" {
			if _, exists := byRequestId[row.RequestId]; !exists {
				byRequestId[row.RequestId] = info
			}
		}
		key := failureFallbackKey(row.CreatedAt, row.TokenId, row.ModelName)
		if _, exists := byFallback[key]; !exists {
			byFallback[key] = info
		}
	}
	return byRequestId, byFallback
}

// failureInfoFromLog 从错误日志的 other.status_code 与已脱敏 content 提取失败摘要。
func failureInfoFromLog(other map[string]any, content string) failureInfo {
	info := failureInfo{found: true}
	if code, ok := numericToInt64(other["status_code"]); ok {
		value := int(code)
		info.statusCode = &value
	}
	if content != "" {
		summary := content
		info.summary = &summary
	}
	return info
}
