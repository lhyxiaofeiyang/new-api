package observability

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/model"
	obs "github.com/QuantumNous/new-api/service/observability"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	m.Run()
}

// newTestContext 构造带查询串的 gin 上下文，用于驱动控制器而不启动 HTTP 服务。
func newTestContext(t *testing.T, target string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	return c, recorder
}

// newEmptyDB 注入临时 SQLite，让控制器的成功分支能在无远程库条件下跑通。
func newEmptyDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "controller.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.PerfMetric{}))
	require.NoError(t, db.Exec(`CREATE TABLE channels (
		id INTEGER PRIMARY KEY,
		name TEXT,
		type INTEGER
	)`).Error)
	// 请求明细的用户列走 users JOIN，夹具同样需要该表。
	require.NoError(t, db.Exec(`CREATE TABLE users (
		id INTEGER PRIMARY KEY,
		username TEXT,
		quota INTEGER
	)`).Error)
	// Top 令牌的当前名走 tokens JOIN，夹具需要该表；真库 tokens 同样有 key、
	// used_quota 等同名列，这里一并还原，避免漏掉 JOIN 造成的列名歧义。
	require.NoError(t, db.Exec(`CREATE TABLE tokens (
		id INTEGER PRIMARY KEY,
		name TEXT,
		key TEXT,
		used_quota INTEGER
	)`).Error)

	previousLogDB, previousDB := model.LOG_DB, model.DB
	model.LOG_DB, model.DB = db, db
	t.Cleanup(func() {
		model.LOG_DB, model.DB = previousLogDB, previousDB
	})
}

func decodeBody(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	return body
}

func TestParseTimeRange(t *testing.T) {
	tests := []struct {
		name      string
		target    string
		wantRange string
		wantStart int64
		wantEnd   int64
	}{
		{"range only", "/x?range=7d", "7d", 0, 0},
		{"trimmed range", "/x?range=%207d%20", "7d", 0, 0},
		{"explicit bounds", "/x?range=custom&start=100&end=200", "custom", 100, 200},
		{"missing params fall back to zero", "/x", "", 0, 0},
		{"non-numeric bounds are ignored", "/x?start=abc&end=", "", 0, 0},
		{"negative bounds are parsed", "/x?start=-10&end=-1", "", -10, -1},
		{"float bounds are rejected", "/x?start=1.5&end=2.5", "", 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := newTestContext(t, tt.target)
			rangeName, start, end := parseTimeRange(c)
			assert.Equal(t, tt.wantRange, rangeName)
			assert.Equal(t, tt.wantStart, start)
			assert.Equal(t, tt.wantEnd, end)
		})
	}
}

func TestParseFilters(t *testing.T) {
	t.Run("trims text and parses numbers", func(t *testing.T) {
		c, _ := newTestContext(t, "/x?model_name=%20gpt-4o%20&group=%20vip%20&token_id=7&channel_id=10&channel_type=14&page=2&page_size=50&limit=9")
		filters := parseFilters(c)
		assert.Equal(t, "gpt-4o", filters.ModelName)
		assert.Equal(t, "vip", filters.Group)
		assert.Equal(t, 7, filters.TokenId)
		assert.Equal(t, 10, filters.ChannelId)
		assert.Equal(t, 14, filters.ChannelType)
		assert.Equal(t, 2, filters.Page)
		assert.Equal(t, 50, filters.PageSize)
		assert.Equal(t, 9, filters.Limit)
	})

	t.Run("invalid numbers degrade to zero instead of erroring", func(t *testing.T) {
		c, _ := newTestContext(t, "/x?token_id=abc&page=1.5&limit=%20")
		filters := parseFilters(c)
		assert.Zero(t, filters.TokenId)
		assert.Zero(t, filters.Page)
		assert.Zero(t, filters.Limit)
	})

	t.Run("order normalizes to asc or desc", func(t *testing.T) {
		c, _ := newTestContext(t, "/x?order=ASC")
		assert.Equal(t, "asc", parseFilters(c).Order)

		c, _ = newTestContext(t, "/x?order=%20DESC%20")
		assert.Equal(t, "desc", parseFilters(c).Order)

		// 非白名单值一律回落到 desc，避免把用户输入拼进 ORDER BY。
		c, _ = newTestContext(t, "/x?order=id%20OR%201%3D1")
		assert.Equal(t, "desc", parseFilters(c).Order)
	})

	t.Run("is_stream is tri-state", func(t *testing.T) {
		c, _ := newTestContext(t, "/x")
		assert.Nil(t, parseFilters(c).IsStream, "未传时不得当作 false")

		c, _ = newTestContext(t, "/x?is_stream=true")
		require.NotNil(t, parseFilters(c).IsStream)
		assert.True(t, *parseFilters(c).IsStream)

		c, _ = newTestContext(t, "/x?is_stream=false")
		require.NotNil(t, parseFilters(c).IsStream)
		assert.False(t, *parseFilters(c).IsStream)

		c, _ = newTestContext(t, "/x?is_stream=maybe")
		assert.Nil(t, parseFilters(c).IsStream, "非法布尔值必须退化为未传")
	})

	t.Run("only_failed parses boolean", func(t *testing.T) {
		c, _ := newTestContext(t, "/x?only_failed=1")
		assert.True(t, parseFilters(c).OnlyFailed)

		c, _ = newTestContext(t, "/x?only_failed=true")
		assert.True(t, parseFilters(c).OnlyFailed)

		c, _ = newTestContext(t, "/x?only_failed=nope")
		assert.False(t, parseFilters(c).OnlyFailed)
	})
}

func TestGetSummaryResponseEnvelope(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/summary?range=24h")
	GetSummary(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	body := decodeBody(t, recorder)
	assert.Equal(t, true, body["success"])
	assert.Equal(t, "", body["message"])

	data, ok := body["data"].(map[string]any)
	require.True(t, ok, "data 必须是对象")
	assert.Contains(t, data, "summary")
	assert.Contains(t, data, "data_source")
	assert.Contains(t, data, "health_timeline")
	assert.Len(t, data["hourly_activity"], 24)
}

func TestGetSummaryWrapsErrors(t *testing.T) {
	newEmptyDB(t)

	// custom 区间缺少 start/end 时必须走 ApiError 分支，而不是 500 或空响应。
	c, recorder := newTestContext(t, "/api/observability/summary?range=custom")
	GetSummary(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	body := decodeBody(t, recorder)
	assert.Equal(t, false, body["success"])
	assert.NotEmpty(t, body["message"])
	assert.NotContains(t, body, "data")
}

func TestGetRequestsResponseEnvelope(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/requests?range=24h&page=0&page_size=100000")
	GetRequests(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	body := decodeBody(t, recorder)
	assert.Equal(t, true, body["success"])

	data, ok := body["data"].(map[string]any)
	require.True(t, ok)
	// 越界分页由 service 层收敛，控制器原样透传。
	assert.EqualValues(t, 1, data["page"])
	assert.EqualValues(t, 500, data["page_size"])
}

func TestGetRequestsWrapsErrors(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/requests?range=custom&start=100")
	GetRequests(c)

	body := decodeBody(t, recorder)
	assert.Equal(t, false, body["success"])
	assert.NotEmpty(t, body["message"])
}

func TestGetUsageResponseEnvelope(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/usage?range=24h&dimension=token")
	GetUsage(c)

	body := decodeBody(t, recorder)
	assert.Equal(t, true, body["success"])
	data, ok := body["data"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, data, "rows")
	assert.Contains(t, data, "totals")
}

func TestGetUsageWrapsUnknownDimension(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/usage?range=24h&dimension=nope")
	GetUsage(c)

	body := decodeBody(t, recorder)
	assert.Equal(t, false, body["success"])
	assert.NotEmpty(t, body["message"])
}

func TestExportRequestsCSV(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/requests/export?range=24h")
	ExportRequests(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "text/csv; charset=utf-8", recorder.Header().Get("Content-Type"))
	assert.Contains(t, recorder.Header().Get("Content-Disposition"), "attachment; filename=\"newapi-observability-24h-")

	// Excel 依赖 UTF-8 BOM 识别中文列名。此处用转义写法，源码内不得出现 BOM 字符。
	assert.Equal(t, "\ufeff", recorder.Body.String()[:3])
	assert.Contains(t, recorder.Body.String(), "request_id")
}

func TestExportRequestsJSONFormat(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/requests/export?range=24h&format=JSON")
	ExportRequests(c)

	// format=json 走响应包装，不写 CSV 头。
	assert.Contains(t, recorder.Header().Get("Content-Disposition"), ".json\"")
	assert.NotContains(t, recorder.Header().Get("Content-Type"), "text/csv")
	body := decodeBody(t, recorder)
	assert.Equal(t, true, body["success"])
}

func TestExportRequestsWrapsErrors(t *testing.T) {
	newEmptyDB(t)

	c, recorder := newTestContext(t, "/api/observability/requests/export?range=custom")
	ExportRequests(c)

	body := decodeBody(t, recorder)
	assert.Equal(t, false, body["success"])
	assert.NotEmpty(t, body["message"])
}

// TestWriteRequestsCSVDoesNotLeakSecrets 锁死导出列：不得出现密钥、请求/响应正文。
func TestWriteRequestsCSVDoesNotLeakSecrets(t *testing.T) {
	status := 500
	summary := "upstream 500"
	c, recorder := newTestContext(t, "/x")
	require.NoError(t, writeRequestsCSV(c.Writer, &obs.ExportRequest{Rows: []obs.RequestItem{{
		Id:             1,
		CreatedAt:      1758500000,
		RequestId:      "req-1",
		TokenId:        3,
		TokenName:      "key-a",
		ChannelId:      10,
		ChannelName:    "openai-ch",
		ChannelType:    1,
		ModelName:      "gpt-4o",
		Group:          "default",
		Quota:          500000,
		PromptTokens:   10,
		TotalTokens:    30,
		CachedTokens:   50,
		UseTimeMs:      3000,
		TtftMs:         120,
		IsFailed:       true,
		FailStatusCode: &status,
		FailSummary:    &summary,
	}}}))

	out := recorder.Body.String()
	assert.Contains(t, out, "key-a")
	assert.Contains(t, out, "openai-ch")
	assert.Contains(t, out, "req-1")
	assert.Contains(t, out, "fail_summary")
	assert.Contains(t, out, "cached_tokens")
	// 导出列里不得出现任何密钥/正文列名。
	for _, forbidden := range []string{"token_key", "sk-", "prompt_content", "response_body", "user_email"} {
		assert.NotContains(t, out, forbidden)
	}
}

func TestEscapeCSVField(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"plain text is untouched", "gpt-4o", "gpt-4o"},
		{"empty stays empty", "", ""},
		{"comma forces quoting", "a,b", `"a,b"`},
		{"quotes are doubled", `say "hi"`, `"say ""hi"""`},
		{"newline forces quoting", "a\nb", "\"a\nb\""},
		{"carriage return forces quoting", "a\rb", "\"a\rb\""},
		{"equals is neutralized", "=1+1", "'=1+1"},
		{"plus is neutralized", "+1", "'+1"},
		{"minus is neutralized", "-1", "'-1"},
		{"at sign is neutralized", "@SUM(A1)", "'@SUM(A1)"},
		{"formula with comma keeps both guards", "=cmd|' /C calc'!A0,x", "\"'=cmd|' /C calc'!A0,x\""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, escapeCSVField(tt.input))
		})
	}
}

func TestNeedsFormulaGuard(t *testing.T) {
	for _, dangerous := range []string{"=x", "+x", "-x", "@x", "\tx", "\rx"} {
		assert.True(t, needsFormulaGuard(dangerous), "%q 必须被中和", dangerous)
	}
	assert.False(t, needsFormulaGuard(""))
	assert.False(t, needsFormulaGuard("safe"))
	assert.False(t, needsFormulaGuard("a=b"), "仅首字符危险才算公式")
}

// TestWriteRequestsCSVNeutralizesInjection 确认用户可控字段无法注入公式。
func TestWriteRequestsCSVNeutralizesInjection(t *testing.T) {
	c, recorder := newTestContext(t, "/x")
	require.NoError(t, writeRequestsCSV(c.Writer, &obs.ExportRequest{Rows: []obs.RequestItem{{
		Id:          1,
		RequestId:   "=HYPERLINK(\"http://evil\")",
		TokenName:   "@SUM(A1)",
		ModelName:   "+1",
		ChannelName: "-2",
	}}}))

	out := recorder.Body.String()
	for _, want := range []string{`"'=HYPERLINK(""http://evil"")"`, "'@SUM(A1)", "'+1", "'-2"} {
		assert.Contains(t, out, want)
	}
}

// TestWriteRequestsCSVMarksTruncation 锁死「导出被截断必须可见」：
// 截断时末尾追加注释行并带上 total/exported，未截断时不得出现该行。
func TestWriteRequestsCSVMarksTruncation(t *testing.T) {
	c, recorder := newTestContext(t, "/x")
	require.NoError(t, writeRequestsCSV(c.Writer, &obs.ExportRequest{
		Rows:      []obs.RequestItem{{Id: 1, RequestId: "req-1"}},
		Total:     120,
		Truncated: true,
	}))

	out := recorder.Body.String()
	assert.Contains(t, out, "# truncated: total=120 exported=1")

	// 未截断：不得出现注释行，否则前端会误报。
	c2, recorder2 := newTestContext(t, "/x")
	require.NoError(t, writeRequestsCSV(c2.Writer, &obs.ExportRequest{
		Rows:      []obs.RequestItem{{Id: 1, RequestId: "req-1"}},
		Total:     1,
		Truncated: false,
	}))
	assert.NotContains(t, recorder2.Body.String(), "# truncated")
}

func TestFailureStatusCodeAndSummary(t *testing.T) {
	status := 429
	summary := "rate limit"
	item := obs.RequestItem{FailStatusCode: &status, FailSummary: &summary}
	assert.Equal(t, "429", failureStatusCode(item))
	assert.Equal(t, "rate limit", failureSummary(item))

	// 未失败的行必须导出为空列，而不是 "0" / "<nil>"。
	empty := obs.RequestItem{}
	assert.Equal(t, "", failureStatusCode(empty))
	assert.Equal(t, "", failureSummary(empty))
}

// TestFailureSummaryCollapsesNewlines 保证多行错误摘要不破坏 CSV 行结构。
func TestFailureSummaryCollapsesNewlines(t *testing.T) {
	summary := "line one\nline two\r\nline three"
	c, recorder := newTestContext(t, "/x")
	require.NoError(t, writeRequestsCSV(c.Writer, &obs.ExportRequest{Rows: []obs.RequestItem{{
		Id:          1,
		FailSummary: &summary,
	}}}))

	out := recorder.Body.String()
	assert.Contains(t, out, "line one line two line three")
	assert.Equal(t, 2, len(splitCSVLines(out)), "表头 + 1 行数据，不得被摘要换行拆散")
}

func splitCSVLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			lines = append(lines, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
