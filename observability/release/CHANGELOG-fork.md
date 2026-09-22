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

### 对上游代码的改动（共 4 个侵入点 = 3 处手改 + 1 处生成物）

实测：相对 `upstream/main` 仅有 **10 个既有文件被修改**（7 个语言包 + 3 个代码文件）+ `routeTree.gen.ts`，总计 `68 files changed, +9356, -7`，无任何其他既有文件被触碰。

| 文件 | 改动 | 性质 |
|---|---|---|
| `router/api-router.go` | 新增 `/api/observability` 路由组（+9 行，套 `middleware.AdminAuth()`） | 手改 |
| `web/src/hooks/use-sidebar-data.ts` | 侧边栏新增「可观测性」分组，紧随 `general` 之后（实测行号 `chat:60 → general:76 → observability:114 → personal:135 → admin:156`） | 手改 |
| `web/src/i18n/locales/*.json`（7 语言） | 每语言 **+55 key / 0 删除**（6778 → 6833） | 手改 |
| `web/src/routeTree.gen.ts` | **+45 / -0** 纯追加，由 `web/rsbuild.config.ts:93` 的 `@tanstack/router-plugin` 在构建时自动重生成 | **生成物（不手改）** |

其余 58 个文件均为新增，不影响上游既有页面与接口行为。升级上游的合并方式见 `UPGRADE-MERGE.md`。

### 已知限制

- **失败率/失败明细依赖 `ERROR_LOG_ENABLED=true`**（New API 默认关闭）。未开启时该部分显示为不可用提示，
  成功率仅能由 `perf_metrics`（模型×分组粒度）近似。
- **失败率在超出日志留存期的窗口会失真**：错误日志受 `LOG_RETENTION_DAYS` 约束，查询早于留存边界的窗口时
  失败数恒为 0，会以 100% 成功呈现。当前**未加留存边界判断**（超出本轮范围）。
- **`LEFT JOIN channels` 假设 logs 与 channels 同库**：若启用 `LOG_SQL_DSN`（ClickHouse 日志库），
  channels 在主库、logs 在 ClickHouse，跨库 JOIN 不成立，需改为上游式批量回查。**当前部署不适用**
  （unit `new-api.service` 无 `Environment=`、未装 ClickHouse、`LOG_SQL_DSN` 未设）。
- `reasoning_tokens` 无数据来源，未提供。
- 缓存 Token 仅提供合并值（New API 不区分 cache read / creation）。
- 未做预聚合；数据量增长到百万行级后需引入 rollup（架构已预留）。实测当前 1.4 万行、全窗口聚合在毫秒级。

### 未包含

CPA-Manager-Plus 的账号巡检、凭证池、OAuth 刷新、配额窗口、价格同步、自动冷却等模块（本改造范围明确排除）。

---

### 验证记录（均为实测，非推断）

| 项 | 结果 | 证据 |
|---|---|---|
| `go build ./...` / `go vet` | PASS | 本地复跑，`GOPROXY=https://goproxy.cn,direct GOSUMDB=off` |
| `go test`（新包） | PASS | `ok controller/observability 1.775s` / `ok service/observability 2.770s`；service 20 顶层 + controller 18 顶层用例，全用 `t.TempDir()` 临时 SQLite，无网络 |
| 只读审计 | PASS | 产品代码 `Create/Update/Delete/Save/Exec/AutoMigrate/Raw` **0 命中** |
| 三库方言审计 | PASS | `strftime/from_unixtime/date_trunc/json_extract` **0 命中**（时间条件走 `created_at >= ? AND created_at < ?`，分桶全在 Go 侧） |
| 前端 `typecheck` | PASS | `tsgo -b` exit 0 |
| 前端 `test` | PASS | 174 文件 / 2148 用例全绿；本功能专项 9 文件 / 55 用例全绿 |
| 前端 `build` | PASS | rsbuild `ready built in 4.78s` |
| 前端 `lint` | 通过（有保留） | 全库 182 条 error 全部为**上游既有**；本功能贡献 0 条 |
| **数字一致性（T6）** | PASS | 生产库**只读副本**上直接调用真实服务层函数 vs 手工 SQL，窗口 2026-09-02 → 现在：`prompt/completion/total/cached tokens`、`quota`、`cost_usd`、`average_latency_ms`、`stream_calls`、`unique_channels/models`、Top5 模型 **逐位一致** |

**构建产物**（本地交叉编译，镜像上游 Dockerfile 的 `CGO_ENABLED=0` + `-s -w`）：

```
$ file new-api-linux-amd64
ELF 64-bit LSB executable, x86-64, statically linked, stripped
$ shasum -a 256 new-api-linux-amd64
2fe0841c2a7bcce90d8bf4b0722d593c4c41efcb48bb574a3bec6aa0c2afe7aa
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.1
```

### 口径说明（务必知悉）

- **`total_calls` 与请求明细表行数可能不同口径**：当 `ERROR_LOG_ENABLED=false` 时，`total_calls / success_calls / failure_calls / success_rate` 四项**整体**取自 `perf_metrics`（模型×分组 5 分钟桶），以保证成功率自洽；而请求明细表与 `log_rows` 来自 `logs`。实测同一窗口为 **12837 vs 14081**。生产开启 `ERROR_LOG_ENABLED=true` 后 `failure_source=error_log`，该分支不生效，两者口径自动统一。前端已依 `data_source.failure_source` 区分展示。
