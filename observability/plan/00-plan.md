# New API 可观测性看板 — 实施计划

- **上游**：QuantumNous/new-api ｜ **Fork**：`lhyxiaofeiyang/new-api`
- **基线**：`upstream/main` HEAD（= `v1.0.0-rc.40` + `#7504`，已对齐） ｜ **开发分支**：`feat/observability`（`main` 仅镜像上游）
- **本地路径**：`~/Documents/personal/project/new-api`
- **目标页**：仪表盘 / 请求监控 / 用量分析（维度下沉到 **API Key（令牌） + 渠道**）
- **参照物**：CPA-Manager-Plus 的信息结构（**不照搬其 UI 与代码**）

---

## 1. 范围

### 做
| 页面 | 核心内容 |
|---|---|
| 仪表盘 | 今日概览（调用数/成功失败/成功率/token 拆分/成本/平均延迟）、实时 RPM·TPM、Top 模型、流量趋势、24h 活跃、请求健康时间线、数据源状态 |
| 请求监控 | 明细表（时间/令牌/渠道/模型/tokens/额度/耗时/首字节/流式/重试链）、多维筛选、下钻聚合、失败明细、JSON 导出（脱敏） |
| 用量分析 | API Key 维度、渠道维度、渠道类型（Provider）维度、模型维度、成本与 token 拆分、热力矩阵（令牌×模型 / 渠道×模型 / 渠道类型×模型）、趋势 |

### 不做（明确排除）
账号巡检 / 凭证池 / OAuth 刷新 / 配额窗口 / 价格同步 / 自动冷却等 CPA 专属模块；
`reasoning_tokens` 卡片（New API 无该字段）；`cache_read/cache_creation` 拆分（只给合并 `cache_tokens`）。

---

## 2. 已确认决策

| # | 决策 | 取值 |
|---|---|---|
| 1 | 基线版本 | **upstream/main HEAD**（= rc.40 + #7504，已 rebase 对齐；服务器 rc.39 → 部署时升级）|
| 2 | 分支策略 | **双分支**：`main` 只镜像上游；全部改动在 `feat/observability` |
| 3 | 侵入红线 | **只新增文件 + 极少数注册点**；不改现有页面 / API / schema |
| 4 | 导航落位 | **新增独立导航分组「可观测性」，紧随「常规」分组之后**（已确认）|
| 5 | herdr 编排 | 4 个 agent：dev-backend / dev-frontend / test / review |
| 6 | fork 形态 | public fork（GitHub 不支持 private fork） |
| 7 | 数据层 | 同进程 GORM **只读**查 `logs`；**零新表**；代码层禁止写操作 |
| 8 | 失败率 | **已授权**：部署时开启 `ERROR_LOG_ENABLED=true`（含 unit 备份与回滚点）；代码仍按可降级实现 |
| 9 | DoD 降级 | 去掉 reasoning_tokens；cache 合并展示；不做凭证模块 |
| 10 | 验证标准 | **数字一致性优先**（对比手工 SQL），加 vitest + Go 单测 |
| 11 | 部署 | 本地交叉编译 → 二进制替换（`.old` 回滚）→ 沿用 `/opt/new-api/current` |
| 12 | 上游 PR | 暂不提；代码保持通用性 |

---

## 3. 架构与落位（含最小改动点）

### 3.1 后端（新增为主）

```
controller/observability/            ← 新增包
  summary.go                         仪表盘聚合
  monitoring.go                      明细 + 筛选 + 下钻 + 导出
  usage.go                           多维聚合 + 矩阵 + 趋势
  query.go                           共用：时间区间解析、三库兼容 SQL 构造
  sqlbuilder.go                      条件拼装（Where/Order/Paginate）
service/observability/               ← 新增包（业务聚合，与 controller 分层）
  summary_service.go
  monitoring_service.go
  usage_service.go
  model.go                           DTO 定义
router/api-router.go                 ← 最小改动：新增 1 个路由组（约 6 行）
```

路由注册（在 `router/api-router.go` 中，紧邻既有分组，遵循现有写法）：

```go
// observabilityRoute := apiRouter.Group("/observability")
// observabilityRoute.Use(middleware.AdminAuth())
//   GET /summary       → controller/observability.GetSummary
//   GET /requests      → controller/observability.GetRequests
//   GET /requests/export → controller/observability.ExportRequests
//   GET /usage         → controller/observability.GetUsage
```

### 3.2 前端（全部新增 + 1 处导航注册）

```
web/src/routes/_authenticated/observability/
  index.tsx                          redirect → /observability/overview
  $section.tsx                       三页壳（照 routes/_authenticated/dashboard/$section.tsx 模式）
web/src/features/observability/
  index.ts                           导出三页
  types.ts                           后端 DTO 的类型映射
  api.ts                             react-query hooks（照现有 feature 的 api 层写法）
  overview/overview-page.tsx         仪表盘
  monitoring/monitoring-page.tsx     请求监控
  usage/usage-page.tsx               用量分析
  components/                        卡片、图表、表格、筛选器、热力矩阵
  __tests__/                         vitest
web/src/hooks/use-sidebar-data.ts   ← 最小改动：新增 1 个 navGroup（约 10 行）
web/src/i18n/locales/*.json         ← 追加 key（7 个语言文件；key 用英文原文）
```

导航注册示意（`useSidebarData()` 的 `navGroups` 中，紧随 `general` 之后插入）：

```ts
{
  id: 'observability',
  title: t('Observability'),
  items: [
    { title: t('Dashboard'),  url: '/observability/overview',   icon: Gauge },
    { title: t('Request Monitoring'), url: '/observability/monitoring', icon: RadioTower },
    { title: t('Usage Analytics'),    url: '/observability/usage',      icon: ChartColumn },
  ],
}
```

**侵入点总计 3 处**（均在计划内、均极小）：`router/api-router.go`、`use-sidebar-data.ts`、`i18n/locales/*.json`。
`app-sidebar.tsx` **无需改动**（其注释已声明新增视图只需注册）。

### 3.3 UI 风格延续策略

- **只用上游已有组件与 token**：`components/ui/*`（shadcn 风格）、`components/data-table/*`、Tailwind v4 语义 token、`@visactor/vchart` 图表。
- 复制现有页面骨架（`features/dashboard/*`）的排版手法：`SectionPageLayout`、`Card` 网格、`PageFooter`。
- 不引入新 UI 库、不自定义配色；图标统一 `lucide-react`。
- 文案全部走 `t('English Key')`，中文由 `zh.json` 提供（"通用"→"常规"同机制）。

---

## 4. 数据策略

- **只读**：复用进程内 GORM 连接（`model.DB`），新查询一律 `SELECT`；任何写操作视为缺陷。
- **不做预聚合/rollup**：实测 1.2 万行规模聚合 12–17 ms。数据量增长后按 CPAMP 的游标 rollup 模式追加（架构预留）。
- **三库兼容**：时间区间用参数化条件，分桶在 Go 侧；不写方言函数；`logs.other` 在 Go 侧反序列化。
- **失败率**：依赖 `ERROR_LOG_ENABLED`。**已获授权在部署时开启**（默认 false）；代码仍按"开启/未开启"两种状态实现，未开启时降级为 `perf_metrics` 的模型×分组成功率 + 前端提示，不显示假 0。

---

## 5. 任务分解

| 任务 | 内容 | 归属 | 验收标准 |
|---|---|---|---|
| **T1** | 冻结 API 契约（`02-api-contract.md`）+ DTO 定义 | hermes（我） | 契约文件定稿，三页字段全部有出处 |
| **T2** | 后端：`service/observability` + `controller/observability` + 路由注册 | dev-backend | `go build` + `go vet` 通过；单测覆盖三条查询；三库测试均绿 |
| **T3** | 前端：三页 UI + api 层 + 路由 + 导航注册 + i18n | dev-frontend | `bun run typecheck` + `bun run lint` 通过；三页在本地实例可交互 |
| **T4** | 测试：边界、空数据、大区间、失败降级、导出脱敏 | test | 新增测试全绿；报告中列出覆盖矩阵 |
| **T5** | 审查：规范符合性、组件复用、侵入度核查、只读确认 | review | 输出问题清单；**无阻塞项**才放行 |
| **T6** | 本地端到端验证：与手工 SQL 数字一致性对照 | hermes + test | `04-verification.md` 记录逐项数字对照证据 |
| **T7** | 文档：更新说明 / 升级合并手册 / 部署回滚 | hermes | `release/*` 三份文档完成且可照做 |
| **T8** | 部署到服务器（需你确认） | hermes | 二进制替换 + 服务健康 + 三页可访问 + 回滚点保留 |

---

## 6. 验证计划

**本地（不接触生产）**
1. 用服务器库的**脱敏副本**跑本地实例（脱敏：`users.username/access_token`、`tokens.key`、`channels.key`）。
2. **数字一致性**：每个卡片/表格的关键数字由 `sqlite3 -readonly` 手工 SQL 得出，与页面显示逐项比对，差异必须为 0。
3. `go test ./controller/observability/... ./service/observability/...`、`bun run typecheck`、`bun run lint`、`bun test`。
4. 三库兼容：SQLite（真实）、MySQL / PostgreSQL（容器起最小实例跑同一组用例）。
5. 极端数据：空库、超长区间、无失败日志。

**服务器（部署阶段，需授权）**
6. 二进制备份 + 服务重启 + `/api/status` 200 + 三页人工核对一个已知数字。
7. 回滚演练：切回 `.old` 二进制，确认恢复。

---

## 7. 交付物

1. `feat/observability` 分支（可合并/可丢弃）
2. `observability/` 目录：plan / 契约 / UI 规格 / 验证记录 / 更新说明 / 升级合并手册 / 部署手册 / `sync-upstream.sh`
3. 本地验证证据（数字对照表、测试输出）
4. 部署产物（linux/amd64 静态二进制）+ 回滚点

---

## 8. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| 上游后续重构 `use-sidebar-data.ts` / `api-router.go` | 合并冲突 | 改动极小且集中；`UPGRADE-MERGE.md` 给出逐处解决步骤 |
| 上游前端栈再变（rc.40 已是 Base UI + Tailwind4 + vchart） | 大改需重写 UI | 只用公共组件与语义 token，减少硬绑定 |
| `logs` 表结构变化 | 聚合失效 | 查询集中在一个包；schema 断言测试 |
| 无失败日志时"成功率"口径 | 数字误导 | 前端显式标注数据来源与口径 |
| 服务器停机窗口 | 短暂不可用 | 沿用既有约定（停机约 3 秒），选低峰执行并留 `.old` |

**已确认结论（原开放问题）**
- Q-A 导航落位：新增独立分组「可观测性」，位置**紧随「常规」分组之后**。—— 已确认
- Q-B 失败率：**已授权**在部署时开启 `ERROR_LOG_ENABLED=true`（须先备份 unit 文件留回滚点）。—— 已确认
- Q-C 基线：对齐 **upstream/main HEAD**（rc.40 + #7504），不锁 tag。—— 已确认

---

## 9. herdr 编排

| 角色 | 工具/模型 | 职责 | 工作区 |
|---|---|---|---|
| hermes（主控） | — | 契约冻结、任务拆分、验收、GitHub、文档、部署 | — |
| `dev-backend` | Claude Code / Sonnet | T2 | 仓库根（Go） |
| `dev-frontend` | Claude Code / Sonnet | T3 | `web/` |
| `test` | Codex / GPT-4o-mini | T4 | 仓库根 |
| `review` | Claude Code / Sonnet | T5 | 只读全仓 |

串行依赖：T1 → T2/T3（可并行，契约已冻结）→ T4 → T5 → T6 → T7 → T8。

**降级预案**：Sonnet 不可用 → Haiku（并告知）；Haiku 也不可用 → 征询是否切 Codex。
