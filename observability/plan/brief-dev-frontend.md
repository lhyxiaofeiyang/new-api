# 任务简报 — dev-frontend（T3）

## 你的角色

本项目（New API 的 fork）的**前端开发 agent**，由 Hermes 主控编排。
工作目录：`/Users/gaoxiaoqi/Documents/personal/project/new-api`，分支：`feat/observability`。
前端目录：`web/`；包管理器 **Bun**（`export PATH="$HOME/.bun/bin:$PATH"`）。

## 目标

新增「可观测性」三页 UI，**风格与 New API 现有页面完全一致**（同一套组件与语义 token，不引入新 UI 库）。

## 开工前必读（按顺序）

1. `web/AGENTS.md` —— 前端硬约束（Bun、rsbuild、i18n key 用英文原文、typecheck/lint 必须过）
2. `AGENTS.md` —— 根约束
3. `observability/plan/03-ui-spec.md` —— **三页 UI 规格**（布局、组件复用清单、交互约定）
4. `observability/plan/02-api-contract.md` —— 后端契约（你要对接的参数与响应字段）
5. 上游范例（**照抄结构与排版手法**）：
   - `web/src/routes/_authenticated/dashboard/index.tsx` 与 `$section.tsx` —— 多 section 单路由模式
   - `web/src/features/dashboard/**` —— 页面骨架、卡片网格、图表封装
   - `web/src/components/data-table/**` —— 表格封装（TanStack Table）
   - `web/src/components/layout/section-page-layout.tsx` —— 页头/布局
   - `web/src/components/ui/**` —— Card/Select/Badge/Skeleton 等基础组件
   - 找一个现有 feature 的 api 层与 react-query hooks 写法（`web/src/features/*/api*`、`web/src/lib/`）

## 交付物

1. **新增** `web/src/routes/_authenticated/observability/{index.tsx,$section.tsx}`
2. **新增** `web/src/features/observability/`：三页（overview / monitoring / usage）+ 组件 + api 层 + 类型 + `__tests__/`
3. **修改** `web/src/hooks/use-sidebar-data.ts`：在 `navGroups` 中**新增一个分组**（唯一允许修改的现有 TS 文件）：
   - `id: 'observability'`，`title: t('Observability')`
   - 位置：**紧随 `general` 分组之后**
   - 三个条目：`/observability/overview`（Dashboard）、`/observability/monitoring`（Request Monitoring）、`/observability/usage`（Usage Analytics）
   - 图标用 `lucide-react` 中已有风格相近的图标（如 Gauge / RadioTower / ChartColumn，若不存在则选最接近的）
4. **修改** `web/src/i18n/locales/*.json`：追加本功能需要的所有 key（key 用英文原文；至少保证 `zh` 与 `en` 完整，其余语言文件同步追加）

## 硬约束（违反即返工）

- **不修改**任何现有页面/组件/路由的行为；不重排既有导航分组。
- 只用上游已有组件与 Tailwind v4 **语义 token**；不引入新 UI 库、不自定义配色。
- 文案一律 `t('English Key')`，不留硬编码中文/英文。
- 所有筛选状态写入 URL query（TanStack Router search params）。
- 数字格式：token 千分位 + K/M 简写；美元 2 位小数；延迟 ms。
- 空数据显示空态（复用上游 Empty 组件），不渲染 0 值表格。
- 后端未就绪时：可用契约里的示例响应结构先做类型与视图，**不要伪造后端**；用 mock 文件放 `__tests__/`。

## 自检（必须真实执行，把输出贴进汇报）

```bash
cd /Users/gaoxiaoqi/Documents/personal/project/new-api/web
export PATH="$HOME/.bun/bin:$PATH"
bun run typecheck && bun run lint && bun test
bun run build        # 产出 web/dist，后端会 embed 它
```

## 汇报格式（完成后）

1. 新增/修改文件清单（路径 + 一句话职责）
2. 自检命令的**真实输出摘要**
3. 三页各自的截图或关键 DOM 结构说明（若无法截图，描述页面结构）
4. 未决问题 / 需主控确认的点

## 明确不做

不做后端代码；不做账号巡检/凭证池等 CPA 模块；不重构上游既有页面。
