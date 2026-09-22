# 任务简报 — dev-backend（T2）

## 你的角色

本项目（New API 的 fork）的**后端开发 agent**，由 Hermes 主控编排。
工作目录：`/Users/gaoxiaoqi/Documents/personal/project/new-api`，分支：`feat/observability`。
所有命令都在该目录下执行。

## 目标

实现「可观测性」三页所需的 **4 个只读 API 端点**。契约已冻结，**以契约文件为唯一权威**。

## 开工前必读（按顺序）

1. `AGENTS.md` —— 上游硬约束（三库必须支持、代码规范）
2. `observability/plan/02-api-contract.md` —— **权威契约**：4 个端点的路径、参数、响应字段
3. `observability/plan/01-field-mapping.md` —— 字段来源与三库兼容注意事项
4. `observability/plan/00-plan.md` —— 范围、落位、验收标准（第 3、5 节）
5. 上游范例（**照抄其分层与写法风格，不要自创模式**）：
   - `model/log.go` —— `logs` 表结构与 GORM 模型（字段名以此为准）
   - `controller/log.go` —— logs 查询、分页、响应封装写法
   - `router/api-router.go` —— 路由注册约定（注意 `logRoute` 的注册方式）
   - 任选一个 `service/` 下文件 —— 业务分层写法
   - `common/` 下的额度换算常量（quota → 美元，契约第 5 节第 7 条）

## 交付物

1. **新增** `service/observability/`：聚合业务逻辑（按端点和维度拆文件）
2. **新增** `controller/observability/`：HTTP 层（参数解析、鉴权后取值、响应封装）
3. **修改** `router/api-router.go`：新增 1 个路由组（**这是唯一允许修改的现有文件**，约 6 行）
4. Go 单测（README/AGENTS.md 要求的测试位置与命名）

## 硬约束（违反即返工）

- **只读**：仅使用 GORM 的 `Select` / `Find` / `Scan` / `Count` / `Raw("SELECT ...")`。
  **禁止**任何 `Create` / `Update` / `Delete` / `Save` / `Exec` 写操作；不得新增或修改表结构。
- **时间条件参数化**：`WHERE created_at >= ? AND created_at < ?`。
  **禁止**方言函数：`strftime` / `FROM_UNIXTIME` / `date_trunc` / `DATE()`；时间分桶在 Go 侧做。
- **SQL 侧不解析 JSON**：`logs.other` 在 Go 侧 `json.Unmarshal` 后取
  `cache_tokens` / `cache_ratio` / `frt` / `model_price` / `request_policy`。
- **渠道名必须 JOIN**：`LEFT JOIN channels ON channels.id = logs.channel_id`
  （实测 `logs.channel_name` 为空，不可用）。
- **日志类型过滤**：消费日志 `type = 2`，错误日志 `type = 5`。
- 不修改任何现有页面、现有 API 行为、现有表结构。
- 响应 JSON 字段用 `snake_case`；错误响应用上游既有封装写法。
- 必须同时兼容 SQLite / MySQL / PostgreSQL。

## 自检（必须真实执行，把输出贴进汇报）

```bash
cd /Users/gaoxiaoqi/Documents/personal/project/new-api
go build ./... && go vet ./... && go test ./controller/observability/... ./service/observability/...
```

本地有一个可用的 SQLite 库可用于冒烟（**只读**打开）：
`~/.hermes/cache/scratch/` 下如有 new-api 源码副本，可参考；
生产库**不在**本机，不要尝试连接任何远程数据库。

若需要真实数据验证 SQL 语义，可用 `sqlite3` 在本地临时建库、灌入少量构造数据来跑聚合逻辑的单元测试
（**测试数据自造，禁止使用真实用户数据**）。

## 汇报格式（完成后）

1. 新增/修改文件清单（路径 + 一句话职责）
2. 自检命令的**真实输出摘要**（build/vet/test 结果）
3. 与契约的偏差（若有，逐条说明原因）
4. 未决问题 / 需主控确认的点

## 明确不做

账号巡检、凭证池、OAuth、配额窗口、价格同步、自动冷却等 CPA 专属模块；
`reasoning_tokens`（无数据来源）；任何写操作；任何前端代码。
