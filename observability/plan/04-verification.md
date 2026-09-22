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
| G5 `go test` 新包全绿（含 controller 测试） | 未验证（修复中） |
| G6 侵入点审计（白名单：`router/api-router.go`、`use-sidebar-data.ts`、`i18n/locales/`、`routeTree.gen.ts`） | 未验证 |
| G7a/b/c 前端 typecheck / lint / vitest | 未验证 |
| G8 路由文件 / 导航顺序（observability 紧随 general）/ i18n key 差集 | 未验证 |
| T6 数字一致性（API 返回 vs 手工 SQL，真实数据脱敏副本） | 未验证 |
| T7 交叉编译产物（`ELF 64-bit ... statically linked`）与 sha256 | 未验证 |
| 部署（T8） | **未执行**（需用户授权） |

### 决策记录

- **`web/src/routeTree.gen.ts`**：TanStack Router 由 `web/rsbuild.config.ts:93` 的 `@tanstack/router-plugin` 自动生成的构建产物（`+45` 行纯追加）。**已获用户批准**纳入侵入点白名单（作为生成物，不手改，构建时自动重生成）。证据：文件头 `/* eslint-disable */` + `// @ts-nocheck`。
