# 三页 UI 规格（延续 New API 风格）

原则：**只用上游已有组件 + Tailwind 语义 token + lucide-react 图标**，不引入新 UI 库、不自定义配色。
排版沿用 `features/dashboard/*` 与 `SectionPageLayout` 的既有手法，视觉上与 New API 现有页面无差异。

## 通用

| 元素 | 复用来源（先检索再复用，不新建） |
|---|---|
| 页头 / 面包屑 | `components/layout/section-page-layout.tsx` |
| 卡片 | `components/ui/card.tsx` |
| 表格 | `components/data-table/*`（TanStack Table 封装） |
| 图表 | `@visactor/vchart`（与上游现有图表一致） |
| 下拉 / 日期筛选 | `components/ui/select.tsx` / `popover.tsx` / `calendar.tsx` |
| 徽标 / 状态点 | `components/ui/badge.tsx` |
| 数字格式 | 上游既有 `formatQuota` / token 简写工具（先检索，无则新增到 `lib/`） |
| 骨架屏 | `components/ui/skeleton.tsx` |
| 空态 | 上游既有 Empty 组件（先检索） |
| 加载态 | 上游既有 loading 组件（`react-top-loading-bar` 已在依赖中） |

**文案**：所有可见文字走 `t('English Key')`；key 用英文原文（上游约定）；至少补齐 `zh` / `en`，其余 5 个语言文件同步追加（值可先用英文）。

## 1. 仪表盘 `/observability/overview`

```
┌ 时间范围选择：[今日][24h][7d][30d][自定义] ────────────┐
├ 数据源状态条（错误日志未开启时黄色提示）────────────────┤
├ 概览卡（9 张，2 行网格）：
│  总调用 / 总 Token / 总成本 / 平均延迟
│  提示 Tokens / 补全 Tokens / 缓存 Tokens / 流式调用数 / 活跃 Key 数
├ 实时：RPM · TPM（近 60 秒，数字卡）
├ 三列 Top 榜：Top 模型 | Top API Key | Top 渠道（各 5 行）
├ 流量趋势（折线，calls + tokens，按小时/天分桶）
├ 24h 活跃分布（柱状）
└ 请求健康时间线（10 分钟桶 × 144，实时刷新）
```

- 自动刷新：默认关闭，页面顶部提供"自动刷新（30s）"开关（避免无谓查询）。
- 失败率卡：`error_log_enabled=false` 时显示 `—` 与提示文案，不显示 0。

## 2. 请求监控 `/observability/monitoring`

```
┌ 筛选区：[时间范围][API Key][渠道][渠道类型][模型][分组][流式][仅失败][关键词]
├ 汇总条：命中 N 条 · 总 Token · 总额度 · 平均延迟 · 平均首字节
├ 明细表（分页，默认 20/页，可选 50·100·500）
│  列：时间 | API Key | 渠道(名称+类型) | 模型 | 提示/补全/缓存/合计 Token
│      | 额度 | 耗时 | 首字节 | 流式 | 重试链 | 状态
│  行内展开：重试链（渠道切换/耗时/action）、计费还原（model_price·group_ratio）
└ 底部：[导出 CSV] [导出 JSON]
```

- 重试链数据来自 `logs.other.request_policy`（每次 attempt 的 `channel_id` / `elapsed_ms` / `decision.action`）。
- 状态列：`error_log_enabled=false` 时统一显示 `—`，并在汇总条给出说明。
- 导出按钮落在 `AdminAuth` 保护下，导出内容不含任何密钥。

## 3. 用量分析 `/observability/usage`

```
┌ 维度切换：[API Key][渠道][渠道类型][模型][分组]   粒度：[小时][天]
├ 维度表：维度名 | 调用 | 成功/失败 | 提示/补全/缓存/合计 Token | 成本 | 平均延迟 | 占比
│  点击行 → 下钻为「该维度的请求明细」（跳请求监控页并带上筛选）
├ 趋势图：调用 / Token / 成本（可切指标）
├ 成本构成：按维度堆叠
└ 热力矩阵选择：[令牌×模型][渠道×模型][渠道类型×模型] → 矩阵热力图
```

- 矩阵实现：颜色按 token 或成本热度映射，用 Tailwind 语义 token 的透明度插值；不上第三方热力库。
- 下钻用 URL query 传参（保持可分享、可回退）。

---

## 交互约定

- 所有筛选写入 URL query（TanStack Router search params），刷新/分享保持状态。
- 空数据显示上游 Empty 组件 + 说明文案，不显示 0 值表格。
- 数字格式：token 用千分位 + K/M 简写；金额 2 位小数（美元）；延迟 ms。
- 错误态：请求失败显示上游既有错误提示组件（先检索 `lib/http-client` 的错误处理），不做自定义弹窗。
