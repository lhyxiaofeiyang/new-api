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
| G8 路由 / 导航顺序 / i18n | **PASS**：`chat:60 → general:76 → **observability:114** → personal:135 → admin:156`；i18n 7 语言各 **+55 key**（= 首批 `09c9bcf8a` 口径，6778 → 6833；行级 `--numstat` 为 +66/-1 行/语言，差额来自 JSON 末尾逗号与键重排，故本表统一用 **key** 计）；`routeTree.gen.ts` **+45/-0 行**；上游 `web/src/components/` **零改动** |
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

---

## 2026-09-22 14:36 端到端 HTTP 层验证 **PASS**

单元测试只覆盖到 service/handler 内部，故补两层真实验证。

### A. 二进制实跑 + 路由注册（本机 darwin 产物，独立端口 13000，对副本库）

启动横幅与 API 自报版本一致，证明构建注入生效：

```
高小鸡 v1.0.0-rc.40-obs.1  ready in 151 ms
$ curl /api/status  ->  {"success":true,"data":{"version":"v1.0.0-rc.40-obs.1", ...}}
```

| 路径 | HTTP | 判定 |
|---|---|---|
| `/api/observability/summary` / `requests` / `usage` / `requests/export` | **401** | 路由已注册且 `middleware.AdminAuth()` 生效 |
| `/api/log/stat`、`/api/log/`、`/api/channel/`（既有对照） | 401 | 鉴权行为与既有端点一致 |
| `/api/observability/nonexistent` | **404** | **反证**：401 不是兜底，路由确实按注册表命中 |

### B. 参数解析 → service → 响应封装（gin + 真实 handler + httptest，绕开鉴权）

| 用例 | 结果 |
|---|---|
| `/summary?range=custom&start=…&end=…` | HTTP 200；`total_calls=12837 / success_calls=12288 / failure_calls=549 / success_rate=95.72 / total_tokens=1118973444 / cached_tokens=1040095111 / total_cost_usd=51590.3698 / average_latency_ms=16578.36 / average_ttft_ms=5288.97 / stream_calls=11170 / unique_tokens=13 / channels=9 / models=25` —— **与 T6 服务层结果完全一致** |
| `/requests?...&page=1&page_size=2` | 200；真实明细含 `channel_name:"Command Code"`（**证明 `LEFT JOIN channels` 在生产数据上生效**）、`retry_chain`、`is_failed`、`fail_status_code`、`ttft_ms`、`cache_ratio` |
| `/usage?...&dimension=token&limit=3` | 200；逐 key 的 `calls / success_calls / failure_calls / tokens / cost_usd / average_latency_ms / share` |
| `range=nonsense` | `{"success":false,"message":"不支持的 range: nonsense"}` —— 不返回 500 |
| `dimension=not-a-dimension` | `{"success":false,"message":"不支持的 dimension: not-a-dimension"}` |
| `page=-5&page_size=999999` | **被收敛为 `page=1, page_size=500`**，符合契约 ≤500 |

`{"success":false,...}` 配 HTTP 200 是**上游既有约定**（`common/gin.go:199 ApiError`），非本改造引入。

（临时 harness `t6http/` 用后即删，未入库。）

---

## 2026-09-23 复验 **GATE: ALL PASS**（追加记录）

本节为**追加**：不修改、不覆盖上文任何历史行。**本行取代此前快照中的统计值**（含 :72-74 的 `174 文件 / 2148 用例`、专项 `9 文件 / 55 用例`）——那些数字对应当时的代码快照，此后新增用例使其过时；旧行保持原样仅作历史留痕，**凡与本节冲突以本节为准**。

### 命令与原始输出要点

```
$ bun run test                      # web/，全量
 Test Files  175 passed (175)
      Tests  2169 passed (2169)

$ bun run test src/features/observability    # observability 专项
 Test Files  10 passed (10)
      Tests  75 passed (75)

$ bun run typecheck                 # tsgo -b
exit 0

$ bun run build                     # rsbuild build
ready   built in 4.88s              # bundle: dist/static/js/index.986e5224db.js

$ bun run lint                      # oxlint
182 error（全部为上游既有），observability 路径贡献 0

$ GOPROXY=https://goproxy.cn,direct GOSUMDB=off go build ./...   # exit 0
$ … go vet ./controller/observability/... ./service/observability/...   # exit 0
$ … go test -count=1 ./controller/observability/... ./service/observability/...
ok  controller/observability  1.007s
ok  service/observability     1.947s
```

- 前端全量 **175 文件 / 2169 用例**全绿；observability 专项 **10 文件 / 75 用例**全绿；`GATE: ALL PASS`。
- **本轮新增 3 条用例**：A-1 断言 ×2、JSON 导出截断覆盖 ×1。
- Go 顶层用例（工作区口径）：`controller/observability` **19**（HEAD 口径为 18，本轮新增 `TestWriteRequestsCSVMarksTruncation`）、`service/observability` **20**；两包全绿。
- 只读审计与三库方言审计复跑：产品代码 `Create/Update/Delete/Save/Exec/AutoMigrate/Raw` **0 命中**；`strftime/from_unixtime/date_trunc/json_extract` **0 命中**。

### 由本轮解除的「未验证」项

上文 2026-09-22 快照第 114 行记「`ERROR_LOG_ENABLED=true` 打开后失败事件是否真实落库：**未验证**」。本轮已在**本地**实例（新 darwin 产物、`ERROR_LOG_ENABLED=true`、副本库）完成端到端验证，结论与证据见 `observability/release/CHANGELOG-fork.md` 对应小节；**生产服务器本轮零改动**，生产侧仍待部署后复现。

---

## 2026-09-23 obs.4 打包轮 **GATE: ALL PASS**（追加记录）

本节为**追加**：不修改、不覆盖上文任何历史行。本轮为 obs.4 打包 + 本地实例切换 + **真实 HTTP 端到端**（Top 排行改造）。

### 命令与原始输出要点

```
$ bun run test                      # web/，全量
 Test Files  175 passed (175)
      Tests  2171 passed (2171)

$ bun run test src/features/observability    # observability 专项
 Test Files  10 passed (10)
      Tests  77 passed (77)

$ bun run typecheck                 # tsgo -b   -> exit 0
$ bun run build                     # 新 bundle: dist/static/js/index.3922608061.js
$ bun run lint                      # 182 error（全部为上游既有），observability 路径贡献 0

$ GOPROXY=https://goproxy.cn,direct GOSUMDB=off go build ./...            # exit 0
$ … go vet ./controller/observability/... ./service/observability/...     # exit 0
$ … go test -count=1 ./controller/observability/... ./service/observability/...
ok  controller/observability  2.748s
ok  service/observability     2.519s
# 顶层用例：grep '^func Test' 汇总 40（controller 19 + service 21）；=== RUN 共 84（顶层 39 + 子用例）
```

- 前端全量 **175 文件 / 2171 用例**全绿；observability 专项 **10 文件 / 77 用例**全绿；`GATE: ALL PASS`。
- **Go 用例（工作区口径）**：顶层 `grep '^func Test'` 汇总 **40**（`controller/observability` **19** + `service/observability` **21**，后者分布在 `monitoring_service_test` 6 / `query_test` 3 / `summary_service_test` 7 / `usage_service_test` 5）；`=== RUN` 行**共 84**（顶层 39 + 子用例）。两包全绿。
- **i18n**：7 语言逐 key 比对，相对分叉点每语言**新增 [67] / 删除 [0]**（6778 → 6845）；工作区未提交批次为 +7 / -5（净 +2）；7 语言 key 集**完全一致**。

### 本批三项改动（Top 排行）

1. 排行口径按 **`total_tokens` 降序**（原按金额 `quota`）。
2. 比例条按 **token** 归一；主显 token 数、副行「调用数 · 金额」。
3. 同一 token 按 **`logs.token_id` 唯一分组**、名字取 `tokens` 表当前值（改名不再拆行）。

### 独立复验

本批改动已由独立验证 agent 复验 **VN1–VN5 全 PASS**；本机另以真实 HTTP（管理端 JWT → `/api/observability/summary?range=7d`）与副本库手工 SQL 交叉核对 `top_tokens`/`top_channels`/`top_models` 的 `token_id` 唯一性、`total_tokens` 降序与逐位数值，详见 `observability/release/CHANGELOG-fork.md`「Top 排行改造的端到端验证」小节。**生产服务器本轮零改动**。

---

## 2026-09-24 obs.5 打包轮（追加记录）

本轮把工作区的 **batch 2 + batch 3** 改动（口径 v2、用量页当前名、健康度柱条铺满、MySQL 保留字、i18n +68 key / 删 6 孤儿 key）编译为 **obs.5** 双平台产物，并切本地实例供真机验收。**生产服务器零改动**（未 ssh / 未 scp / 未改 systemd）。

### 命令与原始输出要点

```
$ BASE=$(git merge-base upstream/main HEAD)      # 9310231b3
$ git diff --shortstat "$BASE" -- . ':(exclude)observability'
 58 files changed, 9546 insertions(+), 12 deletions(-)     # A=46 / M=12，与 obs.4 同为 58/46/12，仅插入 +314

$ bun run build        # rc=0；新 bundle dist/static/js/index.be36a0f361.js
$ bun run test         # Test Files 175 passed (175) / Tests 2176 passed (2176)
$ bun run test src/features/observability   # 10 passed (10) / 82 passed (82)

$ GOPROXY=https://goproxy.cn,direct GOSUMDB=off go build ./...            # exit 0
$ … go vet ./controller/observability/... ./service/observability/...     # exit 0
$ … go test -count=1 ./controller/observability/... ./service/observability/...
ok  controller/observability  1.926s
ok  service/observability     3.093s
# 顶层用例：grep '^func Test' 汇总 45（controller 19 + service 26）；=== RUN 共 89

$ shasum -a 256 new-api-linux-amd64
6ee57d20f043c8966d9767d7b50f63839f4f577ddebe46fa907cb07f42d7b0d2   138,682,530 字节
$ shasum -a 256 new-api-darwin-arm64
2d72c874a3364cbfbb02061ae410f2112ad8858857f4acc28aa3fccafb63d68c   139,657,570 字节
```

- 前端全量 **175 文件 / 2176 用例**全绿；observability 专项 **10 文件 / 82 用例**全绿；主控另跑 `~/.hermes/scripts/obs-gate.sh` → `GATE: ALL PASS`（G1–G8b，exit=0，日志 `/tmp/.gate3.txt`）。
- **Go 用例（工作区口径）**：顶层 `grep '^func Test'` 汇总 **45**（`controller/observability` **19** + `service/observability` **26**，后者分布在 `monitoring_service_test` 6 / `query_test` 3 / `summary_service_test` 11 / `usage_service_test` 6）；`=== RUN` 行**共 89**。两包全绿。
- **产物结构性验证（本轮前端确已重打进产物）**：在 obs.5 darwin 产物内 `strings` 命中本轮新增文案 `Failures counted since error logs were enabled` ×8、`Failures are estimated; enable error logs for exact counts` ×8；在 obs.4 产物（`.obs4-bak`）内二者均 ×0。另一条新增文案 `{{calls}} calls · {{amount}}` 含非 ASCII 中点 U+00B7，`strings` 默认只取可打印 ASCII 会漏检，改以字节检索证明（`LC_ALL=C grep -ac`）：obs.5 = 2 且旧键 `… · {{tokens}}` = 0；obs.4 = 2 且旧键 = 1。内嵌 bundle 名 `index.be36a0f361.js`，与 obs.4 的 `index.3922608061.js` **不同**。
- **本地实例**：`pkill -f new-api-darwin-arm64`（旧 PID 90133）→ 13000 端口释放；以 obs.5 darwin 二进制启动，环境与 obs.4 逐项一致（`PORT=13000`、`NODE_TYPE=slave`、`ERROR_LOG_ENABLED=true`、`SQLITE_PATH=…/one-api-verify.db`、日志 `/tmp/obs-verify-server.log`）。新 **PID 48737**，启动横幅 `高小鸡 v1.0.0-rc.40-obs.5 … ready in 131 ms`；`/api/status` 免鉴权返回 `version = v1.0.0-rc.40-obs.5`；`/api/observability/summary` 未带凭证 = 401；服务端 `index.html` 引用 `index.be36a0f361.js`，下载后与 `web/dist` 产物 `cmp` **逐位一致**（sha256 均 `1c3bae59…`）。
- **快照库未被替换**：`one-api-verify.db` 前后 sha256 均 `bce9b592…`、字节数 29,253,632 未变。
- **回滚点**：新增 `new-api-{linux-amd64,darwin-arm64}.obs4-bak`（= obs.4，sha256 `a0232615…` / `167ff7af…`）；`*.obs1-bak` / `*.obs2-bak` / `*.obs3-bak` 与 `one-api-verify.db.pre-prodsync-*` / `.pre-errlog-*` / `.bak-pw-*` 一律保留。

### 口径 v2（本批核心）

总数一律取 `logs`（`type=2`）行数；失败在错误日志开启时取 `type=5` 行数、关闭时取 perf_metrics 估算值（**截断到不超过总数**）；成功 = 总数 − 失败（下限 0），三项恒加得平；成功率 = 成功 ÷ 总数（总数 0 不为 NaN）。前端按 `failure_source` 标注「准确 / 估算」。逐条依据与实测见 `observability/release/CHANGELOG-fork.md` 第④–⑥条目。

### 未验证 / 需真机目视

- **MySQL / PostgreSQL 未实测**：本轮 MySQL 保留字修复（`dimensionKeyAlias`）由 batch 3 在真实 MySQL 8.4 上验证过 5 个维度；但**完整三库矩阵（含 PostgreSQL）本轮未跑**，SQLite 为本机唯一实测引擎，呼应 AGENTS.md「三库需真实实例验证」的要求，仍属**未闭环项**。
- **需鉴权接口的端到端验证（JWT）由主控执行**，本打包轮未触碰凭据、未做带鉴权请求。
- **前端视觉呈现需真机目视**（健康度柱条铺满、失败来源标注、Top 榜版式、用量页当前名）。

## 2026-09-24 obs.6 打包轮（追加记录）

本轮为**纯前端改动**（obs.6 批 1 两处 UI 修正，用户真机验收提出）：A 请求监控「密钥」列去掉独立 `CopyButton`、改 pill 本体可复制；
B 用量矩阵独占整行 + 表格 `w-full table-fixed`。Go 侧零代码变化。仓库 `feat/observability` @ `cfc418f3c`（未提交，工作区 49 项）。

### 前提：dist 早于源码，必须先重建前端

```
$ ls -la web/dist/static/js/index.be36a0f361.js        # 重建前
-rw-r--r--@ 1 gaoxiaoqi  staff  4738752 Sep 24 09:51 web/dist/static/js/index.be36a0f361.js
$ ls -la web/src/features/observability/components/monitoring-page.tsx
-rw-r--r--@ 1 gaoxiaoqi  staff  33353 Sep 24 10:23 web/src/features/observability/components/monitoring-page.tsx
$ ls -la web/src/features/observability/components/usage-page.tsx
-rw-r--r--@ 1 gaoxiaoqi  staff  17703 Sep 24 10:24 web/src/features/observability/components/usage-page.tsx
```

即 `dist`（09:51）早于两处源码（10:23–10:24）。不重建前端则产物内嵌的仍是旧界面。

### 命令与原始输出要点

```
$ cd web && bun install --frozen-lockfile
bun install v1.4.2 (744846f84)
Checked 1226 installs across 1340 packages (no changes) [291.00ms]
$ bun run build
dist/static/js/index.49f0c75cc6.js   4738.8 kB    1354.7 kB      # Total: 66262.9 kB / 20453.3 kB，rc=0
$ ls -la web/dist/static/js/index.49f0c75cc6.js
-rw-r--r--@ 1 gaoxiaoqi  staff  4738752 Sep 24 10:32 web/dist/static/js/index.49f0c75cc6.js

$ CGO_ENABLED=0 GOOS=linux  GOARCH=amd64 GOWORK=off go build -trimpath \
    -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.40-obs.6'" \
    -o ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64 .       # exit 0
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 GOWORK=off go build -trimpath \
    -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.40-obs.6'" \
    -o ~/.hermes/cache/scratch/obs-t6/new-api-darwin-arm64 .      # exit 0

$ shasum -a 256 new-api-linux-amd64
bb633ff388b5ef63c98e7a43bc893a4147804fc0d1c26d6c904ebfef6f5c923c   138,678,434 字节
$ shasum -a 256 new-api-darwin-arm64
10e570d5aae66fb158b19da5fbfecc47ce601ce7878eb67b703ebb89912acb23   139,657,570 字节
```

### 三条差分标记（本轮最关键判据）

**基线先在 obs.5 的 dist 上复现**（改前），再验证翻转（改后）。两处改动都在**懒加载 async chunk** 里，只查 `index.*.js` 会假阴性。

```
# obs.5（重建前 dist，基线复现）
$ grep -roF "size-5 shrink-0 opacity-60" web/dist/static/js/ | wc -l   → 1
$ grep -rloF "border-spacing-0.5" web/dist/static/js/                  → web/dist/static/js/async/11628.de5c826dc0.js
$ grep -oF "w-full table-fixed" web/dist/static/js/async/11628.de5c826dc0.js | wc -l   → 0

# obs.6（重建后 dist）
$ grep -roF "size-5 shrink-0 opacity-60" web/dist/static/js/ | wc -l   → 0   ✅（1 → 0）
$ grep -rloF "border-spacing-0.5" web/dist/static/js/                  → web/dist/static/js/async/11628.542856c2bc.js
$ grep -oF "w-full table-fixed" web/dist/static/js/async/11628.542856c2bc.js | wc -l   → 1   ✅（0 → ≥1）
# border-spacing-0.5（定位用）仍 ≥1，chunk 名由 11628.de5c826dc0 → 11628.542856c2bc
```

**产物二进制内以字节口径复核**（`LC_ALL=C grep -ac`，两平台同值）：

| 标记 | obs.5 bin | obs.6 bin |
|---|---|---|
| `size-5 shrink-0 opacity-60` | 1 | **0** |
| `w-full table-fixed` | 0 | **1** |
| `border-spacing-0.5` | 1 | **1** |

**新旧 chunk 名双向消失/出现**（同一二进制，`LC_ALL=C grep -ac`）：`33877.50f6d2625d` 3→**0**、`33877.f2dddc6b60` —→**3**；
`11628.de5c826dc0` 1→**0**、`11628.542856c2bc` —→**1**。内嵌主 bundle 由 `index.be36a0f361.js` 变为 `index.49f0c75cc6.js`。
两平台自报版本串均为 `v1.0.0-rc.40-obs.6`（二进制内字节口径）。

### 本地实例（obs.6 darwin）

- `pkill -f new-api-darwin-arm64`（旧 PID 48737，obs.5）→ 以 obs.6 darwin 二进制启动，环境与 obs.5 **逐项一致**：
  `PORT=13000`、`NODE_TYPE=slave`、`ERROR_LOG_ENABLED=true`、`SQLITE_PATH=…/one-api-verify.db`、日志 `/tmp/obs-verify-server.log`；
  cwd 亦与旧进程一致（`~/.hermes/cache/scratch/obs-t6`）。**新 PID 87932**，启动横幅
  `New API v1.0.0-rc.40-obs.6 started` / `高小鸡 v1.0.0-rc.40-obs.6 … ready`。
- 免鉴权自证：`/api/status` 返回 `"version":"v1.0.0-rc.40-obs.6"`；服务端 `index.html` 引用 `static/js/index.49f0c75cc6.js`，
  下载后与 `web/dist` 同名文件 `cmp` **逐字节一致**（sha256 均 `6606bb0f33bb3df14829beb3aca4399c19e4087cde867918b94b6dfbdc184192`）。
  两个新 async chunk 亦经 HTTP 取回并与 `web/dist` `cmp` 一致：`11628.542856c2bc.js`（17,525 B）、`33877.f2dddc6b60.js`（28,620 B）。
- **快照库未被替换/重建**：`one-api-verify.db`（29,257,728 B）shasum 在「停止旧实例后」（10:33:45）与「obs.6 启动后」
  两次均为 `c73d9756ad5df59a8aefbc8f96527a7d4b5feac66ed52f22c8b225bb20af00d7`，**字节数与 mtime 均未变**（`-wal` 仍 0 B）。
- **但「sha256 前后不变」这个判据对运行中的库不成立（本轮实测，重要）**：再往后取该库 sha 即变化
  （`c73d9756…` → `f4a9d073…`，mtime 由 10:33:45 前进到 10:38:05）。逐 30s 连采四次的原始输出：

  ```
  10:38:47  sha=f4a9d0739a56  size=29257728  mtime=10:38:05
  10:39:17  sha=9d4cdeba50a1  size=29257728  mtime=10:39:05
  10:39:47  sha=9d4cdeba50a1  size=29257728  mtime=10:39:05
  10:40:17  sha=3cd2c461aaca  size=29257728  mtime=10:40:05
  ```

  与应用日志逐分钟对齐，成因是本程序每 60s 的周期任务在**写**该库（`syncing options from database`、`正在更新数据看板数据`
  → `保存数据看板数据成功，共保存0条数据`），故 mtime 每分钟 :05 前进、页面 sha 随之变化。
  **结论：运行中的 SQLite 库不具备稳定的 sha 身份；「前后 sha256 不变」只能以「实例停止态」或「停止态副本」为基准。**
  本轮的可证事实改为**「库文件未被替换/重建」**——该库 inode 恒为 `28293172`、size 恒为 29,257,728，且
  `SQLITE_PATH` 指向的文件自始至终是同一个（未被 `rm`/重建/换名）；生产快照库 `one-api-prod-snap-20260923-224404.db`
  （29,249,536 B，09-23 22:45）原样在场、未被替换。
  > 纪律声明：未按 obs.1–obs.5 的历史经验用「sha 前后一致」当结论——该判据在本环境**对运行中的库会假失败**，
  > 故据实改以 inode + size + 写入来源举证。
- **回滚点**：新增 `new-api-{linux-amd64,darwin-arm64}.obs5-bak`（= obs.5，sha256 `6ee57d20…` / `2d72c874…`）；
  `*.obs1-bak`–`*.obs4-bak` 与三条 DB 回滚点（`one-api-verify.db.pre-prodsync-*` / `.pre-errlog-*` / `.bak-pw-*`）一律保留。

### 改动规模（稳定口径复算）

```
$ BASE=$(git merge-base upstream/main HEAD)      # 9310231b3
$ git diff --shortstat "$BASE" -- . ':(exclude)observability'
 58 files changed, 9572 insertions(+), 12 deletions(-)     # A=46 / M=12，与 obs.5 分类一致，仅插入 +26
```

本轮 +26 行全部来自两处前端改动（+7 行级别的 A 改动与 B 改动）与随之的测试/夹具调整，未新增文件、未改上游文件。

### 未验证 / 待主控

- **需鉴权接口的端到端验证（JWT）由主控执行**：本打包轮**未触碰凭据、未做带鉴权请求**（纪律要求）。
- **前端视觉呈现需真机目视**：本轮的 A（pill 本体可复制、点击 `stopPropagation` 不触发行展开）与
  B（矩阵独占整行、`table-fixed` 均分列宽、≥lg 免横向滚动）都属**视觉/交互**，本打包轮只证到
  「新前端确已打进产物并由实例提供」，**未做浏览器交互验证**。
- **MySQL / PostgreSQL 未实测**：同上一轮，本批未触及后端与 SQL，三库矩阵仍为**未闭环项**（继承 obs.5 结论）。

