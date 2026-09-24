# 可观测性 API 契约（v1）

- **前缀**：`/api/observability`
- **鉴权**：`middleware.AdminAuth()`（与既有 `/api/log/` 一致）
- **只读**：全部为 `GET`，无副作用
- **时间语义**：所有区间按 **服务端本地时区**解释，参数为 unix 秒；返回同时带 `start` / `end` 便于前端对齐
- **分页**：`page` 从 1 开始，`page_size` 上限 500（导出上限 50000）

---

## 1. `GET /api/observability/summary`

仪表盘单次请求返回全部首屏数据。

### 参数
| 名称 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `range` | string | `24h` | `today` / `24h` / `7d` / `30d` / `custom` |
| `start` / `end` | int64 | — | `range=custom` 时必填（unix 秒） |

### 响应
```jsonc
{
  "success": true,
  "data": {
    "range": { "start": 1758500000, "end": 1758586400, "range": "24h" },
    "data_source": {                 // 数据源与口径自述（前端据此显示提示）
      "error_log_enabled": false,    // false → 失败明细卡片显示"不可用"提示
      "failure_source": "none",      // none | error_log | perf_metrics
      "log_rows": 12523
    },
    "summary": {                     // 对应 CPAMP dashboard.summary.today
      "total_calls": 0,
      "success_calls": 0,
      "failure_calls": 0,
      "success_rate": 0,
      "prompt_tokens": 0,
      "completion_tokens": 0,
      "cached_tokens": 0,
      "total_tokens": 0,
      "total_quota": 0,              // New API 额度（内部单位，除以 500000 = 美元）
      "total_cost_usd": 0,
      "average_latency_ms": 0,
      "average_ttft_ms": 0,
      "stream_calls": 0,
      "unique_tokens": 0,
      "unique_channels": 0,
      "unique_models": 0
    },
    "rolling": { "rpm": 0, "tpm": 0 },          // 近 60 秒
    "top_models": [ { "model_name": "", "calls": 0, "total_tokens": 0, "quota": 0 } ],
    "top_tokens": [ { "token_id": 0, "token_name": "", "calls": 0, "total_tokens": 0, "quota": 0 } ],
    "top_channels": [ { "channel_id": 0, "channel_name": "", "calls": 0, "total_tokens": 0, "quota": 0 } ],
    "traffic": [ { "ts": 0, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "quota": 0 } ],
    "hourly_activity": [ { "hour": 0, "calls": 0 } ],   // 固定 24 项，按本地时区的「小时 of day」(0–23) 分桶；传入区间跨多日时逐日累加，不是最近 24h 滑窗
    "health_timeline": [ { "ts": 0, "calls": 0, "failures": 0 } ]  // 10 分钟桶 ×144
  }
}
```

## 2. `GET /api/observability/requests`

请求监控明细（分页 + 筛选 + 可选下钻）。

### 参数
| 名称 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `range` / `start` / `end` | — | `24h` | 同上 |
| `page` / `page_size` | int | 1 / 20 | `page_size` ≤ 500 |
| `token_id` | int | — | 按令牌 |
| `channel_id` | int | — | 按渠道 |
| `channel_type` | int | — | 按 Provider |
| `model_name` | string | — | 精确匹配 |
| `group` | string | — | 分组 |
| `is_stream` | bool | — | 流式 |
| `only_failed` | bool | false | 仅失败（需错误日志开启） |
| `keyword` | string | — | 匹配 token_name / model_name |
| `sort` | string | `created_at` | `created_at` / `quota` / `use_time` / `total_tokens` |
| `order` | string | `desc` | `asc` / `desc` |

### 响应
```jsonc
{
  "success": true,
  "data": {
    "items": [{
      "id": 0, "created_at": 0, "request_id": "",
      "token_id": 0, "token_name": "", "channel_id": 0, "channel_name": "", "channel_type": 0,
      "model_name": "", "group": "", "user_id": 0,
      "quota": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
      "cached_tokens": 0, "cache_ratio": 0,
      "use_time_ms": 0, "ttft_ms": 0, "is_stream": false,
      "retry_chain": [ { "index": 0, "channel_id": 0, "elapsed_ms": 0, "action": "" } ],
      "is_failed": false, "fail_status_code": null, "fail_summary": null
    }],
    "total": 0, "page": 1, "page_size": 20,
    "aggregate": { "calls": 0, "total_tokens": 0, "quota": 0, "average_latency_ms": 0 }
  }
}
```

## 3. `GET /api/observability/usage`

用量分析：多维聚合 + 矩阵 + 趋势。

### 参数
| 名称 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `range` / `start` / `end` | — | `7d` | 同上 |
| `dimension` | string | `token` | `token` / `channel` / `channel_type` / `model` / `group` |
| `matrix` | string | — | `token_model` / `channel_model` / `channel_type_model` |
| `granularity` | string | `day` | `hour` / `day`（Go 侧分桶） |
| `limit` | int | 50 | 维度结果上限 |

### 响应
```jsonc
{
  "success": true,
  "data": {
    "rows": [{
      "key": "0", "label": "",            // 维度标识与展示名
      "calls": 0, "success_calls": 0, "failure_calls": 0,
      "prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "total_tokens": 0,
      "quota": 0, "cost_usd": 0,
      "average_latency_ms": 0, "average_ttft_ms": 0,
      "share": 0.0                        // 占总 token 或总成本的比例
    }],
    "trend": [ { "ts": 0, "calls": 0, "total_tokens": 0, "quota": 0, "failure_calls": 0 } ],
    "matrix": {                            // 仅当传 matrix 时返回
      "x_labels": [], "y_labels": [],
      "cells": [ { "x": 0, "y": 0, "calls": 0, "total_tokens": 0, "quota": 0 } ]
    },
    "totals": { "calls": 0, "total_tokens": 0, "quota": 0, "cost_usd": 0 }
  }
}
```

## 4. `GET /api/observability/requests/export`

导出当前筛选结果（默认 7 天，上限 50000 行）。

- 参数同 `/requests`（忽略 `page`/`page_size`，受 `limit` 约束）
- `format=csv|json`（默认 csv）
- **脱敏规则**：不导出任何密钥；`token_name` / `channel_name` 原样（非机密）；不导出 `user_id` 之外的任何用户标识；不含请求/响应正文
- 响应头：`Content-Disposition: attachment; filename="newapi-observability-<range>-<ts>.csv"`

---

## 5. 实现约束（给 dev-backend）

1. 一律走 `model.DB`（GORM，只读）；**禁止** `Create/Update/Delete/Save`。
2. 时间条件：`WHERE created_at >= ? AND created_at < ?`；**禁止**方言函数（`strftime`/`FROM_UNIXTIME`/`date_trunc`）。
3. `logs.other`（JSON 文本）在 **Go 侧** `json.Unmarshal` 后取 `cache_tokens` / `cache_ratio` / `frt` / `model_price` / `request_policy`；SQL 侧不解析 JSON。
4. 渠道名必须 `LEFT JOIN channels ON channels.id = logs.channel_id`（实测 `logs.channel_name` 为空）。
5. 渠道类型取 `channels.type`（Provider）。
6. `logs.type` 过滤：消费日志 = 2（`LogTypeConsume`）。错误日志 = 5。
7. 额度 → 金额：`quota / 500000`（New API 既有换算，见上游 `common` 常量）。
8. 结果结构体标签用 `json:"snake_case"`。
9. 错误一律返回 `{ success:false, message:"..." }`（沿用上游既有响应写法与状态码习惯）。
