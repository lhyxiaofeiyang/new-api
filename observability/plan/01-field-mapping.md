# New API 可观测性看板 — 字段映射与可得性

参照对象：**CPA-Manager-Plus**（下称 CPAMP，`seakee/CPA-Manager-Plus`，Go + React + SQLite）。
判定依据分三类：

- ✅ **直接可得**：New API 现有表/字段可直接支撑
- ⚠️ **需加工或降级**：可得但口径不同（需说明差异）
- ❌ **不做**：CPA 凭证体系专属，或 New API 无对应数据

数据源：New API 主库（实测为 SQLite，`logs` / `perf_metrics` / `tokens` / `channels` / `users` / `options`）。

---

## 一、事件层映射（CPAMP `usage_events` → New API `logs`）

| CPAMP 字段 | New API 对应 | 判定 | 说明 |
|---|---|---|---|
| `event_hash`（去重） | `request_id`（有索引） | ✅ | New API 已保证唯一性 |
| `timestamp_ms` | `created_at`（unix 秒） | ✅ | 需 ×1000 归一到毫秒 |
| `provider` / `executor_type` | `channels.type`（渠道类型） | ✅ | 需 join `channels` |
| `channel` | `channel_id` | ✅ | 实测 `logs.channel_name` 为空，**必须 join `channels.name`** |
| `api_key_hash` | `token_id` / `token_name` | ✅ | 即 New API 的「令牌 / API Key」 |
| `account_snapshot` / `auth_file_snapshot` | — | ❌ | CPA 凭证池专属 |
| `model` / `requested_model` | `model_name`（+ `other.request_path`） | ✅ | 第三方模型名带供应商前缀 |
| `resolved_model` / `billing_model` | `model_name` | ⚠️ | New API 无映射后模型字段；如需可后续从 `channels.model_mapping` 推导 |
| `service_tier` | — | ❌ | New API 无该概念 |
| `input_tokens` | `prompt_tokens` | ✅ | |
| `output_tokens` | `completion_tokens` | ✅ | |
| `reasoning_tokens` | `other.reasoning_effort`（仅 40% 记录有） | ❌ | **无推理 token 数**，该卡片去掉 |
| `cached_tokens` | `other.cache_tokens` + `other.cache_ratio` | ✅ | 实测近 2000 条全量存在 |
| `cache_read_tokens` / `cache_creation_tokens` | — | ⚠️ | New API 只给合并后的 cache_tokens，**合并展示，不拆 read/creation** |
| `long_*_tokens`（长上下文分档） | — | ❌ | 分档计费语义不同 |
| `latency_ms` | `use_time`（秒）×1000 | ⚠️ | 秒级精度，会损失亚秒部分 |
| `ttft_ms` | `other.frt`（首字节毫秒） | ✅ | 实测全量存在，精度更好 |
| `failed` / `fail_status_code` / `fail_summary` | `logs` type=5（错误日志），**默认关闭** | ⚠️ | 见下方「失败率」专章 |
| `fail_body`（脱敏失败体） | type=5 的 `content`（已脱敏摘要） | ⚠️ | 等价度较高 |
| 计费金额 | `quota`（New API 已算好额度） | ✅ | 另有 `other.model_price` / `model_ratio` / `group_ratio` / `completion_ratio` / `user_group_ratio` 可还原单价 |
| `header_quota_*`（配额头证据） | — | ❌ | CPA 专属 |

## 二、聚合层映射（CPAMP rollup → New API）

CPAMP 有两层预聚合（小时 `usage_hourly_aggregate_v1` + 多维日 rollup）+ 游标状态机（`usage_monitoring_rollup_state`）。

**New API 侧决定：不做预聚合**，理由有实测支撑：

| 项 | 实测值 |
|---|---|
| `logs` 行数 | 12,523 行（约 20 天） |
| 7 天按 token 聚合 | 16 ms |
| 7 天按 channel × model 聚合 | 17 ms |
| 24 小时按小时分桶 | 12 ms |
| 索引覆盖 | `token_name` / `token_id` / `channel_id` / `model_name` / `created_at` / `group` 等均已建 |

→ 当前量级实时聚合即可；数据量增长到百万行级时，再按 CPAMP 的 `rollup_state`（增量游标 + 结构版本 + 可重建）模式追加，**架构预留但不实现**（YAGNI）。

## 三、维度映射（三页共用）

| CPAMP 维度 | New API 维度 | 判定 |
|---|---|---|
| API Key | 令牌（`token_id` / `token_name`） | ✅ |
| Provider | 渠道类型（`channels.type`） | ✅ |
| Account / 凭证 | 渠道（`channel_id` / `channels.name`） | ✅ 替代 |
| Model | 模型（`model_name`） | ✅ |
| Project / Workspace | 分组（`logs.group`） | ✅ 替代 |
| 时间范围 | `created_at` 区间 | ✅ |
| 热力矩阵 | 令牌×模型、渠道×模型、渠道类型×模型 | ✅ |

## 四、失败率专章（唯一硬依赖）

**数据来源**：`constant.ErrorLogEnabled`（`common/init.go:199`）→ `GetEnvOrDefaultBool("ERROR_LOG_ENABLED", false)`，写入点 `service/relay_error.go:76`。

| 路径 | 能力 | 代价 |
|---|---|---|
| **A. 开启 `ERROR_LOG_ENABLED=true`** | 令牌/渠道维度的失败事件 + 错误摘要，请求监控页的失败明细与异常 Key 完整可用 | 需改 systemd 环境变量并重启（约数秒，可回滚） |
| **B. 保持关闭** | 只能用 `perf_metrics.request_count / success_count`（模型×分组，5 分钟桶）做粗粒度成功率 | 无失败明细、无受影响 Key/渠道 |

**本项目策略**：前端只做**只读状态提示**（检测到错误日志未开启时提示"失败明细不可用"并给出手册链接），**不代替管理员修改生产配置**。开关动作由用户单独确认执行。

已排克的字段：`other.stream_status` 实测 12,391 条**全为空**，不可用于失败判定。

## 五、三库兼容注意事项（上游硬约束）

- **禁止**使用方言函数（`strftime` / `FROM_UNIXTIME` / `date_trunc`）：时间分桶在 **Go 侧**完成，SQL 只接收 `created_at >= ? AND created_at < ?` 参数化区间。
- 聚合函数限用 `COUNT/SUM/AVG/MIN/MAX` 与 `CASE WHEN`。
- JSON 字段（`logs.other`）处理：SQLite 有 `json_extract`，MySQL 有 `JSON_EXTRACT`，PostgreSQL 有 `->>'key'` —— **不做 SQL 侧 JSON 解析**；改为在 Go 侧反序列化 `other` 后聚合（列数可接受时）。
- 逐项在三种数据库上跑同一组测试用例（见 `04-verification.md`）。
