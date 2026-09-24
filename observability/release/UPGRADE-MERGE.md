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
