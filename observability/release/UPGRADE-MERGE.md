# 上游升级合并手册

适用对象：本 fork（`lhyxiaofeiyang/new-api`，分支 `feat/observability`）跟随上游 `QuantumNous/new-api` 升级。

## 0. 分支模型

```
upstream/main ──┬──► 本地 main（纯镜像，禁止在上直接改）
                └──► feat/observability（全部自有改动；日常开发与发布都在这条）
```

- `main` 永远等于上游（`git fetch upstream && git merge --ff-only upstream/main`）。
- 所有自有改动只在 `feat/observability`。上游升级 = 把 upstream 合进 `feat/observability`，**不动 main**。

## 1. 一键同步

```bash
bash observability/scripts/sync-upstream.sh          # 试合并并报告冲突
bash observability/scripts/sync-upstream.sh --apply   # 冲突清理后正式提交
```

脚本行为：`fetch upstream` → 列出新 tag → 在临时分支上试合并 `upstream/main` → 输出冲突文件清单与侵入点状态 → 不推送任何远端。

## 2. 自有改动清单（合并时只需盯这些）

**本清单登记 11 条侵入点**（= 10 个手改 + 1 个生成物）。若按「相对 `upstream/main` 实际被修改的既有文件」计数则为 **12 个**：10 个手改文件（1 个 Go 路由 + 2 个前端源码 + 7 个语言包）、1 个配套测试文件（`web/src/features/keys/components/__tests__/api-key-listing.test.tsx`，上游同样自带该文件，与第 5 项同批改动，故并入第 5 项登记）、1 个生成物（`routeTree.gen.ts`）。

| # | 文件 | 改动内容 | 冲突概率 | 解决方式 |
|---|---|---|---|---|
| 1 | `router/api-router.go` | 新增 `observabilityRoute := apiRouter.Group("/observability")` 与 4 条 GET | 低 | 重新按当前文件写法插入同样 **9 行**（1 行 import + 8 行路由块；与 CHANGELOG 的「+9 行」同口径） |
| 2 | `web/src/hooks/use-sidebar-data.ts` | `navGroups` 中新增 `observability` 分组（紧随 `general`） | 中（上游常动导航） | 在新版 `navGroups` 内重新插入该分组对象 |
| 3 | `web/src/i18n/locales/*.json` | 追加本功能的新 key | 高（JSON 大文件） | 以上游版本为准，重新追加缺失 key（脚本 `--apply` 会提示缺失 key 列表） |
| 4 | `web/src/routeTree.gen.ts` | **生成物**（TanStack Router 由 `web/rsbuild.config.ts` 的 `@tanstack/router-plugin` 自动重生成），+45 行纯追加的路由注册 | 低 | **不要手改**：合并后跑一次 `bun run build` 即自动重生成；冲突时直接 `git checkout --theirs` 上游版本再重新构建 |
| 5 | `web/src/features/keys/components/api-keys-table.tsx` | 在 `useDataTable` 调用处 **+7 行**（5 行限制注释 + `enableSorting: true` 与 `withSortedRowModel: true` 两个 prop），让「名称」「分组」列出现升序/降序按钮 | 中 | 保留本 fork 的 `enableSorting` / `withSortedRowModel` **两个 prop** 与那段限制注释，与上游新版 `useDataTable` 调用参数合并 |

> 判断依据：`web/src/routeTree.gen.ts` 头部为 `/* eslint-disable */` + `// @ts-nocheck`，且 `web/rsbuild.config.ts:93` 注册了 `tanstackRouter(...)` 插件——该文件是构建期产物，非人工维护。

> 第 5 项另有一个**上游自带的测试文件**同批被改：`web/src/features/keys/components/__tests__/api-key-listing.test.tsx`（实测 `+41 / -2`）。合并时若上游改过该测试文件，以「保留本 fork 新增的 `sorts the loaded page by name from the header control without refetching the list` 用例及其 `namesInOrder()` 辅助函数」为准则手工合并。

> `observability/scripts/sync-upstream.sh` 的 `TOUCHPOINTS` **已收录这两条路径**，跑一次试合并即可看到
> 「上游是否改动过这两个文件」的报告（该列表共 5 条：路由、侧边栏、语言包、本项源码、本项测试）。

### 2.1 第 5 项（API 密钥页排序）的合并注意

**① 冲突性质。** 相对 `upstream/main`，`web/src/features/keys/components/api-keys-table.tsx` 是**被修改的既有文件**（上游自带该文件）。未来合并上游时，只要上游动过 `ApiKeysTable` 里的 `useDataTable({...})` 调用（改参数、加列、换 hook），该处**必然冲突**。冲突处理办法固定为一条：

> 保留本 fork 的 `enableSorting: true` 与 `withSortedRowModel: true` 两个 prop，以及上方那 5 行限制注释；其余以上游版本为准。

不要在上游文件里再扩大这块改动（例如顺手加 `sortingFns`、`manualSorting`、`initialState.sorting`），否则每次上游升级都要重新裁决冲突面。

**② 语义限制（重要，勿误读为整库排序）。** keys 列表接口没有排序参数。实测参数口径：

- 前端实发 `p` 与 `size`：`web/src/features/keys/api.ts:40` 为 `/api/token/?p=${p}&size=${size}`，搜索走 `/api/token/search`（:50-54 设置 `keyword` / `token` / `p` / `size` 四个查询参数）；
- 后端 `controller/token.go` 的 `GetAllTokens`（:130）与 `SearchTokens`（:144）分页参数统一由 `common.GetPageQuery(c)` 解析（`common/page_info.go:41`）：页码读 `p`，页大小依次读 `page_size` → `ps` → `size`（`size` 那条注释即为 "token page"，:60-73），上限 100，缺省 `ItemsPerPage`。搜索接口另外读 `keyword` 与 `token`（:146-147）。
- **排序参数一个都没有**：`model/token.go` 的 `GetAllUserTokens`（:109）与 `SearchUserTokens`（:212）写死 `Order("id desc")`，没有 `sort_by` / `sort_order` 入口，也没有排序白名单。

所以这里挂的升序/降序按钮是**纯客户端排序**，只对**当前页已加载的那一批数据**重排：

- 第 2 页的密钥不会因为点了「升序」而进入第 1 页视野；
- 升降序只在服务端返回的那一页（默认 20 条）内有效，不构成整库有序；
- 排序不触发重新请求（URL 里不会出现 `sort_by`），也不改动翻页游标。

密钥数量少、且用户能接受「先翻到含目标密钥的那一页再排序」时，这个语义是可用的。若哪天密钥多到需要整库排序，见下条。

**③ 日后要做整库排序的改造入口（前后端必须一起改）。** 目前 `web/src/features/keys/api.ts` 的 `getApiKeys` / `searchApiKeys` 不传排序参数，路由 search schema（`web/src/routes/_authenticated/keys/index.tsx` 的 `apiKeySearchSchema`）也没有排序字段——两端都是纯前端改动范围。要真正整库排序，需要：

1. **后端**：给 `/api/token/` 与 `/api/token/search` 加 `sort_by` / `sort_order` 参数，并把 `model/token.go` 里写死的 `Order("id desc")` 换成白名单驱动的 `Order(...)`。可直接照抄同项目已有的 `model/user.go:25-62`（`userSortColumns` 白名单 + `NewUserSortOptions` + `Apply`）这套写法，**不要**把用户传来的列名直接拼进 `Order()`。
2. **前端**：`features/keys/api.ts` 透传排序参数 → 路由 search schema 加排序字段 → `api-keys-table.tsx` 改为 `manualSorting: true` 并把 `withSortedRowModel` 去掉、接上 `onSortingChange`。**照抄 `web/src/features/users/components/users-table.tsx`**（`USER_SORTABLE_COLUMNS` + `sortParams` + `handleSortingChange` 里重置 `pageIndex`）即可，不要另起一套。
3. 届时第 5 项的表头两个按钮**无需改动**——`DataTableColumnHeader` 是同一套控件，只是排序从客户端变成服务端。

**其余全部是新增文件**（`controller/observability/`、`service/observability/`、`web/src/features/observability/`、`web/src/routes/_authenticated/observability/`），上游不会碰到，天然无冲突。第 5 项配套的测试改动落在 `web/src/features/keys/components/__tests__/api-key-listing.test.tsx`（上游同样自带该文件，故按「被修改的既有文件」计数同属一项，总量因此为 **12** 个既有文件）。

## 3. 合并后的验证清单（缺一不可）

```bash
cd ~/Documents/personal/project/new-api
go build ./...                       # 编译
go vet ./...                         # 静态检查
go test ./controller/observability/... ./service/observability/...
cd web && bun install && bun run typecheck && bun run lint && bun test
```

再确认：

- [ ] `/api/observability/*` 四个端点仍注册且返回 200（本地起服务实测）
- [ ] 侧边栏「Token 监控」分组仍在（上游若改了导航数据结构，按第 2 节第 2 行修复）
- [ ] 三页 i18n 无缺 key（切到英文/中文各看一遍）
- [ ] 图表库仍是 `@visactor/vchart`（上游若换图表库，需重写 `components/` 下的图表封装）
- [ ] API 密钥页「名称」「分组」列仍有升序/降序按钮（合并后点一次验证，按第 2.1 节恢复）

## 4. 上游重大变更的应对

| 上游变化 | 影响 | 应对 |
|---|---|---|
| 前端栈更换（如 Base UI → 其他、Tailwind 大版本） | 组件层需改写 | 只改 `features/observability/components/*`；业务逻辑不动 |
| `logs` 表结构变化（字段增删/改名） | 聚合 SQL 失效 | 查询集中在 `service/observability/query.go`，改一处；跑 schema 断言测试 |
| 上游自带可观测性/监控页 | 功能重叠 | 评估后**优先用上游**，本功能退化为薄增量或整体下线（本目录文档即下线依据） |
| 上游引入同类插件机制 | 可脱离 fork | 把三页迁移为官方插件形态，`feat/observability` 可弃 |

## 5. 回滚

- 代码：`git checkout <升级前 commit>` 即可（自有改动全在一条分支上，无历史改写）。
- 生产：切回 `/opt/new-api/current/new-api.old`（部署脚本保留的上一版二进制），重启服务，约 3 秒。

## 6. 本轮合并记录（upgrade1，2026-09-24）

首次实执行「把 `upstream/main` 合进 `feat/observability`」。**merge，非 rebase**；无冲突；已推送前完成全量验证。

### 6.1 合并参数（均为实跑输出）

| 项 | 值 | 复算命令 |
|---|---|---|
| 合并前本 fork HEAD | `cf5582466b92a21d3a20a36d34f3de8f0b2bbccf` | `git rev-parse HEAD` |
| 合并前 merge-base | `9310231b3c27fea933e939b46cf26e0ce67192e3` | `git merge-base upstream/main HEAD` |
| 合并入的 `upstream/main` | `d04c118c8803f49e0c9bab74dcf5b5efeab9464a` | `git rev-parse upstream/main` |
| 合并提交 | `f9c78c517236810011cff16c932e438f2e11dffe` | `git log -1 --format='%H %s'` |
| 合并提交双亲 | `cf5582466` + `d04c118c8` | `git log -1 --format='%P'` |
| 并入的上游提交数 | **7**（`git rev-list --count HEAD^1..HEAD` 输出 8，含合并提交本身） | 同左 |
| 上游侧改动面 | **11 文件 / 7 提交** | `git diff --name-only 9310231b3 upstream/main \| wc -l` |
| 冲突数 | **0**（`ort` 策略自动合并） | `git merge upstream/main --no-edit` |

冲突面为 0 的原因不是巧合：合并前实测两侧改动文件**交集为空**——

```bash
comm -12 <(git diff --name-only 9310231b3 HEAD | sort) \
         <(git diff --name-only 9310231b3 upstream/main | sort)   # 输出空
```

> 口径修正：本轮企划书写「我方 49 个改动文件」，实测该数（`git diff --name-only 9310231b3 HEAD | wc -l`）为 **71**；
> 49 是**合并前最后一次提交** `cf5582466` 的文件数，非整条分支相对分叉点的文件数。交集为 0 的结论不受影响（71 ∩ 11 = 0）。

### 6.2 门与全量验证（全绿）

| 项 | 结果 | 备注 |
|---|---|---|
| `bash ~/.hermes/scripts/obs-gate.sh` | `GATE: ALL PASS`（G1–G8b） | G6 基线已自动前移至 `d04c118c8`，报「既有文件 **12** 个被改，全在白名单内」 |
| `cd web && bun run test` | `Test Files 176 passed` / `Tests 2196 passed` | 全量前端 |
| `go build ./...` | exit 0，无输出 | `GOPROXY=https://goproxy.cn,direct GOSUMDB=off` |
| `go test ./service/observability/ ./controller/observability/ -count=1` | 两包均 `ok` | — |

> **G6 的「12」与企划书的「10」不一致，已核为企划书笔误，非登记漂移**：合并前后该清单**逐行相同**（同一组 12 个既有文件），
> 且与本文 §2 登记的「12 个既有文件（11 条侵入点 + 1 个并入第 5 项的测试文件）」一致。门白名单（6 条路径族）、
> `sync-upstream.sh` 的 `TOUCHPOINTS`（5 条）本轮**均未改动**。无新增侵入点。

### 6.3 diff 数字基线已前移到新 merge-base

**diff 数字基线已随本轮合并由 `9310231b3` 前移到 `d04c118c8`，此前文档里的数字按旧基线计得。**
下文给出新基线的复算值，供后续轮次比对：

```bash
BASE=$(git merge-base upstream/main HEAD)                      # = d04c118c8
git diff --shortstat "$BASE" -- . ':(exclude)observability'    # 59 files changed, 9639 insertions(+), 12 deletions(-)
git diff --name-status "$BASE" -- . ':(exclude)observability' | awk '{print $1}' | sort | uniq -c   # 47 A / 12 M
```

与旧基线（`9310231b3`，`70 files changed, 9926 insertions(+), 88 deletions(-)`，48 A / 22 M）的差额已复核为**恰为上游自身的改动**：
`9639 + 287 = 9926`（上游本轮 11 文件合计 `+287`），文件数 `59 + 11 = 70`。两基线口径**不可互换**，旧文档数字不代表回退。

### 6.4 反向核对（分叉已变小）

```bash
git diff --name-only upstream/main..cf5582466 | wc -l   # 合并前：82（本 fork 相对 upstream/main 的差异文件）
git diff --name-only upstream/main..HEAD       | wc -l   # 合并后：71
```

差额恰为上表 11 个上游文件（`comm -23` 实测输出与上游 11 文件清单逐行一致，无我方文件丢失）。

### 6.5 我方功能存活（逐条 grep）

| 标记 | 命中 |
|---|---|
| `failureSourceNoteKey` | `web/src/features/observability/components/overview-page.tsx:95,145` |
| `dimensionKeyAlias` | `service/observability/query.go:95,98`、`usage_service.go:172,261,296` |
| `tokensJoin` | `service/observability/summary_service.go:174,177,194`、`usage_service.go:28` |
| `COALESCE(NULLIF(MAX(tk.name)` | `service/observability/usage_service.go:32` |
| `w-full table-fixed` | `web/src/features/observability/components/usage-page.tsx:482` |
| `Failures counted since error logs were enabled` | 7 个语言包各 **1** 次 |
| `api-keys-table.tsx` 第 5 项排序改动 | `:320-326` 限制注释 + `enableSorting` / `withSortedRowModel` |

### 6.6 附带修正与纪律

- 上游 `5401874c6` 把 CI 里 `-X` 的包路径由 `new-api/common.Version` 正为 `github.com/QuantumNous/new-api/common.Version`，
  只动 `.github/workflows/`，**不影响本地打包命令**；本轮顺带并入。
- 本轮**未** rebase、**未** force push、**未** `checkout --ours/--theirs`、**未**碰生产、**未**重建产物、**未**重启实例、
  **未**修改上游既有文件逻辑（冲突数为 0，故无任何冲突解决改动）、**未**扩白名单。

## 7. 本轮合并记录（upgrade2，2026-10-09）

第二次实执行「把 `upstream/main` 合进 `feat/observability`」，对应上游 `v1.0.0-rc.41`、`v1.0.0-rc.42`。
**merge，非 rebase**；无冲突；`--no-edit` 自动合成为一次合并提交。

### 7.1 合并参数（均为实跑输出）

| 项 | 值 | 复算命令 |
|---|---|---|
| 合并前本 fork HEAD | `caaafed1de90f1786010c4bcea5d2c84a358173f` | `git rev-parse HEAD` |
| 合并前 merge-base | `d04c118c8803f49e0c9bab74dcf5b5efeab9464a` | `git merge-base upstream/main HEAD` |
| 合并入的 `upstream/main` | `e0483122c7d3693629f0e84473380a8c9506c56a` | `git rev-parse upstream/main` |
| 合并提交 | `9955990eb3a819f622977c3897c74a465860c191` | `git log -1 --format='%H %s'` |
| 合并提交双亲 | `caaafed1d` + `e0483122c` | `git log -1 --format='%P'` |
| 并入的上游提交数 | **42**（`git rev-list --count HEAD^1..HEAD` 输出 43，含合并提交本身） | `git rev-list --count d04c118c8..e0483122c` |
| 上游侧改动面 | **303 文件 / 42 提交** | `git diff --name-only d04c118c8 e0483122c \| wc -l` |
| 冲突数 | **0**（`ort` 策略自动合并） | `git merge upstream/main --no-edit` |

本轮两侧改动文件**有交集**（9 个：路由、侧边栏、7 个语言包），但仍无文本冲突：

```bash
comm -12 <(git diff --name-only e0483122c HEAD | sort) \
         <(git diff --name-only d04c118c8 e0483122c | sort)
# router/api-router.go  web/src/hooks/use-sidebar-data.ts  web/src/i18n/locales/{en,fr,ja,ru,vi,zh-TW,zh}.json
```

冲突为 0 的原因：上游对这 9 个文件的改动与我方改动落在**不同 hunk**，`ort` 三方合并自动拼接。

- `router/api-router.go`：上游在 `selfRoute` 内改 access_token 路由 + 2 处 `handlePermissionRoute`（并置 import `net/http`）；
  我方在文件末尾新增 `observabilityRoute` 块（`/observability` 4 条 GET）。实测合并后**两侧都在**（import 块同时含 `net/http` 与 `obscontroller`）。
- `web/src/hooks/use-sidebar-data.ts`：上游给系统设置项加 `requiredRole: ROLE.SUPER_ADMIN`；我方抽出 `buildNavGroups` 并加 observability 分组。合并后**两侧都在**（`buildNavGroups` :59、observability 三入口 :122/127/132；ROLE 三处 :191/197/204）。

### 7.2 是否触及 `model/`（DB 迁移预判）

**触及，但本轮不动库。** 上游本轮改动 `model/` 下 11 个文件：
`model/audit_log.go`、`auth_flow.go`、`main.go`、`model_pricing_config.go`、`option.go`、`user.go`、`user_access_token.go`（新增）+ 4 个测试文件。
合并后 `model/` 已随上游前进，故**下一次打包/上线前必须按 AGENTS.md「Database compatibility」逐库（SQLite/MySQL/PG）验证
`AutoMigrate` 与新增 `user_access_token` 表**；本轮仅预判与记录，未迁库、未起服务、未连数据库。

### 7.3 门与全量验证（全绿）

| 项 | 结果 | 备注 |
|---|---|---|
| `bash ~/.hermes/scripts/obs-gate.sh` | `GATE: ALL PASS`（G1–G8b） | G6 基线已自动前移至 `e0483122c`，报「既有文件 **12** 个被改，全在白名单内」 |
| `cd web && bun run test` | `Test Files 185 passed` / `Tests 2256 passed` | 全量前端 |
| `go build ./...` | exit 0，无输出 | 需 `GOPROXY=https://goproxy.cn,direct GOSUMDB=off`（见下） |
| `go test ./service/observability/ ./controller/observability/ -count=1` | 两包均 `ok` | — |

> **首次跑门时 G1/G2/G5 因依赖拉取而 FAIL（非产品缺陷，非判据错误，是环境门）**：`obs-gate.sh` 用裸 `go build`，
> 默认 `GOPROXY=proxy.golang.org` 本机不可达；上游本轮升级 `moejs`、新增 `tokenkit`（依赖 `tiktoken-go/tokenizer`）等内容
> 引入了本机缓存未命中的模块，故报 `dial tcp ... i/o timeout`。**预热**（命令级 `GOPROXY=https://goproxy.cn,direct GOSUMDB=off`
> 跑一遍 `go build/vet/test`）后重跑门即全绿；`go.mod`/`go.sum` **未被改动**（未跑 `go mod tidy`）。门与脚本**未改**。

### 7.4 diff 数字基线已前移到新 merge-base

**diff 数字基线已随本轮合并由 `d04c118c8` 前移到 `e0483122c`。** 复算值：

```bash
BASE=$(git merge-base upstream/main HEAD)                      # = e0483122c
git diff --shortstat "$BASE" -- . ':(exclude)observability'    # 59 files changed, 9639 insertions(+), 12 deletions(-)
git diff --name-status "$BASE" -- . ':(exclude)observability' | awk '{print $1}' | sort | uniq -c   # 47 A / 12 M
```

**前移前后数字相同**（旧基线 `d04c118c8` 的复算值同为 `59 files changed, 9639 insertions(+), 12 deletions(-)`、`47 A / 12 M`）。
原因：该口径只统计「我方独有改动」，而本轮我方未产生任何新改动（纯合并）；基线前移的差额恰为上游自身的 42 提交 / 303 文件，
已由新基线（= 上游 `e0483122c`）抵消。核对：`git diff --name-only d04c118c8 caaafed1d | wc -l` 与
`git diff --name-only e0483122c HEAD | wc -l` 均为 **71**，两侧口径一致。

### 7.5 反向核对（分叉已变小）

```bash
git diff --name-only upstream/main..caaafed1d | wc -l   # 合并前：364（我方 71 + 上游新增而本 fork 尚未并入者）
git diff --name-only upstream/main..HEAD      | wc -l   # 合并后：71
```

分解（`comm` 实测）：分叉 364 = 我方 71 ∪ 上游本轮新增 302，两侧交集 9（即 §7.1 那 9 个文件），
即 `71 + 302 − 9 = 364`。故差额 `364 − 71 = 293 = 302 − 9`，恰为「上游新增且本 fork 此前缺失」的文件。
（上游侧 303 个改动文件中，有 1 个不在合并前分叉集合内——为上游删除的文件，不产生分叉方向差分。）

### 7.6 我方功能存活（逐条 grep，均为合并后实测）

| 标记 | 命中 |
|---|---|
| `failureSourceNoteKey` | `web/src/features/observability/components/overview-page.tsx:95,145` |
| `dimensionKeyAlias` | `service/observability/query.go:95,98`、`usage_service.go:172,261,296` |
| `tokensJoin` | `service/observability/summary_service.go:174,177,194`、`usage_service.go:28` |
| `w-full table-fixed` | `web/src/features/observability/components/usage-page.tsx:482` |
| `Failures counted since error logs were enabled` | 7 个语言包各 **1** 次 |
| `10-minute buckets · last 24 hours`（本轮新增文案抽样） | 7 个语言包各 **1** 次 |
| `api-keys-table.tsx` 第 5 项排序改动 | `:322-324` 限制注释 + `:325 enableSorting` / `:326 withSortedRowModel` |

> 7 个语言包相对 `upstream/main` 的 key 数：各语言 `now=6934 / upstream=6866`，即每语言新增 **68**、删除 **0**（与门 G8 差集一致）。

### 7.7 附带说明与纪律

- 上游本轮 `router/api-router.go` 新增 access_token 路由族与 `handlePermissionRoute`；`web/src/features/security/`
  下的 access-token 组件整批重构（旧 `access-token-card.tsx` 删除，新增 `access-tokens-card.tsx` 等）——**均属上游既有目录，与本功能无交集**，未介入裁决。
- 本轮**未** rebase、**未** force push、**未** `checkout --ours/--theirs`、**未**碰生产、**未**重建产物、**未**重启实例、
  **未**修改上游既有文件逻辑（冲突数为 0，故无任何冲突解决改动）、**未**扩白名单、**未**动门与脚本。
