# New API 可观测性看板 — 项目说明

本目录承载本 fork 的全部**过程文档与交付物**，与上游代码（`web/`、`controller/`、`router/` 等）严格分离，便于未来与上游合并时零冲突。

## 目录

```
observability/
  README.md                    本文件：项目说明与目录导航
  plan/
    00-plan.md                 总实施计划（范围、架构、任务分解、验收、风险）
    01-field-mapping.md        CPAMP 字段 → New API 字段映射与可得性判定
    02-api-contract.md         新增后端 API 契约（待 T1 落定后补全）
    03-ui-spec.md              三页 UI 结构与复用的上游组件清单
    04-verification.md         验证记录（数字一致性对照、测试结果）
  release/
    CHANGELOG-fork.md          fork 更新说明
    UPGRADE-MERGE.md           上游升级合并手册
    deploy.md                  部署与回滚步骤
  scripts/
    sync-upstream.sh           上游同步脚本（fetch + 试合并 + 冲突报告）
```

## 项目定位

- **上游**：[QuantumNous/new-api](https://github.com/QuantumNous/new-api)
- **本 fork**：`lhyxiaofeiyang/new-api`
- **基线**：`upstream/main`（= `v1.0.0-rc.40` + `#7504`，已 rebase 对齐）
- **开发分支**：`feat/observability`（`main` 仅镜像上游）
- **目标**：在 New API 内新增「可观测性」三页（仪表盘 / 请求监控 / 用量分析），
  数据下沉到 **API Key（令牌）+ 渠道** 维度，参照 CPA-Manager-Plus 的信息结构，但沿用 New API 自身的 UI 规范与技术栈。

## 边界（不可越线）

- 只**新增**文件，加极少数已登记侵入点。**侵入点有两个计数口径，不要混用**：
  - **回放口径 = 5 条路径**：`scripts/sync-upstream.sh` 的 `TOUCHPOINTS` 收录 5 条「合并后必须重新落回」的路径
    （`router/api-router.go`、`web/src/hooks/use-sidebar-data.ts`、`web/src/i18n/locales`、`web/src/features/keys/components/api-keys-table.tsx`、
    `web/src/features/keys/components/__tests__/api-key-listing.test.tsx`）。其中 i18n 是**目录**、keys 是**两个文件**，故「5 条路径」不等于文件数。
  - **文件口径 = 12 个既有文件**：`git diff --name-status "$(git merge-base upstream/main HEAD)" -- . ':(exclude)observability'` 实测修改了
    12 个上游既有文件 = 1 路由 + 1 侧边栏 + 7 个语言包 + `features/keys` 的 2 个 + **生成物 `web/src/routeTree.gen.ts`**
    （由 `web/rsbuild.config.ts` 的 `@tanstack/router-plugin` 在构建期自动重生成，**不手改**）。
    逐条登记见 `release/UPGRADE-MERGE.md` 第 2 节（**11 条** = 10 个手改 + 1 个生成物；keys 的测试文件并入第 5 项，不单列）。
- **不修改**现有页面（上述已登记侵入点除外）、现有 API 行为、数据库 schema。
- 数据访问一律**只读**；不写入上游任何表。
- 查询必须同时兼容 SQLite / MySQL / PostgreSQL（上游 AGENTS.md 硬约束）。
