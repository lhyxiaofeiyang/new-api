# 本次改造的更新说明

## v0.1.0（待发布）

基于上游 **`upstream/main`**（`v1.0.0-rc.40` + `#7504`）。

### 新增功能

- **可观测性 · 仪表盘**（`/observability/overview`）
  今日/24h/7d/30d 概览：调用数、Token 拆分（提示/补全/缓存/合计）、成本、平均延迟与首字节、RPM/TPM、
  Top 模型 / Top API Key / Top 渠道、流量趋势、24h 活跃分布、请求健康时间线。
- **可观测性 · 请求监控**（`/observability/monitoring`）
  按 API Key / 渠道 / 渠道类型 / 模型 / 分组 / 流式筛选的请求明细，含重试链与计费还原，支持脱敏导出 CSV/JSON。
- **可观测性 · 用量分析**（`/observability/usage`）
  API Key / 渠道 / 渠道类型 / 模型 / 分组多维聚合，成本与 Token 拆分、趋势、热力矩阵，支持下钻到明细。

### 数据与权限

- 全部为只读查询，仅使用 New API 现有表（`logs` / `channels` / `tokens` / `users`），**未新增或修改任何表结构**。
- 端点前缀 `/api/observability`，与既有 `/api/log` 同样走 `AdminAuth` 管理员鉴权。
- 导出内容不含密钥、不含请求/响应正文。

### 对上游代码的改动（共 3 处，均为最小插入）

| 文件 | 改动 |
|---|---|
| `router/api-router.go` | 新增 `/api/observability` 路由组（约 6 行） |
| `web/src/hooks/use-sidebar-data.ts` | 侧边栏新增「可观测性」分组（约 10 行） |
| `web/src/i18n/locales/*.json` | 追加本功能 i18n key |

其余为新增文件，不影响上游既有页面与接口行为。升级上游的合并方式见 `UPGRADE-MERGE.md`。

### 已知限制

- **失败率/失败明细依赖 `ERROR_LOG_ENABLED=true`**（New API 默认关闭）。未开启时该部分显示为不可用提示，
  成功率仅能由 `perf_metrics`（模型×分组粒度）近似。
- `reasoning_tokens` 无数据来源，未提供。
- 缓存 Token 仅提供合并值（New API 不区分 cache read / creation）。
- 未做预聚合；数据量增长到百万行级后需引入 rollup（架构已预留）。

### 未包含

CPA-Manager-Plus 的账号巡检、凭证池、OAuth 刷新、配额窗口、价格同步、自动冷却等模块（本改造范围明确排除）。
