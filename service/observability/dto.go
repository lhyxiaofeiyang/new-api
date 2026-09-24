package observability

// 本包实现可观测性三页的只读聚合。数据来源为消费日志（logs.type = 2）与错误
// 日志（logs.type = 5），一切查询都必须保持只读（仅 Select/Find/Scan/Count/Raw）。

// Range 是解析后的查询区间（服务端本地时区，unix 秒，左闭右开）。
type Range struct {
	Start int64  `json:"start"`
	End   int64  `json:"end"`
	Range string `json:"range"`
}

// DataSource 自述数据来源与口径，前端据此决定是否展示失败明细。
// FailureSource 只描述「失败数」的来源：error_log = 窗口内 logs.type=5 的准确行数；
// perf_metrics = 错误日志关闭时的估算值（各桶 request_count − success_count，下限 0）。
// total_calls / success_calls 与 LogRows 恒取自消费日志（logs.type=2），不随开关变化。
type DataSource struct {
	ErrorLogEnabled bool   `json:"error_log_enabled"`
	FailureSource   string `json:"failure_source"`
	LogRows         int64  `json:"log_rows"`
}

const (
	failureSourceErrorLog    = "error_log"
	failureSourcePerfMetrics = "perf_metrics"
)

// SummaryCounters 对应仪表盘首屏概览卡。
type SummaryCounters struct {
	TotalCalls       int64   `json:"total_calls"`
	SuccessCalls     int64   `json:"success_calls"`
	FailureCalls     int64   `json:"failure_calls"`
	SuccessRate      float64 `json:"success_rate"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	CachedTokens     int64   `json:"cached_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	TotalQuota       int64   `json:"total_quota"`
	TotalCostUsd     float64 `json:"total_cost_usd"`
	AverageLatencyMs float64 `json:"average_latency_ms"`
	AverageTtftMs    float64 `json:"average_ttft_ms"`
	StreamCalls      int64   `json:"stream_calls"`
	UniqueTokens     int64   `json:"unique_tokens"`
	UniqueChannels   int64   `json:"unique_channels"`
	UniqueModels     int64   `json:"unique_models"`
}

// Rolling 是近 60 秒的实时速率。
type Rolling struct {
	Rpm int64 `json:"rpm"`
	Tpm int64 `json:"tpm"`
}

type TopModel struct {
	ModelName   string `json:"model_name"`
	Calls       int64  `json:"calls"`
	TotalTokens int64  `json:"total_tokens"`
	Quota       int64  `json:"quota"`
}

type TopToken struct {
	TokenId     int    `json:"token_id"`
	TokenName   string `json:"token_name"`
	Calls       int64  `json:"calls"`
	TotalTokens int64  `json:"total_tokens"`
	Quota       int64  `json:"quota"`
}

type TopChannel struct {
	ChannelId   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	Calls       int64  `json:"calls"`
	TotalTokens int64  `json:"total_tokens"`
	Quota       int64  `json:"quota"`
}

type TrafficPoint struct {
	Ts               int64 `json:"ts"`
	Calls            int64 `json:"calls"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	Quota            int64 `json:"quota"`
}

// HourlyActivity 是本地时区按「小时 of day」(0–23) 的调用分布，固定 24 项。
// 区间跨多日时同一小时逐日累加，因此这是「一天中各小时的分布」，不是最近 24h 滑窗。
type HourlyActivity struct {
	Hour  int   `json:"hour"`
	Calls int64 `json:"calls"`
}

// HealthPoint 是 10 分钟粒度的请求健康时间线，固定 144 项（24 小时）。
type HealthPoint struct {
	Ts       int64 `json:"ts"`
	Calls    int64 `json:"calls"`
	Failures int64 `json:"failures"`
}

// Summary 是 GET /api/observability/summary 的响应体。
type Summary struct {
	Range          Range            `json:"range"`
	DataSource     DataSource       `json:"data_source"`
	Summary        SummaryCounters  `json:"summary"`
	Rolling        Rolling          `json:"rolling"`
	TopModels      []TopModel       `json:"top_models"`
	TopTokens      []TopToken       `json:"top_tokens"`
	TopChannels    []TopChannel     `json:"top_channels"`
	Traffic        []TrafficPoint   `json:"traffic"`
	HourlyActivity []HourlyActivity `json:"hourly_activity"`
	HealthTimeline []HealthPoint    `json:"health_timeline"`
}

// RetryAttempt 由消费日志 other.request_policy 的尝试事件还原。
type RetryAttempt struct {
	Index     int    `json:"index"`
	ChannelId int    `json:"channel_id"`
	ElapsedMs int64  `json:"elapsed_ms"`
	Action    string `json:"action"`
}

type RequestItem struct {
	Id               int            `json:"id"`
	CreatedAt        int64          `json:"created_at"`
	RequestId        string         `json:"request_id"`
	TokenId          int            `json:"token_id"`
	TokenName        string         `json:"token_name"`
	ChannelId        int            `json:"channel_id"`
	ChannelName      string         `json:"channel_name"`
	ChannelType      int            `json:"channel_type"`
	ModelName        string         `json:"model_name"`
	Group            string         `json:"group"`
	UserId           int            `json:"user_id"`
	Username         string         `json:"username"`
	Quota            int            `json:"quota"`
	PromptTokens     int            `json:"prompt_tokens"`
	CompletionTokens int            `json:"completion_tokens"`
	TotalTokens      int            `json:"total_tokens"`
	CachedTokens     int            `json:"cached_tokens"`
	CacheRatio       float64        `json:"cache_ratio"`
	UseTimeMs        int64          `json:"use_time_ms"`
	TtftMs           int64          `json:"ttft_ms"`
	IsStream         bool           `json:"is_stream"`
	RetryChain       []RetryAttempt `json:"retry_chain"`
	IsFailed         bool           `json:"is_failed"`
	FailStatusCode   *int           `json:"fail_status_code"`
	FailSummary      *string        `json:"fail_summary"`
}

// Aggregate 是当前筛选结果的整体统计。
type Aggregate struct {
	Calls            int64   `json:"calls"`
	TotalTokens      int64   `json:"total_tokens"`
	Quota            int64   `json:"quota"`
	AverageLatencyMs float64 `json:"average_latency_ms"`
}

// RequestPage 是 GET /api/observability/requests 的响应体。
type RequestPage struct {
	Items     []RequestItem `json:"items"`
	Total     int64         `json:"total"`
	Page      int           `json:"page"`
	PageSize  int           `json:"page_size"`
	Aggregate Aggregate     `json:"aggregate"`
}

// UsageRow 是维度聚合的一行。
type UsageRow struct {
	Key              string  `json:"key"`
	Label            string  `json:"label"`
	Calls            int64   `json:"calls"`
	SuccessCalls     int64   `json:"success_calls"`
	FailureCalls     int64   `json:"failure_calls"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	CachedTokens     int64   `json:"cached_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	Quota            int64   `json:"quota"`
	CostUsd          float64 `json:"cost_usd"`
	AverageLatencyMs float64 `json:"average_latency_ms"`
	AverageTtftMs    float64 `json:"average_ttft_ms"`
	Share            float64 `json:"share"`
}

type UsageTrendPoint struct {
	Ts           int64 `json:"ts"`
	Calls        int64 `json:"calls"`
	TotalTokens  int64 `json:"total_tokens"`
	Quota        int64 `json:"quota"`
	FailureCalls int64 `json:"failure_calls"`
}

type MatrixCell struct {
	X           int   `json:"x"`
	Y           int   `json:"y"`
	Calls       int64 `json:"calls"`
	TotalTokens int64 `json:"total_tokens"`
	Quota       int64 `json:"quota"`
}

type Matrix struct {
	XLabels []string     `json:"x_labels"`
	YLabels []string     `json:"y_labels"`
	Cells   []MatrixCell `json:"cells"`
}

type UsageTotals struct {
	Calls       int64   `json:"calls"`
	TotalTokens int64   `json:"total_tokens"`
	Quota       int64   `json:"quota"`
	CostUsd     float64 `json:"cost_usd"`
}

// Usage 是 GET /api/observability/usage 的响应体。
type Usage struct {
	Rows       []UsageRow        `json:"rows"`
	Trend      []UsageTrendPoint `json:"trend"`
	Matrix     *Matrix           `json:"matrix,omitempty"`
	Totals     UsageTotals       `json:"totals"`
	DataSource DataSource        `json:"data_source"`
}

// ExportRequest 是 GET /api/observability/requests/export 的响应体。
type ExportRequest struct {
	Rows       []RequestItem `json:"rows"`
	Total      int64         `json:"total"`
	Truncated  bool          `json:"truncated"`
	Range      Range         `json:"range"`
	DataSource DataSource    `json:"data_source"`
}
