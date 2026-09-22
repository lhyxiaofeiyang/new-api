package observability

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 测试固定「现在」，让分桶结果可精确断言。
func testNow() time.Time {
	return time.Date(2026, 9, 20, 12, 0, 0, 0, time.Local)
}

type logRow struct {
	createdAt        int64
	logType          int
	requestId        string
	tokenId          int
	tokenName        string
	channelId        int
	modelName        string
	group            string
	promptTokens     int
	completionTokens int
	quota            int
	useTime          int
	isStream         bool
	content          string
	other            string
}

func insertLog(t *testing.T, db *gorm.DB, row logRow) {
	t.Helper()
	require.NoError(t, db.Table("logs").Create(map[string]any{
		"created_at":        row.createdAt,
		"type":              row.logType,
		"request_id":        row.requestId,
		"token_id":          row.tokenId,
		"token_name":        row.tokenName,
		"channel_id":        row.channelId,
		"model_name":        row.modelName,
		"group":             row.group,
		"prompt_tokens":     row.promptTokens,
		"completion_tokens": row.completionTokens,
		"quota":             row.quota,
		"use_time":          row.useTime,
		"is_stream":         row.isStream,
		"content":           row.content,
		"other":             row.other,
	}).Error)
}

// setupDB 用临时 SQLite 建日志表、渠道表与 perf_metrics 表，并注入 model.LOG_DB / model.DB。
// perf_metrics 属于主库（model.DB），降级口径需要它才能被读出。
func setupDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "observability.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.PerfMetric{}))
	require.NoError(t, db.Exec(`CREATE TABLE channels (
		id INTEGER PRIMARY KEY,
		name TEXT,
		type INTEGER
	)`).Error)

	previousLogDB := model.LOG_DB
	previousDB := model.DB
	model.LOG_DB = db
	model.DB = db
	t.Cleanup(func() {
		model.LOG_DB = previousLogDB
		model.DB = previousDB
	})
	return db
}

// setupFixture 构造 3 条消费日志 + 1 条错误日志，覆盖两个令牌、两个渠道、
// 两个模型与两个分组。
func setupFixture(t *testing.T) (*gorm.DB, time.Time) {
	t.Helper()
	db := setupDB(t)
	now := testNow()
	hoursAgo := func(h int) int64 { return now.Add(-time.Duration(h) * time.Hour).Unix() }

	require.NoError(t, db.Table("channels").Create(map[string]any{"id": 10, "name": "openai-ch", "type": 1}).Error)
	require.NoError(t, db.Table("channels").Create(map[string]any{"id": 11, "name": "claude-ch", "type": 14}).Error)

	insertLog(t, db, logRow{
		createdAt: hoursAgo(3), logType: model.LogTypeConsume, requestId: "req-1",
		tokenId: 1, tokenName: "key-a", channelId: 10, modelName: "gpt-4o", group: "default",
		promptTokens: 100, completionTokens: 200, quota: 500000, useTime: 3, isStream: true,
		other: `{"cache_tokens":50,"cache_ratio":0.5,"frt":120,"model_price":0.5,` +
			`"request_policy":[{"channel_id":10,"elapsed_ms":10,"decision":{"action":"retry"}},` +
			`{"channel_id":11,"elapsed_ms":40,"decision":{"action":"stop"}}]}`,
	})
	insertLog(t, db, logRow{
		createdAt: hoursAgo(2), logType: model.LogTypeConsume, requestId: "req-2",
		tokenId: 2, tokenName: "key-b", channelId: 11, modelName: "claude-3", group: "vip",
		promptTokens: 10, completionTokens: 20, quota: 500000, useTime: 2,
		other: `{"frt":80}`,
	})
	insertLog(t, db, logRow{
		createdAt: hoursAgo(1), logType: model.LogTypeConsume, requestId: "req-3",
		tokenId: 2, tokenName: "key-b", channelId: 11, modelName: "claude-3", group: "vip",
		promptTokens: 5, completionTokens: 5, useTime: 1,
		other: `{}`,
	})
	insertLog(t, db, logRow{
		createdAt: now.Add(-90 * time.Minute).Unix(), logType: model.LogTypeError, requestId: "req-2",
		tokenId: 2, tokenName: "key-b", channelId: 11, modelName: "claude-3", group: "vip",
		content: "upstream 500", other: `{"status_code":500,"error_code":"upstream_error"}`,
	})
	return db, now
}

// withErrorLog 临时打开错误日志开关，返回恢复函数。
func withErrorLog(t *testing.T, enabled bool) {
	t.Helper()
	previous := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = enabled
	t.Cleanup(func() { constant.ErrorLogEnabled = previous })
}
