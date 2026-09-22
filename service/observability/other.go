package observability

import (
	"github.com/QuantumNous/new-api/common"
)

// parseOther 在 Go 侧反序列化 logs.other。SQL 侧不解析 JSON，以保证三库兼容。
func parseOther(raw string) map[string]any {
	if raw == "" {
		return nil
	}
	var values map[string]any
	if err := common.UnmarshalJsonStr(raw, &values); err != nil {
		return nil
	}
	return values
}

func otherInt64(value any) int64 {
	result, ok := numericToInt64(value)
	if !ok || result < 0 {
		return 0
	}
	return result
}

func otherFloat(value any) float64 {
	result, ok := numericToFloat64(value)
	if !ok {
		return 0
	}
	return result
}

// retryChainFromOther 把 other.request_policy 的尝试事件还原为重试链。
// 该字段由 AppendRelayLogAdminInfo 写入 admin_info 作用域，仅在管理员接口可见。
func retryChainFromOther(other map[string]any) []RetryAttempt {
	chain := []RetryAttempt{}
	events, ok := other["request_policy"].([]any)
	if !ok {
		return chain
	}
	for index, raw := range events {
		event, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		attempt := RetryAttempt{Index: index}
		if value, ok := numericToInt64(event["channel_id"]); ok {
			attempt.ChannelId = int(value)
		}
		if value, ok := numericToInt64(event["elapsed_ms"]); ok {
			attempt.ElapsedMs = value
		}
		if decision, ok := event["decision"].(map[string]any); ok {
			if action, ok := decision["action"].(string); ok {
				attempt.Action = action
			}
		}
		chain = append(chain, attempt)
	}
	return chain
}
