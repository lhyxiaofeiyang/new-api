package observability

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// 时间区间按服务端本地时区解释：unix 秒入参，unix 秒出参。
const (
	RangeToday  = "today"
	Range24h    = "24h"
	Range7d     = "7d"
	Range30d    = "30d"
	RangeCustom = "custom"

	// maxRangeSeconds 是单次查询允许的最大区间长度。请求监控/用量分析都支持
	// 任意自定义区间，缺省上限可以避免聚合结果无界膨胀。
	maxRangeSeconds = 366 * 24 * 3600

	// hourGranularityMaxSpan 超过该区间时强制按天分桶，避免小时级序列过长。
	hourGranularityMaxSpan = 31 * 24 * 3600

	// healthBuckets/healthBucketSeconds 固定 10 分钟 × 144 = 24 小时。
	healthBuckets       = 144
	healthBucketSeconds = 600
)

// resolveRange 把 range 关键字或 custom 区间解析为左闭右开的 unix 秒区间。
func resolveRange(rangeName string, startRaw, endRaw int64, def string, now time.Time) (Range, error) {
	if rangeName == "" {
		rangeName = def
	}
	local := now.Local()
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	resolved := Range{Range: rangeName}
	switch rangeName {
	case RangeToday:
		resolved.Start, resolved.End = midnight.Unix(), now.Unix()
	case Range24h:
		resolved.End = now.Unix()
		resolved.Start = resolved.End - 24*3600
	case Range7d:
		resolved.Start, resolved.End = midnight.AddDate(0, 0, -6).Unix(), now.Unix()
	case Range30d:
		resolved.Start, resolved.End = midnight.AddDate(0, 0, -29).Unix(), now.Unix()
	case RangeCustom:
		if startRaw <= 0 || endRaw <= 0 {
			return resolved, errors.New("range=custom 时必须提供 start 与 end")
		}
		resolved.Start, resolved.End = startRaw, endRaw
	default:
		return resolved, fmt.Errorf("不支持的 range: %s", rangeName)
	}
	if resolved.End <= resolved.Start {
		return resolved, errors.New("end 必须晚于 start")
	}
	if resolved.End-resolved.Start > maxRangeSeconds {
		return resolved, errors.New("时间区间不得超过 366 天")
	}
	return resolved, nil
}

// Filters 是请求监控与用量分析共用的筛选条件。
type Filters struct {
	TokenId     int
	ChannelId   int
	ChannelType int
	ModelName   string
	Group       string
	IsStream    *bool
	OnlyFailed  bool
	Keyword     string
	Limit       int
	Page        int
	PageSize    int
	Sort        string
	Order       string
}

// logGroupColumn 返回 logs.group 在当前日志数据库方言下的安全引用形式。
func logGroupColumn() string {
	if common.UsingLogDatabase(common.DatabaseTypePostgreSQL) {
		return `"group"`
	}
	return "`group`"
}

// likeContains 转义 LIKE 元字符后构造包含匹配模式，配合 ESCAPE '!' 使用。
func likeContains(value string) string {
	escaped := strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(value)
	return "%" + escaped + "%"
}

// sortColumns 是请求明细允许的排序字段白名单。
var sortColumns = map[string]string{
	"created_at":   "logs.created_at",
	"quota":        "logs.quota",
	"use_time":     "logs.use_time",
	"total_tokens": "(logs.prompt_tokens + logs.completion_tokens)",
}

// consumeQuery 构造消费日志的基础查询（含渠道 LEFT JOIN，渠道名只能来自 channels）。
func consumeQuery(r Range, f Filters) *gorm.DB {
	q := model.LOG_DB.Table("logs").
		Joins("LEFT JOIN channels ON channels.id = logs.channel_id").
		Where("logs.type = ?", model.LogTypeConsume).
		Where("logs.created_at >= ? AND logs.created_at < ?", r.Start, r.End)
	return applyFilters(q, f)
}

// errorQuery 构造错误日志的基础查询。
func errorQuery(r Range, f Filters) *gorm.DB {
	q := model.LOG_DB.Table("logs").
		Joins("LEFT JOIN channels ON channels.id = logs.channel_id").
		Where("logs.type = ?", model.LogTypeError).
		Where("logs.created_at >= ? AND logs.created_at < ?", r.Start, r.End)
	return applyFilters(q, f)
}

func applyFilters(q *gorm.DB, f Filters) *gorm.DB {
	if f.TokenId != 0 {
		q = q.Where("logs.token_id = ?", f.TokenId)
	}
	if f.ChannelId != 0 {
		q = q.Where("logs.channel_id = ?", f.ChannelId)
	}
	if f.ChannelType != 0 {
		q = q.Where("channels.type = ?", f.ChannelType)
	}
	if f.ModelName != "" {
		q = q.Where("logs.model_name = ?", f.ModelName)
	}
	if f.Group != "" {
		q = q.Where("logs."+logGroupColumn()+" = ?", f.Group)
	}
	if f.IsStream != nil {
		q = q.Where("logs.is_stream = ?", *f.IsStream)
	}
	if f.Keyword != "" {
		pattern := likeContains(f.Keyword)
		q = q.Where("(logs.token_name LIKE ? ESCAPE '!' OR logs.model_name LIKE ? ESCAPE '!')", pattern, pattern)
	}
	return q
}

// keyString 把不同驱动返回的分组键（数值或字节串）统一成字符串。
func keyString(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case []byte:
		return string(v)
	case int64:
		return fmt.Sprintf("%d", v)
	case float64:
		return fmt.Sprintf("%d", int64(v))
	default:
		return fmt.Sprintf("%v", v)
	}
}

// bucketStart 把 unix 秒对齐到 epoch 对齐的桶起点。
func bucketStart(ts int64, size int64) int64 {
	if size <= 0 {
		return ts
	}
	if ts < 0 {
		return -(((-ts + size - 1) / size) * size)
	}
	return (ts / size) * size
}

// trafficBucketSeconds 按区间长度选择流量趋势的桶大小。
func trafficBucketSeconds(span int64) int64 {
	if span <= 48*3600 {
		return 3600
	}
	return 86400
}

// trendBucketSeconds 把 granularity 归一化为桶大小。
func trendBucketSeconds(granularity string, span int64) int64 {
	if granularity == "hour" && span <= hourGranularityMaxSpan {
		return 3600
	}
	return 86400
}
