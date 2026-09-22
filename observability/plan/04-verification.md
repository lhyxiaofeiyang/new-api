# 验证记录（Append-only）

> 规则：每条必须含**时间、命令、原始输出要点**。未实测的项一律标「未验证 + 原因」，不得写成通过。

---

## 2026-09-22 环境与前置

| 时间 | 项 | 结果 | 证据 |
|---|---|---|---|
| 12:23 | cc-switch Claude 供应商格式 | **PASS** | `select name,json_extract(meta,'$.apiFormat'),is_current from providers where app_type='claude'` → `newapi-oai = openai_responses, is_current=1`（另 3 个为 anthropic，未用） |
| 12:27 | herdr agent 存活 | **PASS** | `dev-backend` @ w3:p1、`dev-frontend` @ w3:p2（`--model sonnet`）；w3:p3/p4 已被关闭，T4/T5 前需重建 |
| 12:27 | 带 tools 请求实测（改格式后） | **PASS** | 经 `http://127.0.0.1:15721` 的 `/v1/messages`：无 tools / 带 tools / 带 system+tool_choice / 流式+tools **四个用例全 HTTP 200**（改格式前带 tools 为 `400 Invalid input: expected "function"`） |

### 环境事实（本机）

- **Go 依赖代理**：`proxy.golang.org` 不可达（`dial tcp 142.250.197.241:443: i/o timeout`）。
  必须用 `GOPROXY=https://goproxy.cn,direct GOSUMDB=off`（**仅在命令级覆盖**，不改 `go env`、不改 `go.mod`）。
- **agent 后端模型**：cc-switch 供应商把所有 Claude 档位映射到 `deepseek/deepseek-v4.1-flash`；TUI 显示的 "Sonnet 4.6" 只是标签。
- **macOS 无 `timeout` 命令**：脚本里用 `gtimeout` 或 Python `subprocess(timeout=)`。

---

## 2026-09-22 13:04 首轮结构门（未加代理，环境失败）

命令：`go build ./... && go vet ... && go test ...`（默认 GOPROXY）

| 门 | 结果 | 说明 |
|---|---|---|
| G1 go build | **FAIL** | 全部为 `proxy.golang.org ... i/o timeout` → **环境原因，非代码** |
| G5 go test | **FAIL** | 真实编译错误：`monitoring_service.go:226` 类型不符（`int64` 当 `int` 用）、`monitoring_service.go:9` 与 `usage_service.go:11` 未使用的 `model` import |
| G3 只读审计 | PASS | `grep -rnE "\.(Create|Save|Updates?|Delete|Exec)\("` 0 命中 |
| G4 方言函数审计 | PASS | `grep -rniE "strftime|from_unixtime|date_trunc|json_extract"` 0 命中 |

---

## 2026-09-22 13:08 二轮结构门（GOPROXY=goproxy.cn）

命令：`GOPROXY=https://goproxy.cn,direct GOSUMDB=off go build ./... && go vet ... && go test ...`

| 门 | 结果 | 说明 |
|---|---|---|
| G1 go build ./... | **PASS** | 环境修好后代码可编译 |
| G2 go vet 新包 | **PASS** | — |
| G5 go test 新包 | **FAIL** | `TestGetSummaryEmptyDatabase` panic：nil pointer → 测试未初始化全局 `model.DB`。堆栈：`model/perf_metric.go:83` ← `service/observability/summary_service.go:151`(`perfMetricsCounters`) ← `summary_service.go:115`(`GetSummary`) ← `summary_service_test.go:15`。另：`controller/observability` 当时 `[no test files]` |

已把该堆栈**原样回灌**给 `dev-backend` 修复（要求：`fixture_test.go` 里用临时/内存 SQLite 初始化全局 DB + `TestMain` setup/teardown；补 `controller/observability` 至少 1 个测试）。

---

## 2026-09-22 13:23 两处异常及其处置

| 异常 | 真相（证据） | 处置 |
|---|---|---|
| `go.mod` / `go.sum` 被修改 | `go mod download all` / `go mod tidy` 副作用；`git diff go.mod` 显示**唯一变化**是 `github.com/prometheus/common v0.62.0` 掉了 `// indirect` 注释，**未新增任何 require**；`go.sum` +721 行（`all` 模式校验和） | **已回滚**：`git checkout -- go.mod go.sum`。回滚后复测 `go build ./...` **PASS**、`go vet 新包` **PASS**，证明为噪声（722 insertions/1 deletion） |
| i18n「7 个文件改动消失」 | **我的检查是假阳性**：`git show HEAD:web/src/i18n/locales/zh.json` 里**本就含 `Observability`**（上游已有同名 key）。当时 `git status web/src/i18n/` 无输出 → 前端**尚未真正落 i18n** | 已记录；等前端真正追加后，必须用「对比 HEAD 的 key 差集」而非 `grep Observability` 作为判据（见下方待补项） |

---

## 待补验证项（尚未完成，**不得视为通过**）

| 项 | 状态 |
|---|---|
| G1 `go build ./...` | **PASS**（13:36 我独立复跑，`GOPROXY=goproxy.cn GOSUMDB=off`） |
| G2 `go vet` 新包 | **PASS**（同上） |
| G5 `go test` 新包 | **PASS**（13:36 我独立复跑：`ok controller/observability 1.775s` / `ok service/observability 2.770s`） |
| G3 只读审计 | **PASS**（产品代码 Create/Update/Delete/Save/Exec/AutoMigrate/Raw **0 命中**） |
| G4 方言函数审计 | **PASS**（0 命中；分桶全在 Go 侧） |
| G6 侵入点审计（白名单 4 项） | 未跑（待前端收尾后执行 `obs-gate.sh`） |
| G7a typecheck | **PASS**（`tsgo -b` → exit 0） |
| G7b lint | **FAIL（待收口）**：全库 185 error，其中 3 条来自我们新增文件（均 `no-nested-ternary`）；目标 = 182 条 pre-existing、observability 贡献 0 |
| G7c vitest | **PASS**：全库 174 文件 / 2148 用例全绿；observability 专项 9 文件 / 55 用例全绿 |
| G7d build | **PASS**（rsbuild `ready built in 4.78s`） |
| G8 路由 / 导航顺序 / i18n | **PASS**：`chat:60 → general:76 → **observability:114** → personal:135 → admin:156`；7 语言各 **+56 行**；`routeTree.gen.ts` **+45/-0**；上游 `web/src/components/` **零改动** |
| T6 数字一致性 | **PASS（见下节）** |
| T7 交叉编译产物（`ELF 64-bit ... statically linked`）与 sha256 | 未验证 |
| 部署（T8） | **未执行**（需用户授权） |

### 决策记录

- **`web/src/routeTree.gen.ts`**：TanStack Router 由 `web/rsbuild.config.ts:93` 的 `@tanstack/router-plugin` 自动生成的构建产物（`+45` 行纯追加）。**已获用户批准**纳入侵入点白名单（作为生成物，不手改，构建时自动重生成）。证据：文件头 `/* eslint-disable */` + `// @ts-nocheck`。

---

## 2026-09-22 14:22 T6 数字一致性（真实数据交叉核对）**PASS**

**方法**：从生产库取**只读备份**（`sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" ".backup ..."`，未触碰生产库），拉回本地 scratch，另存一份原始副本供手工 SQL 对照；写临时程序 `t6verify/main.go` **直接调用真实服务层函数**（`obs.GetSummary` / `obs.GetUsage` / `obs.GetRequests`），并复现应用真实启动序列 `common.InitEnv() → model.InitDB() → model.InitLogDB()`（缺 `InitLogDB` 会因 `model.LOG_DB == nil` panic —— 脚手架问题，非产品缺陷）。

**窗口**：`range=custom`，`start=1788278400`（2026-09-02 00:00 +08）→ `end=1790058148`。

| 指标 | 服务层输出 | 手工 SQL | 判定 |
|---|---|---|---|
| prompt_tokens | 1 108 419 339 | 1 108 419 339 | 一致 |
| completion_tokens | 10 554 105 | 10 554 105 | 一致 |
| total_tokens | 1 118 973 444 | 1 118 973 444 | 一致 |
| cached_tokens（`other.cache_tokens`） | 1 040 095 111 | 1 040 095 111 | 一致 |
| total_quota | 25 795 184 887 | 25 795 184 887 | 一致 |
| total_cost_usd（`quota/500000`） | 51 590.3698 | 51 590.3698 | 一致 |
| average_latency_ms（`sum(use_time)*1000/日 use_time>0 计数`） | 16 578.36 | `232843*1000/14045 = 16578.36` | 一致 |
| stream_calls | 11 170 | 11 170 | 一致 |
| unique_channels / unique_models | 9 / 25 | 9 / 25 | 一致 |
| Top5 模型（名 / 调用 / quota） | LongCat-2.0 10794/14817297418 … | 完全相同 | 一致 |
| `log_rows` | 14 081 | `count(*) type=2` = 14 081 | 一致 |
| `unique_tokens` | **13** | **14** | **服务正确**：实现为 `COUNT(DISTINCT CASE WHEN token_id > 0 THEN token_id END)`，手工 SQL 未加 `token_id>0`（存在 token_id=0 的行） |
| `total_calls` / `success_calls` | **12 837 / 12 288** | `perf_metrics`: `sum(request_count)=12837`、`sum(success_count)=12288` | 一致（口径来自 `perf_metrics`，见下方发现） |

### 发现（T6 副产物，2 项）

1. **口径不一致（已修注释）**：`ERROR_LOG_ENABLED=false` 时 `perfMetricsCounters` 把 `total_calls/success_calls/failure_calls/success_rate` **四项整体**换成 `perf_metrics` 聚合，而代码注释原写「调用量/token/额度仍来自 logs」——**注释与代码不符**。后果：该状态下「Total Calls」卡片 = 12837（perf_metrics），而请求明细表与 `log_rows` = 14081（logs），**同屏两个"调用量"**。已把注释改为真实口径（`service/observability/summary_service.go:150`），并记为**前端提示待办**：需依 `data_source.failure_source` 标注来源。生产开启 `ERROR_LOG_ENABLED=true` 后该分支不生效，卡片与表格口径将自动统一（`failure_source=error_log`）。
2. **失败率高龄窗口假报**：早于 `LOG_RETENTION_DAYS` 的窗口失败数恒为 0 → 会显示 100%。**未处理**（超出本轮范围），记为已知限制。

### 未验证 / 已知限制（诚实标注）

- `ERROR_LOG_ENABLED=true` 打开后失败事件是否真实落库：**未验证**（需一次真实失败请求 + 生产变更）。
- ClickHouse 日志库（`LOG_SQL_DSN`）下 `LEFT JOIN channels` 不成立：**未处理**。生产实况已核实为**不适用**（unit `new-api.service` 无任何 `Environment=`、未装 ClickHouse、`LOG_SQL_DSN` 未设，日志与主库同库）。
