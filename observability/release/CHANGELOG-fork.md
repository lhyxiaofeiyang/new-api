# 本次改造的更新说明

## v0.1.0（待发布）

基于上游 **`upstream/main`**（`v1.0.0-rc.40` + `#7504`）。

### 新增功能

- **可观测性 · 仪表盘**（`/observability/overview`）
  今日/24h/7d/30d 概览：调用数、Token 拆分（提示/补全/缓存/合计）、成本、平均延迟与首字节、RPM/TPM、
  Top 模型 / Top API Key / Top 渠道、流量趋势、按小时分布（小时 of day）、请求健康时间线。
- **可观测性 · 请求监控**（`/observability/monitoring`）
  按 API Key / 渠道 / 渠道类型 / 模型 / 分组 / 流式筛选的请求明细，含重试链与计费还原，支持脱敏导出 CSV/JSON。
- **可观测性 · 用量分析**（`/observability/usage`）
  API Key / 渠道 / 渠道类型 / 模型 / 分组多维聚合，成本与 Token 拆分、趋势、热力矩阵，支持下钻到明细。

### 数据与权限

- 全部为只读查询，仅使用 New API 现有表（`logs` / `channels` / `tokens` / `users`），**未新增或修改任何表结构**。
- 端点前缀 `/api/observability`，与既有 `/api/log` 同样走 `AdminAuth` 管理员鉴权。
- 导出内容不含密钥、不含请求/响应正文。

### 对上游代码的改动（首批 4 个侵入点 = 3 处手改 + 1 处生成物；后追加第 5 个，见下节）

**改动规模（稳定口径：以 merge-base 为基线，且排除 `observability/` 文档后统计）。** 本 fork 对上游的改动量
用下面这条命令复算。两个稳定性来源：① 基线取 `merge-base upstream/main HEAD`（**分叉点**），而不是 `upstream/main`
本身——上游每天都有新提交，用 `upstream/main` 当基线时同一个工作区隔天量出的数字就会变；② 统计范围排除
`observability/`（plan / release / scripts 等自有文档），否则本目录自身的编辑会不断改变总量：

```bash
# 基线 = 与上游的分叉点（不随上游新提交漂移）
BASE=$(git merge-base upstream/main HEAD)

# 主口径：排除 observability/ 文档，统计对上游的产品代码改动
git diff --shortstat "$BASE" -- . ':(exclude)observability'
# 分文件计数（A=新增、M=修改既有、D=删除）
git diff --name-status "$BASE" -- . ':(exclude)observability' | awk '{print $1}' | sort | uniq -c
```

**实测（工作区口径，基线 `9310231b3`，2026-09-23（obs.4 打包轮）复算：`58 files changed, 9232 insertions(+), 12 deletions(-)`）**，
其中 **12 个既有文件被修改**（M）、46 个为新增（A）。`M` 的 12 个即第 2 节登记的 12 个既有文件
（11 条侵入点 + 1 个并入第 5 项登记的测试文件）。

> **2026-09-24（obs.5 打包轮）复算（同一命令、同一基线，仅加注、不改上文）**：`58 files changed, 9546 insertions(+), 12 deletions(-)`
> —— 文件数（58）、新增数（46 A）、修改数（12 M）、删除数（12）与 obs.4 完全一致，**仅插入行数由 9232 增至 9546（+314）**，
> 全部来自 obs.5 入库的「成功率口径 v2 / 用量页当前名 / MySQL 保留字别名修复」三批改动**改写既有文件**（未新增文件，故 A/M 分类不变）。
> 该 +314 与下节 obs.4 记录的 `8449 + 1081 = 9530` 亦不相等，进一步印证「两口径不可加和」。

> 已提交口径（同命令把 `HEAD` 加到 diff 末尾：`git diff --shortstat "$BASE" HEAD -- . ':(exclude)observability'`）
> 为 `56 files changed, 8449 insertions(+), 7 deletions(-)`；与工作区口径差 +783 插入 / +5 删除，即「后续改动（未提交批次）」的
> 产品代码部分（直接实测 `git diff --shortstat -- . ':(exclude)observability'` = `38 files changed, 1081 insertions(+), 303 deletions(-)`）。
> 两口径**不是**简单相加关系：聚合层（`git diff`）与提交层（`git diff HEAD`）对 `A/M/D` 的归类不同——obs.3 轮次时曾出现
> `8449 + 575 = 9024` 的巧合式自洽，但该等式**不具备一般性**，obs.4 轮次已不再成立（`8449 + 1081 = 9530 ≠ 9232`）。
> 复算改动规模一律以 `git diff --shortstat "$BASE" -- . ':(exclude)observability'` 的工作区口径为准。
>
> **不要用 `upstream/main` 直接当基线**：`git diff --shortstat upstream/main -- . ':(exclude)observability'`
> 会在上游有新提交时给出不同答案（本次实测 `62 files changed, 9272 insertions(+), 212 deletions(-)`：比工作区多 4 个文件、多 40 行新增、
> 多 200 行删除，多出的这些全部来自上游自己的改动，不是本 fork 的）。
> 含 `observability/` 文档的全量口径同理不稳定（编辑本文件本身就会改变它），故不列出具体数字。

相对 `upstream/main`，除上表列出的既有文件外，**无任何其他既有文件被触碰**。

| 文件 | 改动 | 性质 |
|---|---|---|
| `router/api-router.go` | 新增 `/api/observability` 路由组（+9 行，套 `middleware.AdminAuth()`） | 手改 |
| `web/src/hooks/use-sidebar-data.ts` | 侧边栏新增「可观测性」分组（分组名后改为「Token 监控」），紧随 `general` 之后（工作区口径实测行号 `chat:63 → general:79 → observability:117 → personal:138 → admin:159`；已提交 `HEAD` 为 `60 → 76 → 114 → 135 → 156`，差额来自未提交批次把 `navGroups` 抽为 `buildNavGroups` 时新增的 6 行 JSDoc，并非分组位置变动） | 手改 |
| `web/src/i18n/locales/*.json`（7 语言） | 逐 key 比对（7 语言完全一致）：相对分叉点 **+67 key / -0（6778 → 6845）**，其中已提交 `HEAD` 为 **6843**（+65）、未提交批次再 **+7 / -5（净 +2）** 至工作区 **6845**。其中首批 `09c9bcf8a` 为 +55 key / 0 删除（6778 → 6833），`cfc418f3c` 再 +10（补「实时流量」等缺失译文）；未提交批次新增 `Export truncated to {{exported}} of {{total}} rows`、`From consumption logs`、`Hourly distribution (hour of day)`、`Requires error logs`、`Token Monitoring`、`{{calls}} calls · {{amount}}`、`{{tokens}} tokens`，删除首批自加的整页错误日志提示 4 条与旧标题 `24h Activity Distribution`（移除 5 条：`24h Activity Distribution`、`Enable error logs to track failures`、`Error logs are disabled on this instance, so failure counts, the success rate and the request health timeline show no data.`、`Failure details are unavailable`、`Per-request failure details require error logs, which are disabled on this instance`）<br>**2026-09-24（obs.5）加注**：以 `grep -c '":'` 实测，工作区现为 **6847**、分叉点 **6779**，即 **+68 / -0**（7 语言等量）。上句 obs.4 的 +67（6778 → 6845）用另一口径计得，两端各差 1，**加注不改上文**；obs.5 本轮新增的两条文案是 `Failures counted since error logs were enabled` 与 `Failures are estimated; enable error logs for exact counts` | 手改 |
| `web/src/routeTree.gen.ts` | **+45 / -0** 纯追加，由 `web/rsbuild.config.ts:93` 的 `@tanstack/router-plugin` 在构建时自动重生成 | **生成物（不手改）** |

其余 46 个文件均为新增，不影响上游既有页面与接口行为。升级上游的合并方式见 `UPGRADE-MERGE.md`。

### 后续改动（未提交批次）

在上面 4 个侵入点之后又叠加了**两批**改动，其中只有第②批新增了侵入点：

**① 请求监控页对齐「使用日志」+ 各页错误日志开关的就地提示**

> 本批**未新增侵入点**：改动全部落在本 fork 的自有文件
> （`web/src/features/observability/*`）+ 已登记的第 2、3 项（`use-sidebar-data.ts`、7 个语言包）。

- 顶部横幅撤掉：仪表盘原本在关闭错误日志时整页弹一条 Alert，改为在**受影响的局部**就地标注（失败列、请求健康时间线、状态列、请求监控的「只看失败」开关均标「需错误日志」），不再整页打断。
- 侧边栏分组名与无权限占位页标题「可观测性」→「**Token 监控**」（新增 i18n key `Token Monitoring`，7 语言；三个页面各自的标题仍是「仪表盘 / 请求监控 / 用量分析」，未改）。
- 请求监控 token 列：原先展示「提示/补全/缓存/合计」四段，改为只显示**总 Token 数**（列名改为 `Total Tokens`），三个拆分维度保留在展开明细里。
- 请求监控渠道列与令牌列**对齐「使用日志」样式**：渠道用 `#id` 取色 pill + 名称次行、渠道类型移入 tooltip；令牌用带 `KeyRound` 图标 pill + 分组次行。
- 请求监控新增**用户列**（后端 `users` JOIN 出 `username`），并删除额度列。
  > 该项已包含在提交 `cfc418f3c` 中，非当前未提交批次。
- 修复：新增 `users` JOIN 后 `/summary` 报 `ambiguous column name: quota`（`users` 表同有 `quota` 列），改为只暴露 `id/username` 的派生表 `LEFT JOIN (SELECT id, username FROM users) AS u`；测试夹具补上 `users.quota` 以忠实还原 schema、永久挡住该类回归。
- 修复：`ObservabilityUsageResponse` 前端类型漏了后端本就返回的 `data_source` 字段，导致用量分析页读不到错误日志开关（已补类型，并在 `EMPTY_USAGE_RESPONSE` 中给出默认值）。

**② API 密钥页「名称」「分组」列新增升序/降序按钮 —— 第 5 个侵入点**

- 与「用户」页一致的同款表头排序控件（`DataTableColumnHeader`）。
- 改动仅 1 个文件、+7 行：在 `api-keys-table.tsx` 的 `useDataTable` 调用处加 `enableSorting: true` 与 `withSortedRowModel: true`（后者是必需的，因为服务端分页下 DataTable 默认不挂排序行模型，只开 `enableSorting` 会得到点不动的假按钮）。
- **已知限制（重要）**：keys 列表接口没有排序参数（后端 `model/token.go` 写死 `Order("id desc")`），因此这是**纯客户端排序，只对当前页已加载的数据生效**，不是整库排序——第 2 页的密钥不会因为点「升序」而进入当前视野；排序也不会触发重新请求。密钥更多、需要整库排序时的前后端改造入口已写入 `UPGRADE-MERGE.md` 第 2.1 节。

第②批使**相对 `upstream/main` 被修改的既有文件从 10 个增至 12 个**（新增 `web/src/features/keys/components/api-keys-table.tsx`、`web/src/features/keys/components/__tests__/api-key-listing.test.tsx`，二者均为上游自带文件），其中 `api-keys-table.tsx` 是**第 5 个侵入点**；同批的测试文件并入该项登记，未单列新侵入点。规模数字见上一节的稳定口径（本批次即该处「已提交 vs 工作区」的差额）。

**③ Top 排行改造（token / 模型 / 渠道）—— 未新增侵入点**

> 全部改动落在本 fork 自有文件（`service/observability/*`、`controller/observability/*`、
> `web/src/features/observability/*`）与已登记的第 3 项 7 个语言包，**未新增侵入点**。

- **口径改为按 `total_tokens` 降序**：原实现按 `quota`（金额）排序，现改为按 token 量排序——看板以 token 为主指标，
  金额退为副信息。三张 Top 榜（`top_tokens` / `top_models` / `top_channels`）一致。
- **比例条按 token 归一**：条形宽度取该行 `total_tokens / 榜首 total_tokens`，不再按金额。
- **主副信息对调**：主显 **token 数**，副行显示「调用数 · 金额」（i18n key `{{calls}} calls · {{amount}}`）。
- **同一 token 按 `logs.token_id` 唯一分组（关键修复）**：原实现按 `logs.token_name` 分组，而用户在 `tokens` 表**改名**后
  旧日志仍保留历史名，于是同一个 token 会**裂成多行**。现改为按 `token_id` 分组、**名字取 `tokens` 表当前值**（改名不再拆行）。
  实测（本地副本 7d 窗口）：token 4「mac | Hermes | OpenAI」修复前按名分组为两行
  `mac | Hermes | OpenAI`（351 次 / 39,340,882 tokens）+ `【Mac】Hermes——OpenAI`（1022 次 / 141,717,880 tokens），
  合并后为单行 **1373 次 / 181,058,762 tokens**，与 `group by token_id` 的手工 SQL 逐位一致。

**④ 成功率口径 v2（用户 2026-09-23 裁决；obs.5 入库）—— 未新增侵入点**

> 改动落在本 fork 自有文件（`service/observability/*`、`controller/observability/*`、
> `web/src/features/observability/*`）与已登记的第 3 项 7 个语言包，**未新增侵入点**、未改上游文件。

原实现在三个数据源之间切换「总调用 / 成功 / 失败 / 成功率」，出现三种自相矛盾（主控实测）：

1. **开错误日志后历史失败归零**：失败只数 `logs.type=5`，日志刚开 → 失败 0、成功率 99.79%（关闭时为 95.38%）。
2. **33 行悬空**：成功判据是 `use_time > 0`，`type=2 且 use_time=0` 的行既不算成功也不算失败 → `15,649 ≠ 15,616 + 0`。
3. **两源总数差一倍多**：`logs` 15,649 vs `perf_metrics` 7,010；perf 逐日覆盖率 113%→28.8%，**覆盖面不可靠**。

裁决口径（`service/observability/summary_service.go`）：

- **总数**一律取窗口内 `logs` 中 `type = 2` 的行数（不再用 perf_metrics 的 `request_count`）。
- **失败**：错误日志开启 → `logs.type = 5` 行数（准确值）；关闭 → perf_metrics 各桶 `request_count − success_count` 求和（下限 0）。
- **成功 = 总数 − 失败**（下限 0），**三项恒加得平**；`use_time = 0` 的悬空行自然归入成功。
- **成功率 = 成功 ÷ 总数 × 100**（总数 0 时不得 NaN）。
- **失败数截断**：`failureCalls = min(failureCalls, totals.Calls)`。两种来源都可能超额——开启时重试会为同一次请求写出多条
  `type=5`；关闭时 perf_metrics 的桶覆盖窗口与 logs 的行范围不一致（实测逐日覆盖率 113%→28.8%）。截断后成功数下限 0，三项加得平。
- **前端标注来源**（属裁决内容）：开启 → 「失败统计自开启错误日志起」；关闭 → 「失败为估算值，开启错误日志后转为准确统计」。
  依据 `data_source.failure_source`（`error_log` / `perf_metrics`）渲染，文案走 i18n、7 语言等量补齐。

**⑤ 用量分析页 token 标签取当前名（obs.5 入库）—— 未新增侵入点**

- 现象：用量分析页 `dimension=token` 用**历史名**显示 token，与仪表盘 Top 排行（用当前名）不一致。
- 根因（`service/observability/usage_service.go:26`）：token 维度 `labelSelect: "MAX(logs.token_name)"` 取的是请求发生时的历史名。
- 改法：token 维度加 `join: tokensJoin`（复用 `summary_service.go` 的派生表，只暴露 `id/name` 以免同名键歧义），
  label 改为 `COALESCE(NULLIF(MAX(tk.name), ''), MAX(logs.token_name), '')` —— 找不到/名称为空时**回退历史名**，不显示空。
  **分组仍是 `logs.token_id`（未动）**，改名不拆行。
- 同类审计结论（只报告、不扩大改动）：请求明细表 / CSV 导出 / 关键字搜索**仍应显示历史名**（逐条审计视图与「按旧名找记录」是期望行为），
  **不改**；渠道维度本就取当前名（`channel_name` 是只读列，从不落历史快照），不存在同类问题。

**⑥ MySQL 保留字别名缺陷修复（obs.5 入库，既有缺陷、非本批引入）—— 未新增侵入点**

- 修 ⑤ 时用真实 MySQL 8.4 验证 GORM 生成的 SQL，暴露既有缺陷：聚合 SQL 用 `AS key`，而 `KEY` 是 MySQL 保留字 → `1064` 语法错，
  `/usage` 在 MySQL 上完全不可用（`git show HEAD:service/observability/usage_service.go` 三处均在）。
- 按 AGENTS.md「三库兼容」要求修复：`query.go` 新增 `dimensionKeyAlias()`（与既有 `logGroupColumn()` 同款方言分支），
  `usage_service.go` 三处应用。修复后同一 MySQL 上 token / channel / channel_type / model / group 五维度全部通过。

**⑦ obs.6 两处 UI 修正（用户真机验收提出）—— 未新增侵入点**

> 改动落在本 fork 自有文件（`web/src/features/observability/components/*`），**未新增侵入点**、未改上游文件；
> **Go 侧零代码变化**，本批为纯前端改动。

- **A｜请求监控「密钥」列去掉常显的独立复制按钮，改由 pill 本体可复制**（`monitoring-page.tsx` 的 `TokenCell`）：
  与「模型」列同一取舍——pill 带 `KeyRound` 图标、以 `copyable` 承载复制，点击时 `StatusBadge` 会 `stopPropagation`
  （代价：点 pill 不触发行展开；点行内其它位置仍可展开）。原先的「pill 不可复制 + 独立 `CopyButton`」方案作废——
  用户反馈那个常显的复制图标是多余的视觉噪音，模型列的做法才是本项目既有约定。
- **B｜用量分析「用量矩阵」独占整行 + 表格 `w-full table-fixed` 自适应**（`usage-page.tsx`）：
  矩阵是多列热力表，半宽放不下全部列（右侧被裁掉或只能横向滚动），故与「成本构成」各自**独占整行**；
  表格由固定布局改为 `w-full table-fixed border-separate border-spacing-0.5`，把整行宽度均分给各列，
  ≥lg 时通常不再需要横向滚动，窄屏仍保留 `overflow-x-auto` 兜底。
- **结构性验证（前端确已重打进产物，非仅改版本串）**：两处改动都在**懒加载 chunk**里，只查 `index.*.js` 会假阴性。
  改以「新旧 chunk 名双向消失/出现 + 标记翻转」证明，见下节产物小节与 `plan/04-verification.md` 本轮记录。
- **口径 v2（④）随本批次入库**：obs.5 / obs.6 同属 `v0.1.0` 未发布批次，口径 v2、⑤ 当前名、⑥ MySQL 别名修复均在
  obs.6 产物内（本批只改前端，后端未动，故 ④⑤⑥ 三条的实现原样继承）。

### 已知限制

- **失败率/失败明细依赖 `ERROR_LOG_ENABLED=true`**（New API 默认关闭）。未开启时该部分显示为不可用提示，
  成功率仅能由 `perf_metrics`（模型×分组粒度）近似。
  <br>**2026-09-24（obs.5）加注**：口径 v2 已取代此处的近似策略——总数一律取 `logs`（`type=2`），失败在开关关闭时取
  perf_metrics 估算值（并**截断到不超过总数**），成功 = 总数 − 失败，三项恒加得平；前端按 `failure_source` 标注「准确 / 估算」。
  上文「仅能近似」的描述保留为历史背景。
- **失败率在超出日志留存期的窗口会失真**：错误日志受 `LOG_RETENTION_DAYS` 约束，查询早于留存边界的窗口时
  失败数恒为 0，会以 100% 成功呈现。当前**未加留存边界判断**（超出本轮范围）。
- **`LEFT JOIN channels` 假设 logs 与 channels 同库**：若启用 `LOG_SQL_DSN`（ClickHouse 日志库），
  channels 在主库、logs 在 ClickHouse，跨库 JOIN 不成立，需改为上游式批量回查。**当前部署不适用**
  （unit `new-api.service` 无 `Environment=`、未装 ClickHouse、`LOG_SQL_DSN` 未设）。
- `reasoning_tokens` 无数据来源，未提供。
- 缓存 Token 仅提供合并值（New API 不区分 cache read / creation）。
- 未做预聚合；数据量增长到百万行级后需引入 rollup（架构已预留）。实测当前 1.4 万行、全窗口聚合在毫秒级。
- **未复用上游 `DataTablePagination`（能力缺口，按 `web/AGENTS.md` §四 记录）**：上游组件的页长阶梯写死在组件内、总行数取自客户端行模型，无法表达本接口契约的页长（最大 500）与服务端返回的 `total`；服务端分页下二者都对不上。故新写了 `web/src/features/observability/components/requests-pagination.tsx`，仅沿用同样的控件与版式。若后续上游把「页长阶梯」与「总数」提为 props，应改回复用并删除该文件。

### 未包含

CPA-Manager-Plus 的账号巡检、凭证池、OAuth 刷新、配额窗口、价格同步、自动冷却等模块（本改造范围明确排除）。

---

### 验证记录（均为实测，非推断）

| 项 | 结果 | 证据 |
|---|---|---|
| `go build ./...` / `go vet` | PASS | 本地复跑，`GOPROXY=https://goproxy.cn,direct GOSUMDB=off` |
| `go test`（新包） | PASS | `ok controller/observability 1.926s` / `ok service/observability 3.093s`（2026-09-24 obs.5 打包轮复测，`-count=1`）；**工作区口径** controller 19 + service 26 = **45 顶层用例**（`=== RUN` 共 89 条，其中顶层含 45，余为子用例），全用 `t.TempDir()` 临时 SQLite，无网络 |
| 只读审计 | PASS | 产品代码 `Create/Update/Delete/Save/Exec/AutoMigrate/Raw` **0 命中** |
| 三库方言审计 | PASS | `strftime/from_unixtime/date_trunc/json_extract` **0 命中**（时间条件走 `created_at >= ? AND created_at < ?`，分桶全在 Go 侧） |
| 前端 `typecheck` | PASS | `tsgo -b` exit 0 |
| 前端 `test` | PASS | 175 文件 / 2176 用例全绿；本功能专项 10 文件 / 82 用例全绿 |
| 前端 `build` | PASS | rsbuild 构建成功；obs.5 实测 bundle `dist/static/js/index.be36a0f361.js`；**obs.6 重建后为 `dist/static/js/index.49f0c75cc6.js`** |
| 前端 `lint` | 通过（有保留） | 全库 182 条 error 全部为**上游既有**；本功能贡献 0 条 |
| **数字一致性（T6）** | PASS | 生产库**只读副本**上直接调用真实服务层函数 vs 手工 SQL，窗口 2026-09-02 → 现在：`prompt/completion/total/cached tokens`、`quota`、`cost_usd`、`average_latency_ms`、`stream_calls`、`unique_channels/models`、Top5 模型 **逐位一致** |

**构建产物**（本地交叉编译，镜像上游 Dockerfile 的 `CGO_ENABLED=0` + `-s -w`）。各版本的记录都保留：

**obs.6（当前源码，`v1.0.0-rc.40-obs.6`，构建于 2026-09-24）**

```
$ shasum -a 256 new-api-linux-amd64
bb633ff388b5ef63c98e7a43bc893a4147804fc0d1c26d6c904ebfef6f5c923c   138,678,434 字节
$ shasum -a 256 new-api-darwin-arm64        # 本地测试用
10e570d5aae66fb158b19da5fbfecc47ce601ce7878eb67b703ebb89912acb23   139,657,570 字节
前端 bundle：index.49f0c75cc6.js
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.6（两平台自报一致，二进制内嵌串已核）
构建时间（本机 +08）：前端 2026-09-24 10:32；linux/amd64 10:32:49；darwin/arm64 10:32:54
```

> **本批为纯前端改动（Go 侧零代码变化），故必须证明「产物内嵌的是新前端」而不只是版本串变了。**
> 构建顺序是硬前提：`web/dist` 原为 09:51（= obs.5 那次），而两处源码改于 10:23–10:24，**dist 早于源码**；
> 本轮先 `bun run build` 重建（新 bundle 10:32）再交叉编译。
>
> **两处改动都在懒加载 async chunk 里，只查 `index.*.js` 会假阴性**，故用「新旧 chunk 名双向消失/出现」+「差分标记翻转」证明：
>
> | 标记 / chunk | obs.5 基线 | obs.6 实测 |
> |---|---|---|
> | `33877.50f6d2625d`（旧 chunk 名，二进制内） | 3 | **0** |
> | `33877.f2dddc6b60`（新 chunk 名，二进制内） | — | **3** |
> | `11628.de5c826dc0`（旧 chunk 名，二进制内） | 1 | **0** |
> | `11628.542856c2bc`（新 chunk 名，二进制内） | — | **1** |
> | `size-5 shrink-0 opacity-60`（被删的独立复制按钮 class，全 `web/dist/static/js/`） | **1** | **0** |
> | `w-full table-fixed`（矩阵新 class，`async/11628.*.js` 内） | **0** | **≥1**（实测 1） |
> | `border-spacing-0.5`（矩阵既有 class，定位用） | 1 | **1** |
>
> 二进制内以字节口径复核（`LC_ALL=C grep -ac`）：两平台均为 `size-5 shrink-0 opacity-60`=0、`w-full table-fixed`=1、`border-spacing-0.5`=1。
> 实例侧再经 HTTP 取回 `async/11628.542856c2bc.js`（200 / 17,525 B）与 `async/33877.f2dddc6b60.js`（200 / 28,620 B），
> 与 `web/dist` 同名文件 `cmp` **逐字节一致**。
>
> **一处易误判的坑（本轮实测记录）**：对不存在的 chunk 路径请求 `async/33877.50f6d2625d.js` 会返回 **200 + 1047 B**——
> 那是 SPA 兜底返回的 `index.html`（`file` 判为 `HTML document text`），**不是静态文件**。判「旧 chunk 是否已被移除」不能只看 HTTP 状态码，
> 必须 `cmp` 或核对字节/类型。

**obs.5（上一版，仅为历史记录，勿与上表混用）**

```
$ shasum -a 256 new-api-linux-amd64
6ee57d20f043c8966d9767d7b50f63839f4f577ddebe46fa907cb07f42d7b0d2   138,682,530 字节
$ shasum -a 256 new-api-darwin-arm64        # 本地测试用
2d72c874a3364cbfbb02061ae410f2112ad8858857f4acc28aa3fccafb63d68c   139,657,570 字节
前端 bundle：index.be36a0f361.js
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.5（两平台自报一致，`--version` 与二进制内嵌串均已核）
构建时间（本机 +08）：前端 2026-09-24 09:51:27；linux/amd64 09:51:42；darwin/arm64 09:52:15
```

> **obs.6 档（当前）**：本批**仅前端**改动，Go 侧零代码变化，故两平台尺寸与 sha256 的取值依据见上方 obs.6 小节的
> 「新旧 chunk 名双向消失/出现」表与 `plan/04-verification.md` 本轮记录——这是 obs.5 那条 `strings` 盲区之外的
> **第二种判据**（chunk 名双向核对 + 差分标记翻转），对本轮更适用：两处改动都在懒加载 async chunk 里，`strings` 命中
> `index.*.js` 会假阴性。

> **obs.5 档（历史，保留原样）**：本轮含口径 v2 + batch 2/3 改动，前端与后端都变了（详见下节「④ 成功率口径 v2」等条目），
> 故两平台尺寸较 obs.4 均有增长（linux +4,096 / darwin +64 字节），sha256 全新。
> **内嵌前端已换新（结构性验证，非仅看版本串）**：本轮新增文案在本 darwin 产物内 `strings` 命中
> `Failures counted since error logs were enabled` ×8、`Failures are estimated; enable error logs for exact counts` ×8；
> 在 obs.4 产物（`.obs4-bak`）内两者均 ×0 —— 证明内嵌的确是新前端，而非旧前端配上新版本号。
> 另有一条新增文案 `{{calls}} calls · {{amount}}` 因含非 ASCII 中点 U+00B7，`strings` 默认只取可打印 ASCII 而漏检，
> 改以字节检索证明（`LC_ALL=C grep -ac 'calls}} calls · {{amount}}'` → obs.5 = 2，obs.4 = 2；obs.4 另含被删除的旧键
> `… · {{tokens}}` ×1，obs.5 为 0，此消彼长亦说明前端已替换）。**这是一处 `strings` 方法的已知盲区，特此记录。**

**obs.4（上一版，仅为历史记录，勿与上表混用）**

```
$ shasum -a 256 new-api-linux-amd64
a0232615679891769795def579b167f8583227be9282286ab917494a5fee53b6   138,678,434 字节
$ shasum -a 256 new-api-darwin-arm64        # 本地测试用
167ff7af89cd9aff22f2456cf6360560658ba155a6ddef80cee5dba2ed671e5b   139,657,506 字节
前端 bundle：index.3922608061.js
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.4（两平台自报一致，`--version` 与二进制内嵌串均已核）
构建时间（本机 +08）：前端 2026-09-23 16:26；linux/amd64 16:26:49；darwin/arm64 16:27:34
```

> obs.4 的尺寸与 obs.3 **逐字节相同**（linux 138,678,434 / darwin 139,657,506）。原因已核实：本批 Top 排行改造**未新增文件**，
> 仅改写既有源码（`git diff HEAD -- . ':(exclude)observability'` = `38 files changed, 1081 insertions(+), 303 deletions(-)`，
> 净 +778 字节，落在 ELF/Mach-O 的零填充区）；且新 bundle `index.3922608061.js` 与旧 bundle **字节等长**，
> 两个版本串 `obs.3` / `obs.4` 亦等长。尺寸相等**不代表内容相同**——两平台 sha256 与 obs.3 均不同（见上），
> 内嵌 bundle 名也不同（obs.3 为 `index.986e5224db.js`）。

**obs.3（上一版，仅为历史记录，勿与上表混用）**

```
$ shasum -a 256 new-api-linux-amd64
0b171b6f1fe0a129350c1a784fb33e4c25538bebb330acb79a774e0712fedd16   138,678,434 字节
$ shasum -a 256 new-api-darwin-arm64        # 本地测试用
03576a7b5a51eb29234135a80afcaec444653b3828b2dfed09488b2c218fb6cb   139,657,506 字节
前端 bundle：index.986e5224db.js
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.3（两平台自报一致）
```

**obs.2（上一版，仅为历史记录，勿与上表混用）**

```
$ shasum -a 256 new-api-linux-amd64
1284cc9bfa83d5d715c5c12d2a2d5b3494fa7b2a972f250252c24a48d1a8c3dd   138,674,338 字节
$ shasum -a 256 new-api-darwin-arm64        # 本地测试用
660414af04d744e1bde66f0a196dcf9f7c723b053d9ad07052712fa353e2b910   139,640,994 字节
前端 bundle：index.1e544940fb.js
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.2（两个平台自报一致）
```

**obs.1（上一版，仅为历史记录，勿与上表混用）**

```
$ file new-api-linux-amd64
ELF 64-bit LSB executable, x86-64, statically linked, stripped
$ shasum -a 256 new-api-linux-amd64
2fe0841c2a7bcce90d8bf4b0722d593c4c41efcb48bb574a3bec6aa0c2afe7aa
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.1
```

### 口径说明（务必知悉）

- **口径 v2（2026-09-23 用户裁决，本轮实施；下文各条按此读）**：看板首屏四项计数器统一为「消费日志行数」口径，不再整体改源。
  - **总数**：一律取窗口内 `logs.type = 2` 的**行数**，与 `log_rows` 恒等；不再使用 `perf_metrics.request_count` 求 total。
  - **失败**：错误日志开启 → 窗口内 `logs.type = 5` 的准确行数；关闭 → `perf_metrics` 各桶 `request_count − success_count` 求和（下限 0）。
  - **成功 = 总数 − 失败**（下限 0）；`use_time = 0` 的悬空行自然归入成功；成功率 = 成功 ÷ 总数（总数为 0 时为 0，不出 NaN）。
  - **失败上限规则：`failure = min(failure_raw, total)`**。两种来源都可能超额，故失败数在写入计数器前先截到总数，`success = total − failure` 因此下限为 0，**`成功 + 失败 == 总数` 恒成立**。触发条件有二：① 错误日志开启时，一次渠道级失败会同时留下 `type=2` 与 `type=5`，重试还会为同一次请求写出多条 `type=5`，于是 `type=5` 行数可能多于 `type=2` 行数；② 错误日志关闭时，`perf_metrics` 的桶覆盖窗口与 `logs` 的行范围不一致（实测逐日覆盖率 113% → 100% → 101% → 87.5% → 43.4% → 28.8%，最高 113%），估算值可能超过总数。代价：极端情况下失败的**展示值**被压到总数，不再原样呈现原始 `type=5` 计数/估算值——这是为保证三项加得平所付的代价，已由用户确认。对应测试：`TestGetSummaryClampsEstimatedFailuresToTotal`（perf 估算超额）与 `TestGetSummaryClampsErrorLogFailuresToTotal`（`type=5` 多于 `type=2`）。
- **`total_calls` 与请求明细表行数可能不同口径**（**⚠️ 已被上方口径 v2 取代，此行保留以存历史**）：当 `ERROR_LOG_ENABLED=false` 时，`total_calls / success_calls / failure_calls / success_rate` 四项**整体**取自 `perf_metrics`（模型×分组 5 分钟桶），以保证成功率自洽；而请求明细表与 `log_rows` 来自 `logs`。实测同一窗口为 **12837 vs 14081**。生产开启 `ERROR_LOG_ENABLED=true` 后 `failure_source=error_log`，该分支不生效，两者口径自动统一。前端已依 `data_source.failure_source` 区分展示。**v2 后**：四项均取自 `logs`，仅「失败」在关闭时借 `perf_metrics` 一个数，故本条的「整体改源」不再成立。
- **「流式调用数」可能大于「总调用数」（同一混源问题的另一面；**⚠️ 口径 v2 后此问题已消失，本条保留以存历史**）**：
  1. **现象**：24 小时窗口里「流式调用数」会大于「总调用数」，实测 **1,549 vs 1,457**（同窗口 `log_rows=2800`）。
  2. **根因**：两个数字取自**不同数据源**——总数/成功/失败在错误日志关闭时取自 `perf_metrics`（5 分钟 flush + 小时桶），而 `stream_calls` 始终取自 `logs`（实时、完整）。二者不是同一次扫描的分母，因此不存在「流式数 ≤ 总数」的约束。对本地库副本扫 **192 个滑动 24h 窗口，其中 10 个出现倒挂**。
  3. **两个附带偏差**（非主因，但会放大倒挂）：① `model/perf_metric.go:86` 的时间条件是**闭区间**（`bucket_ts <= endTs`），而 logs 侧是**半开区间**（`created_at < endTs`），窗口右端多算一个桶；② `perf_metrics` 滞后约 **1–1.5 小时**（实测最后落库桶 `13:00` 而最新日志已到 `15:10`），使最近窗口的总数被低估。
  4. **根治方案（待用户裁决，尚未实施）**：给 `perf_metrics` 增加 `stream_count` 列并随桶一并 flush，让流式数与总数**同源**。代价：schema 变更 + 三库兼容（SQLite/MySQL/PG）+ 新侵入面 + 旧桶缺该列需前端容错。**未动手**。
  5. **已实施的最小缓解（已被口径 v2 取代）**：仪表盘流式调用数卡片就地标注口径来源（`Requests served as a stream · From consumption logs` / 中文「消费日志口径」），**仅当 `failure_source === 'perf_metrics'`（即真的发生混源）时显示**，`error_log` 时同源、不显示。该改动只落在本 fork 自有文件（`web/src/features/observability/*` 与已登记的第 3 项 7 个语言包），**未新增侵入点**。**v2 后**：总数与 `stream_calls` 均取 `logs`，混源条件不再存在，该标注已从卡片移除。
- **导出会在行数上限处被截断（已让用户可感知）**：`monitoring_service.go` 对导出结果设了行数上限，超出时 `ExportRequest.Truncated=true` 且 `Total` 为截断前的匹配总数。此前该事实**没有任何消费方**——CSV 分支只写 `Rows`，前端也没有 `truncated` 引用，用户会以为导出了全部结果。现改为：服务端在 CSV 末尾追加一行注释 `# truncated: total=<total> exported=<n>`（同时补一个 `X-Export-Truncated: true` 响应头），前端解析该标记后在下载时弹 `toast.warning`「导出被截断到 N / M 行」。**选择写进正文而不是只靠响应头**：`middleware/cors.go` 未设置 `ExposeHeaders`，跨域部署时浏览器读不到自定义头，正文是唯一稳定可读的通道；而给 cors 加 `ExposeHeaders` 会成为**新的侵入点**，本轮不允许。该改动落在本 fork 自有文件与已登记的第 3 项语言包，**未新增侵入点**。

### 错误日志端到端验证（2026-09-23，**仅本地实例**，生产零改动）

在本地实例（新 darwin 产物 `v1.0.0-rc.40-obs.3`、`ERROR_LOG_ENABLED=true`、副本库）实测，回答「开启后失败事件是否真实落库」这一此前标注为**未验证**的项：

- **能落库**：触发一次真实的**渠道级**失败（token group `Anthropic` → channel #6 → 上游返回 `403 Insufficient quota`），`logs` 新增 `type=5` 行（`id=14491`，`channel_id=6`，`model_name=claude-haiku-4-5`，`content=status_code=403, Insufficient quota...`）。触发前 `max(id)=14488`、`type=5` 计数为 **0**；触发后 `max(id)=14491`、`type=5` 计数为 **1**。
- **`data_source.failure_source = error_log`**（`error_log_enabled=true`）；`total_calls`（1099）与 `log_rows`（1099）**同源相等**，倒挂条件消失：同窗口 logs 口径 `stream=410 ≤ total=1099`（不倒挂）；反事实用旧 `perf_metrics` 口径为 `total=245`，`stream=410 > 245`（**会**倒挂）。三处「需错误日志」标注的触发条件（前端 `failure_source === 'perf_metrics'`）在 `error_log` 下**不再成立**（以接口返回值证，非目视 UI）。
- **触发路径说明（重要）**：`type=5` 只在**渠道级**失败记录——即已选中渠道、把请求发给上游后失败（`service/relay_error.go:76` → `ProcessChannelError`）。**未选中渠道**的失败（如不存在的 model）在 `middleware/distributor.go:110-121` 提前 `abort`，**不**落 `type=5`（实测：`model_not_found` 的 503 前后 `type=5` 计数不变）。因此失败率对「渠道内的失败」敏感，对「路由前失败」不敏感。
- **一处口径局限（本轮新发现，如实记录，**⚠️ 已被口径 v2 修复，本条保留以存历史**）**：一次渠道级失败会**同时**留下 `type=2` 消费行与 `type=5` 错误行（同一 `request_id`）。而 `total_calls`/`success_calls` 取自 `type=2`（`summary_service.go:76`）、`failure_calls` 取自 `type=5`（`errorQuery`），两口径独立扫描，故 `success_calls + failure_calls` 会**大于** `total_calls`（实测 1099+1=1100 vs total 1099）。成因：该消费行 `use_time=3 > 0`，被 `success_calls` 的 `CASE WHEN use_time > 0` 计为成功（`summaryTotalsSelect`），于是 `success_rate` 仍读作 100% 而当天确有 1 次失败。**未修**（超出当时打包范围）。**v2 修复方式**：成功数不再由 SQL 的 `use_time > 0` 派生，改为 `total − failure` 反推；失败数再截到总数，三项因此恒加得平（见上方「失败上限规则」）。

### Top 排行改造的端到端验证（2026-09-23，obs.4，**仅本地实例**，生产零改动）

在本地实例（新 darwin 产物 `v1.0.0-rc.40-obs.4`、`ERROR_LOG_ENABLED=true`、副本库）用**真实 HTTP**（管理端 JWT 登录 → 带 `Authorization: Bearer`）请求 `/api/observability/summary?range=7d`，与副本库手工 SQL（`mode=ro&immutable=1`）交叉核对：

- **`top_tokens` 的 `token_id` 唯一**：`[4, 13, 5, 10, 8]`，无重复（修复前 token 4 会裂成两行，见第③批改动条目）。
- **按 `total_tokens` 降序**：token 4（1373 次 / 181,058,762）→ 13（1423 / 113,207,252）→ 5（905 / 62,431,434）→ 10（267 / 25,326,883）→ 8（17 / 2,602,623），逐行单调不增。
- **第 1 名为 token 4**，`token_name = mac | Hermes | OpenAI`（`tokens` 表当前值，而非历史日志名 `【Mac】Hermes——OpenAI`），与工单预期一致。
- **`top_channels` / `top_models` 同样按 `total_tokens` 降序**：渠道 10（Command Code）/ 8 / 1 / 9 / 3；模型 `deepseek/deepseek-v4.1-flash` / `LongCat-2.0` / `gpt-5.6-luna` / `gpt-5.6-terra` / `codex-auto-review`。**三张榜、每条行的 calls/total_tokens/quota 均与手工 SQL 逐位一致**。
- **`range=7d` 为自然日窗口**：`start=1789574400` = `2026-09-17 00:00:00 +08`（当日 00:00 前推 6 天），`end=1790153468` = 请求时刻。
- 其余端点回归：`/summary?range=24h`、`/requests`、`/usage`、`/requests/export`（CSV）均 200；`/nonexistent` 仍 404（路由非兜底）。`data_source.failure_source = error_log`。
- **独立性**：本项由独立验证 agent 复验 **VN1–VN5 全 PASS**（前端 175 文件 / 2171 用例、专项 10 / 77、Go 两包全绿、`GATE: ALL PASS`、i18n 2 新键 × 7 语言等量）。

### 上游合并（2026-09-24，upgrade1）

- 合并 `upstream/main` = `d04c118c8`（7 提交 / 11 文件）入 `feat/observability`，合并提交 `f9c78c517`，**冲突 0**；门 `GATE: ALL PASS`（G1–G8b）、前端 176 文件 / 2196 用例、Go 全量构建与我方两包全绿；diff 基线随之由 `9310231b3` 前移至 `d04c118c8`（新基线复算 59 文件 / +9639 −12，明细见 `UPGRADE-MERGE.md` §6）。**上文旧数字按旧基线计得，此处只加注、不改。**

### 生产上线（2026-09-24，obs.7）

**本 fork 首次真正上线生产。** 生产机 `xiaoqi-lighthouse` 于 **12:17–12:20（+08）** 将 `/opt/new-api/current/new-api` 由 `v1.0.0-rc.39`（sha256 `c2d488fc…`）替换为 **`v1.0.0-rc.40-obs.7`**（sha256 `9bcf60c1…`，138,682,530 字节，内嵌 bundle `index.ca3306be08.js`）；构建自 HEAD `16b3a7c75`（已合并 `upstream/main` `d04c118c8`）。四路由 `/api/observability/{summary,requests,requests/export,usage}` 免鉴权 **401**、`/nonexistent` **404**、`/api/status` 版本串 **`v1.0.0-rc.40-obs.7`**、外网 `/v1/models` **401**、日志无 panic/fatal、**零迁移**（38 表 / `logs` 21 列 / `.schema` 哈希 / DB inode 全不变）。完整记录见 `deploy.md` §8。

**同轮已开启 `ERROR_LOG_ENABLED=true`**（生产唯一配置改动，经 systemd drop-in `/etc/systemd/system/new-api.service.d/error-log.conf`，原 unit 未改；unit 回滚点 `/opt/new-api/data/new-api.service.bak-errlog-20260924-123019`，删 drop-in + `daemon-reload` + `restart` 即可回滚）。生效证据：`systemctl show new-api -p Environment` = `Environment=ERROR_LOG_ENABLED=true`。

**对口径 v2 的影响（生产侧从此转入准确统计）**：

- 上方口径说明里 v2 的两分支中，生产此前一直落在**关闭侧**（`perf_metrics` 估算，前端据 `failure_source === 'perf_metrics'` 显示「失败为估算值，开启错误日志后转为准确统计」）。本次开启后，生产转入**开启侧**：失败取窗口内 `logs.type = 5` 的**准确行数**，`failure_source = error_log`，前端那三处「需错误日志」标注的触发条件**在生产不再成立**——即「失败为估算值」将转为准确统计。
- **历史窗口内的失败仍是 0，不是修复出来的**：开启只覆盖**开启之后**的失败。生产 `logs.type=5` 在开启时与开启后均为 **0**（`select count(*) from logs where type=5` = 0），因为开关生效前没有错误日志行；这与本地实例此前的验证结论一致。
- **`type=5` 只在渠道级失败时写入**：需「已选中渠道、上游返回错误」才落行；**路由前**失败（如不存在的 model）在 `middleware/distributor.go` 提前 abort，**不**落 `type=5`（实测该情形前后计数不变）。因此开启后 `type=5` 是否增长，取决于是否真的发生渠道级失败。
- **一处未从免鉴权侧核实的点（如实记录）**：`data_source.failure_source` 是否已翻为 `error_log`，需以管理员凭证登录看板确认（`/api/status` 不暴露该字段）；服务侧只能证到环境变量已生效。

> 本轮为**文档回填**：只增补本节与 `deploy.md` §8，**上文（含 obs.1–obs.6 与 upgrade1）一字未改、未删**。

### 挂账：审查未修项与未决口径（2026-09-24 关闭本轮开发会话时登记）

> 完整审查报告（未入库，本地归档）：`.review/review-full-report-2026-09-23.md`（40,777 字节，gitignored）。
> 编号 A–F 为本 fork 审查批次的项号；报告里「必须先修」那批已在前序批次修完，下列为**尚未修**的部分。

| 项 | 位置 | 一句话 |
|---|---|---|
| A-2 · 中 | `overview-page.tsx:300` | 健康时间线文案写「10-minute buckets · last 24 hours」，但窗口右端实为所选区间末端（区间整体早于 now 时不等于「最近 24 小时」）→ 文案与窗口二者需对齐 |
| A-3 · 低（**已裁决延后**） | `usage_service.go:201` + `lib/charts.ts:148` | 小时粒度在 span>31d 时静默降级为天桶，响应不回传生效粒度；前端仍按小时格式标注 → 用户已裁决「先不管」 |
| A-4 · 低 | `summary_service.go:150-154` | 注释自相矛盾（「四项整体取自 perf_metrics」指代不清）；数字口径本身无错 |
| B-1 · 中（加固项） | `service/observability/other.go:37` | retry chain 取 `admin_info` 的 `request_policy` 但本包不做可见性投影；实测 `root_info` 0 命中故当前不构成越权，风险是未来加字段即成越权出口 |
| B-2 · 低（加固项） | `monitoring_service.go:176-177` | 同上，导出路径的 `out.Rows` 同样不投影 |
| B-3 · 低 | `controller/observability/monitoring.go:53-56` | CSV 导出先 `c.Status(200)` 再写 body，中途失败会给客户端「200 + 半截 CSV」 |
| B-4 · 低 | `web/src/features/observability/api.ts:110-121` | 下载链路把错误响应当文件保存（上游约定 HTTP 200 + `success:false`）→ 参数非法时下载到内容是 JSON 的 .csv |
| C-4 · 低 | `requests-pagination.tsx:39-44` | 自建分页替代上游 `DataTablePagination`，能力缺口只写在代码注释里 |
| D-2 · 低（已知取舍） | `summary_service.go:86-92`、`usage_service.go:190-198` | 区间内全量明细行 Go 侧扫描（实测 1.4 万行毫秒级），未做预聚合 —— 架构取舍非缺陷 |
| D-3 · 低 | `usage_service.go:207-213` | `other` 列全量解析不受维度 Top 50 约束，同 D-2 取舍 |
| D-4 · 低 | `usage_service.go:343` | 矩阵 `Limit(limit*limit)` 是单元格上限而非维度 Top-N；前端 `yMax=12` 截断并提示，使用上可接受 |
| E-4 · 低 | `dto.go:21`、`query.go:163-179`、`lib/format.ts:43,50,63` | 死代码（全包 0 引用或仅测试引用） |
| E-5 · 低 | `monitoring-page.tsx`（1007 行） | 违反 `web/AGENTS.md:114`「超约 200 行考虑拆分子组件/抽 Hooks」；建议抽 `RequestDetail` 与列定义 |
| E-7 · 低 | `observability/README.md`「边界」节 | 边界声明过期（写「只新增文件、不修改现有页面」，但第 5 项侵入点改了 API 密钥页行为） |
| F-9 · 低 | `plan/04-verification.md:74` | G8 记「7 语言各 +56 行」，与同文件 +55/+65 及实测 +64 key 口径不一（历史快照） |

**未决口径 / 未验证项（需裁决或环境条件）**

- **平均延迟分母口径**：`use_time>0` 的条件均值与顶部 `COUNT(*)` 总数口径不一致，同写法复制 5–6 处（`usage_service.go:140/171/238`、`monitoring_service.go:124/133`）→ 只报告未扩改，**待用户裁决**。
- **PostgreSQL 未实测**：MySQL 保留字修复只验了 SQLite + MySQL，三库矩阵缺 PG 一环。
- **GitHub Actions 打包路径未实跑**：打 tag 触发 `release.yml` 出产物（含 checksums）尚未验证（fork 为 public，额度免费）。
- **孤儿 i18n 键待清理**：`{{calls}} calls · {{tokens}} tokens`、`From consumption logs`、`24h Activity Distribution`。
- **`min(failure,total)` 边界风险**：`type=2` 行缺失而 `type=5` 正常时会少报失败（已记于上文口径说明）。
- **生产 `failure_source` 待登录确认**：`/api/status` 不暴露该字段，需管理员凭证登录看板确认是否已翻为 `error_log`；免鉴权侧只能证到环境变量已生效。
