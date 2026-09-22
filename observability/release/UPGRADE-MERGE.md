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

## 2. 自有改动清单（合并时只需盯这 3 处）

| # | 文件 | 改动内容 | 冲突概率 | 解决方式 |
|---|---|---|---|---|
| 1 | `router/api-router.go` | 新增 `observabilityRoute := apiRouter.Group("/observability")` 与 4 条 GET | 低 | 重新按当前文件写法插入同样 6 行 |
| 2 | `web/src/hooks/use-sidebar-data.ts` | `navGroups` 中新增 `observability` 分组（紧随 `general`） | 中（上游常动导航） | 在新版 `navGroups` 内重新插入该分组对象 |
| 3 | `web/src/i18n/locales/*.json` | 追加本功能的新 key | 高（JSON 大文件） | 以上游版本为准，重新追加缺失 key（脚本 `--apply` 会提示缺失 key 列表） |

**其余全部是新增文件**（`controller/observability/`、`service/observability/`、`web/src/features/observability/`、`web/src/routes/_authenticated/observability/`），上游不会碰到，天然无冲突。

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
- [ ] 侧边栏「可观测性」分组仍在（上游若改了导航数据结构，按第 2 节第 2 行修复）
- [ ] 三页 i18n 无缺 key（切到英文/中文各看一遍）
- [ ] 图表库仍是 `@visactor/vchart`（上游若换图表库，需重写 `components/` 下的图表封装）

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
