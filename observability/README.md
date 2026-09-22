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
- **基线**：`v1.0.0-rc.40`
- **开发分支**：`feat/observability`（`main` 仅镜像上游）
- **目标**：在 New API 内新增「可观测性」三页（仪表盘 / 请求监控 / 用量分析），
  数据下沉到 **API Key（令牌）+ 渠道** 维度，参照 CPA-Manager-Plus 的信息结构，但沿用 New API 自身的 UI 规范与技术栈。

## 边界（不可越线）

- 只**新增**文件，加极少数注册点（后端路由注册、前端导航注册、i18n 追加 key）。
- **不修改**现有页面、现有 API 行为、数据库 schema。
- 数据访问一律**只读**；不写入上游任何表。
- 查询必须同时兼容 SQLite / MySQL / PostgreSQL（上游 AGENTS.md 硬约束）。
