# 部署与回滚手册

> 状态：**本地开发验证已全部通过**（见 `../plan/04-verification.md`）；生产改动需用户授权后执行。
> 服务器：`xiaoqi-lighthouse`（腾讯云，4C/3.7G）
> 既有布局：`/opt/new-api/current/new-api`（部署前为 **v1.0.0-rc.39**）
> **已核实事实**：systemd unit = **`new-api.service`**；`systemctl show -p Environment` 为空（无任何环境变量）；
> 未安装 ClickHouse；`LOG_SQL_DSN` 未设 → 日志与主库同一 SQLite；DB `/opt/new-api/current/one-api.db`。

## 1. 构建（本地交叉编译，无需 Docker；镜像上游 Dockerfile 的 CGO_ENABLED=0 + -s -w）

```bash
cd ~/Documents/personal/project/new-api
export PATH="$HOME/.bun/bin:$PATH"
export GOPROXY=https://goproxy.cn,direct GOSUMDB=off   # 本机 proxy.golang.org 不可达

# 前端（产物被 Go embed 进二进制）
cd web && bun install --frozen-lockfile && bun run build && cd ..

# 后端
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOWORK=off \
  go build -trimpath \
  -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.40-obs.6'" \
  -o ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64 .

file ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64
#  期望：ELF 64-bit LSB executable, x86-64, ..., statically linked, ..., stripped
shasum -a 256 ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64
```

**已验证产物：obs.6（当前源码，部署用）**（基线 `upstream/main` = `v1.0.0-rc.40` + `#7504`）：

```
linux/amd64  sha256: bb633ff388b5ef63c98e7a43bc893a4147804fc0d1c26d6c904ebfef6f5c923c   138,678,434 字节
darwin/arm64 sha256: 10e570d5aae66fb158b19da5fbfecc47ce601ce7878eb67b703ebb89912acb23   139,657,570 字节（本地测试用）
前端 bundle：index.49f0c75cc6.js
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.6（两个平台自报一致）
构建时间（本机 +08）：前端 2026-09-24 10:32；linux/amd64 10:32:49；darwin/arm64 10:32:54
```

> **obs.6 仅含前端改动**（两处 UI 修正，见 `CHANGELOG-fork.md`），Go 侧零代码变化。
> **构建顺序有硬性前提**：`web/dist` 原为 09:51（= obs.5 那次构建），而两处源码改于 10:23–10:24，
> 即 **dist 早于源码**。必须先 `bun run build` 重建前端再交叉编译，否则产物里嵌的仍是旧界面。
> 本轮即按此顺序执行，产物内嵌 bundle 由 `index.be36a0f361.js` 变为 `index.49f0c75cc6.js`。

**已验证产物：obs.7（当前源码，部署用；2026-09-24 已上线生产，见第 8 节）**（基线 `upstream/main` = `v1.0.0-rc.40`，已合并 `d04c118c8`）：

```
linux/amd64  sha256: 9bcf60c17048ed81c96bfa20d354f29b7267d00b0d90071eba3467e89a4848a4   138,682,530 字节
darwin/arm64 sha256: 853c5ad8c1a8ef82283807a1636613f84bfc2c1d70c0efb54787185173d8fecd   139,657,570 字节（本地测试用）
前端 bundle：index.ca3306be08.js（两平台内嵌一致）
版本字符串（ldflag 注入，仅用于展示/遥测）：v1.0.0-rc.40-obs.7（两平台自报一致，二进制内嵌串已核）
构建自 HEAD：16b3a7c75a25ed32909c0a30bcfeefa0048e62d2（已合并 upstream/main d04c118c8）
构建时间（本机 +08）：前端 12:15:16–12:15:23；linux/amd64 12:15:35–12:15:39；darwin/arm64 12:15:46–12:15:50
```

> **obs.7 接替 obs.6**：上方 obs.6 小节的「当前源码，部署用」表述自本轮起成为**历史**（obs.6 的两平台
> sha256 `bb633ff3…` / `10e570d5…`、bundle `index.49f0c75cc6.js` 与版本串 obs.6 **原样保留**，未改一字）。
> obs.7 相对 obs.6 只有三点差异：① 本轮**重建前端**（`web/dist` 原为 10:32，而源码改于 10:50，
> **dist 又一次早于源码**）→ bundle 由 `index.49f0c75cc6.js` 变为 **`index.ca3306be08.js`**；
> ② 合入 `upstream/main` `d04c118c8`（7 提交 / 11 文件，**仅 `web/` 与 `.github/workflows/`，无一行 Go**）
> → Go 侧仍零代码变化；③ 版本串注入 obs.7。
> **工件差分标记复核（证明内嵌前端确已替换）**：`LC_ALL=C grep -ac 'size-5 shrink-0 opacity-60'` = **0**、
> `'w-full table-fixed'` = **1**；新文案 `失败统计自开启错误日志起` = **1**、
> `失败为估算值，开启错误日志后转为准确统计` = **1**（两平台结果一致）。
> **尺寸巧合（如实记录，非判据）**：obs.7 linux = 138,682,530 字节，与 obs.5 **等长**，但 sha256 不同
> （`9bcf60c1…` vs `6ee57d20…`，`cmp -l` 差异 71,672,431 处），内嵌 bundle 亦不同——判据一律以
> **sha256 + 内嵌 bundle/版本串**为准。

**历史产物：obs.5（仅为记录，勿与上表混用）**：

```
linux/amd64  sha256: 6ee57d20f043c8966d9767d7b50f63839f4f577ddebe46fa907cb07f42d7b0d2   138,682,530 字节
darwin/arm64 sha256: 2d72c874a3364cbfbb02061ae410f2112ad8858857f4acc28aa3fccafb63d68c   139,657,570 字节
前端 bundle：index.be36a0f361.js
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.5
```

**历史产物：obs.4（仅为记录，勿与上表混用）**：

```
linux/amd64  sha256: a0232615679891769795def579b167f8583227be9282286ab917494a5fee53b6   138,678,434 字节
darwin/arm64 sha256: 167ff7af89cd9aff22f2456cf6360560658ba155a6ddef80cee5dba2ed671e5b   139,657,506 字节
前端 bundle：index.3922608061.js
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.4
```

**历史产物：obs.3（仅为记录，勿与上表混用）**：

```
linux/amd64  sha256: 0b171b6f1fe0a129350c1a784fb33e4c25538bebb330acb79a774e0712fedd16   138,678,434 字节
darwin/arm64 sha256: 03576a7b5a51eb29234135a80afcaec444653b3828b2dfed09488b2c218fb6cb   139,657,506 字节
前端 bundle：index.986e5224db.js
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.3
```

**历史产物：obs.2（仅为记录，勿与上表混用）**：

```
linux/amd64  sha256: 1284cc9bfa83d5d715c5c12d2a2d5b3494fa7b2a972f250252c24a48d1a8c3dd   138,674,338 字节
darwin/arm64 sha256: 660414af04d744e1bde66f0a196dcf9f7c723b053d9ad07052712fa353e2b910   139,640,994 字节
前端 bundle：index.1e544940fb.js
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.2
```

**历史产物：obs.1（仅为记录，勿与上表混用）**：

```
ELF 64-bit LSB executable, x86-64, statically linked, stripped
sha256: 2fe0841c2a7bcce90d8bf4b0722d593c4c41efcb48bb574a3bec6aa0c2afe7aa
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.1
```

> **obs.6（本轮）**已按 `-ldflags` 注入 obs.6 版本串并重新构建；两个平台自报版本均为 `v1.0.0-rc.40-obs.6`，
> 内嵌前端 bundle 名与 `web/dist` 一致（`index.49f0c75cc6.js`）。**六块 sha256 互不相同、不可互换**。
> 本轮为纯前端改动，故以**前端产物差分标记**证明内嵌前端确已替换（新旧两个 chunk 名双向消失/出现，见 `CHANGELOG-fork.md`
> 产物小节与 `plan/04-verification.md` 本轮记录）。**obs.5 那一段及更早的记录一律保留、不改动**。

> **obs.5**（历史记录，保留原样）已按 `-ldflags` 注入 obs.5 版本串并重新构建；两个平台自报版本均为 `v1.0.0-rc.40-obs.5`，内嵌前端 bundle 名与
> `web/dist` 一致（`index.be36a0f361.js`），与第 5 节验收项一致。
> 本轮新增文案有一条 `strings` 不可达（`{{calls}} calls · {{amount}}` 含非 ASCII 中点 U+00B7，`strings` 默认只取可打印 ASCII），
> 已改以字节检索证明其存在（`grep -ac 'calls}} calls · {{amount}}'` 命中 2），详见 `CHANGELOG-fork.md` 产物小节。
> obs.4 / obs.3 / obs.2 / obs.1 四块只是历史记录。回滚到上一版：`~/.hermes/cache/scratch/obs-t6/` 下留有
> `new-api-linux-amd64.obs5-bak`（= obs.5，sha256 `6ee57d20…`；darwin 侧 `2d72c874…`）、
> `new-api-linux-amd64.obs4-bak`（= obs.4，sha256 `a0232615…`）、`new-api-linux-amd64.obs3-bak`（= obs.3，sha256 `0b171b6f…`）、
> `new-api-linux-amd64.obs2-bak`（= obs.2，sha256 `1284cc9b…`）与 `new-api-{linux-amd64,darwin-arm64}.obs1-bak`（= obs.1）。

> 注：仓库 `VERSION` 文件为空，上游构建实际写入空版本；本次显式注入可识别版本号。
> `common.Version` 仅用于 `X-New-Api-Version` 头、`/api/status`、启动横幅与日志，**无升级判断逻辑**，可安全自定义。

## 2. 部署前检查（只读）

```bash
SSH="ssh -o ControlMaster=auto -o ControlPath=~/.ssh/cm/xiaoqi -o ControlPersist=600 -o BatchMode=yes xiaoqi-lighthouse"
$SSH '
  U=new-api.service
  systemctl is-active $U
  systemctl show $U -p Environment          # 期望为空（尚未开 ERROR_LOG_ENABLED）
  ls -la /opt/new-api/current/
  sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" "select count(*) from logs;"
  curl -s -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/status
  curl -s -o /dev/null -w "obs_before=%{http_code}\n" http://127.0.0.1:3000/api/observability/summary
'   # obs_before 期望 404（旧版无此路由）——这是「改前」基线
```

## 3. 部署（上传 → 备份旧二进制 → 替换 → 重启）

```bash
SSH="ssh -o ControlPath=~/.ssh/cm/xiaoqi -o BatchMode=yes xiaoqi-lighthouse"
scp ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64 xiaoqi-lighthouse:/tmp/new-api-new

$SSH '
  set -e
  U=new-api.service
  TS=$(date +%Y%m%d-%H%M%S)
  cd /opt/new-api/current
  cp -p new-api "new-api.old.$TS"          # 备份**先于**替换（回滚点）
  install -m 0755 /tmp/new-api-new ./new-api
  echo "新二进制 sha256: $(shasum -a 256 ./new-api | cut -d\" \" -f1)"
  systemctl restart $U
  sleep 4
  systemctl is-active $U
  curl -s http://127.0.0.1:3000/api/status | head -c 200; echo
  curl -s -o /dev/null -w "status=%{http_code}\n"  http://127.0.0.1:3000/api/status
  curl -s -o /dev/null -w "obs=%{http_code}\n"     http://127.0.0.1:3000/api/observability/summary
  curl -s -o /dev/null -w "obs404=%{http_code}\n"  http://127.0.0.1:3000/api/observability/nonexistent
  echo "ROLLBACK_TAG=$TS"
'
```

> 替换只动二进制，**不触碰 DB**。旧二进制以时间戳保留；目录中另有更早的 `new-api.old`。

## 4. 开启错误日志（失败率所需，**已获用户授权**）

> **本节即部署默认动作**：上面第 3 节发版后，**默认继续执行本节**，使生产运行在
> `ERROR_LOG_ENABLED=true` 形态（`failure_source=error_log`，成功/失败/流式三项同源）。
> 这既是功能前提（失败率仅在此形态下由真实错误日志驱动），也是本项目验证过的最终形态
> （本地实例即以该环境变量端到端验证通过）。
> **回滚方式**见本节末尾与第 6 节「回滚错误日志开关」——删 drop-in → `daemon-reload` → `restart`
> → `systemctl show -p Environment` 期望回到空；unit 文件另有 `.bak-<时间戳>` 备份。

单变量改动 + 先备份 unit 文件与 drop-in：

```bash
$SSH '
  set -e
  U=new-api.service
  mkdir -p /etc/systemd/system/$U.d
  cp -p /etc/systemd/system/$U /etc/systemd/system/$U.bak-$(date +%Y%m%d-%H%M%S)   # 回滚点
  printf "[Service]\nEnvironment=ERROR_LOG_ENABLED=true\n" > /etc/systemd/system/$U.d/error-log.conf
  systemctl daemon-reload
  systemctl restart $U
  sleep 4
  systemctl is-active $U
  systemctl show $U -p Environment      # 期望：Environment=ERROR_LOG_ENABLED=true
'
```

## 5. 验收

- [ ] `systemctl is-active new-api.service` = active
- [ ] `/api/status` = 200，且 `version` = `v1.0.0-rc.40-obs.6`
- [ ] `/api/observability/summary` **由 404 变为 401**（未带管理员凭证时 401 即正确：路由已注册且鉴权生效）
- [ ] `/api/observability/nonexistent` = 404（反证路由非兜底通配）
- [ ] 浏览器打开三页，各核对**一个已知数字**与手工 SQL 一致：
      ```bash
      $SSH 'sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" \
        "select count(*), sum(quota) from logs where type=2 and created_at >= strftime(\"%s\",\"now\",\"-1 day\");"'
      ```
- [ ] 既有页面回归：overview / models / logs / channel 正常
- [ ] 侧边栏出现「Token 监控」分组（位于「常规」之后）
- [ ] 开启 `ERROR_LOG_ENABLED` 后制造一次**渠道级**失败请求，确认 `logs` 出现 `type=5`：
      ```bash
      $SSH 'sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" "select count(*) from logs where type=5;"'
      ```
      **必须触发「已选中渠道、上游返回错误」的失败**才可能落 `type=5`（本地已验证路径：向一个**真实存在、
      但上游会拒绝**的 model 发请求，如余额/配额/参数被上游判错）。**向不存在的 model 发请求无效**——
      它在路由选中渠道之前就被拒（`middleware/distributor.go:110-121`），**不**写 `type=5`（本地实测：该情形前后计数不变）。
      **若计数仍为 0**：失败事件未落库；若 `data_source.failure_source=perf_metrics`（即开关未生效），
      还需排查 systemd drop-in 是否真的注入（`systemctl show new-api.service -p Environment`）。

## 6. 回滚

**回滚二进制（约 4 秒）**：

```bash
$SSH '
  U=new-api.service
  cd /opt/new-api/current
  ls -1t new-api.old* | head -1
  cp -p "$(ls -1t new-api.old* | head -1)" new-api
  systemctl restart $U && sleep 4 && systemctl is-active $U
  curl -s -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/status
'
```

**回滚错误日志开关**：

```bash
$SSH '
  U=new-api.service
  rm -f /etc/systemd/system/$U.d/error-log.conf
  systemctl daemon-reload && systemctl restart $U
  sleep 4 && systemctl is-active $U && systemctl show $U -p Environment   # 期望回到空
'
```

> **DB 未做任何变更**（无迁移、无新表），故无需回滚数据库 —— 这是本改造只读设计的一部分。

## 7. 数据安全边界（务必保持）

- 对生产库只做**只读**访问（`file:...?mode=ro`），任何诊断/核对都用只读 URI。
- 生产唯一允许的写操作是 `ERROR_LOG_ENABLED=true` 这一个 systemd 环境变量（已授权），且有 unit 备份可回滚。
- 任何 token / 密码 / 连接串不得写入文档或提交，一律 `[REDACTED]`。

## 8. 生产上线记录（obs.7，2026-09-24）

生产机 `xiaoqi-lighthouse`（腾讯云，4C/3.7G）；部署窗口 **12:17–12:20（+08）**；本轮为**首次真正上线**（此前 obs.1–obs.6 均为本地产物，生产仍跑 `v1.0.0-rc.39`）。

### 8.1 替换前后二进制

| 位置 | 二进制 sha256 | 字节 |
|---|---|---|
| 替换前（`/opt/new-api/current/new-api`） | `c2d488fcb612964a8a9ceb61612f27349b65abde9467098963edd1041b6651fd` | 138,645,769 |
| **替换后**（同上，本轮的 obs.7 产物） | **`9bcf60c17048ed81c96bfa20d354f29b7267d00b0d90071eba3467e89a4848a4`** | 138,682,530 |

上传路径 `scp … → xiaoqi-lighthouse:/tmp/new-api-obs7`，服务器端 sha256 与本地逐位一致后才 `install`；随后 `rm -f /tmp/new-api-obs7`。

### 8.2 三个回滚点（绝对路径 + sha256 + 字节，`TS=20260924-121727`）

| # | 绝对路径 | sha256 | 字节 |
|---|---|---|---|
| 1 | `/opt/new-api/data/one-api.db.bak-obs7-20260924-121727` | `d22f26c038dc25774fb594da32427c6cbb76cc95fef4da8a052d2b78994343f3` | 30,666,752 |
| 2 | `/opt/new-api/data/new-api.rc39-20260924-121727` | `c2d488fcb612964a8a9ceb61612f27349b65abde9467098963edd1041b6651fd` | 138,645,769 |
| 3 | `/opt/new-api/data/new-api.service.bak-20260924-121727` | `c300440d18086ae729ab0c9f69e0ecdfb4c2a6f2035cead4344ce5c5b79ea439` | 351 |

回滚点 1 以只读打开 + `.backup` 生成，`pragma integrity_check` = **ok**；回滚点 2 的 sha256 = **替换前基线** `c2d488fc…`（逐位一致）；历史回滚点（`new-api.old`、旧 `.bak`）一并保留。

### 8.3 零迁移证据（schema 未变）

本轮**未做任何 schema 变更** —— 上游本次合入的 7 提交只改 `web/` 与 `.github/workflows/`，无一行 Go，故预期零迁移。生产侧证据（全部只读）：

| 指标 | 替换前 | 替换后 | 判据 |
|---|---|---|---|
| 表数量 | 38 | 38 | 不变 |
| `logs` 列数 | 21 | 21 | 不变 |
| DB 文件 inode | 1205304 | 1205304 | 不变 |
| `pragma integrity_check` | ok | ok | ok |
| `.schema` sha256 | `b986ee6dca69d485a2142a2901576cda34b16bfeae7c06635f4a47c52f44e6b5` | 同左，逐位不变 | 不变 |
| 重启日志内的 DDL | — | `ALTER TABLE` / `CREATE TABLE` / `DROP` 计数 **均为 0** | 零 DDL |

**更强证据（直接对拍）**：把 **rc.39 时期写入的 raw 生产快照**（`obs-t6/one-api-prod-snap-20260923-224404.db`）与**当前生产库**的 schema 直接 `diff`，结果 **DIFF EMPTY / 207 行逐字节相同**，故「零迁移」成立。

> ⚠️ **口径提醒（务必知悉）**：本节 schema 哈希记的是本机可复现的口径 **`.schema | shasum -a 256` = `b986ee6dca69d485…`**。早期工单曾引用过 `ed24e9e197d0389e…`，该值**在本机任何取法（`.schema` / `sql order by name` / `.dump` / `sqlite_master` 原文、sha256/md5/sha1）与任何库（生产库、raw 快照、verify 副本）上均不可复现**，其取法来源不明；判定「零迁移」请以**上表的对拍 diff 为空**为准，勿直接比对工单里那串值。

### 8.4 验收清单（全部通过）

| 验收项 | 结果 |
|---|---|
| `systemctl is-active new-api` | `active`（2 分钟后复验仍 active，`NRestarts=0`、`MainPID` 未变） |
| `/api/status` 版本串 | `v1.0.0-rc.40-obs.7`（替换前为旧问题值 `v0.0.0`，与预期一致地变化） |
| 首页 HTML 内 bundle 名 | `index.ca3306be08.js`（= 本轮新 bundle） |
| 四条看板路由（免鉴权） | `/api/observability/{summary,requests,requests/export,usage}` → **401 / 401 / 401 / 401** |
| 不存在路径 | `/api/observability/nonexistent` → **404**（路由非兜底通配） |
| 监听 | `ss -lntp \| grep 3000` 正常 |
| 日志 | 无 panic / fatal / migration error；无 DDL |
| DB 不变量 | `logs` 行数 ≥ 基线、`max(id)` ≥ 基线、`integrity_check` = ok、inode 不变、schema 不变 |
| **外网 `/v1/models`（`https://api.gaoxiaoqi.online/v1/models`）** | **401**，body `{"error":{…"Invalid token"…}}`（公网 `location ^~ /v1/` 走 New API 密钥鉴权，无凭证即 401，符合预期） |

> **注**：`/api/*` 与 `/` 在 nginx 上挂了 **mTLS**（`location ^~ /api/` 与 `location /` 均 `if ($ssl_client_verify != SUCCESS) { return 403; }`），故从公网裸 `curl` 访问 `/api/status`、`/api/observability/*` 会得到 **nginx 的 403**，而非应用层的 200/401。这是**既有设计**，与本轮改动无关；验收上述 401 均取自**服务器本机回环** `http://127.0.0.1:3000`。

### 8.5 已开 `ERROR_LOG_ENABLED=true`（同轮第三步）

- **生效证据**：`systemctl show new-api -p Environment` → `Environment=ERROR_LOG_ENABLED=true`（改动前为空 `Environment=`）。
- **drop-in**：`/etc/systemd/system/new-api.service.d/error-log.conf`（45 字节，sha256 `dd26f83f79547061d3ed015a0a42785228d3c5371f8f83ec88db246d0a647d46`，mode 644）：

  ```
  [Service]
  Environment=ERROR_LOG_ENABLED=true
  ```

- **原 unit 未被改动**：`/etc/systemd/system/new-api.service` sha256 / inode（132288）/ mtime（2026-09-02 23:13:59）三重不变；drop-in 目录内仅此一个文件。
- **unit 回滚点**：`/opt/new-api/data/new-api.service.bak-errlog-20260924-123019`（sha256 `c300440d…`，351 字节）。
- 重启时间 **2026-09-24 12:30:35 +0800**，`MainPID` 由 `2180337` → `2191272`。
- **回滚方法**：`sudo rm -f /etc/systemd/system/new-api.service.d/error-log.conf && sudo systemctl daemon-reload && sudo systemctl restart new-api` → 复验 `Environment` 回到空。

### 8.6 上线后的待确认项

- **`failure_source` 翻转未从免鉴权侧核实**：看板 `data_source.failure_source` 是否由 `perf_metrics` 翻为 `error_log`，需以**真实管理员凭证**登录查看（`/api/status` 不暴露该字段）。服务侧证据仅能证到「环境变量已生效」与「看板接口在服务器本机 200」。
- **`logs.type=5` 初始仍为 0**：开日志只覆盖**开启之后**的失败；且 `type=5` 只记**渠道级**失败（已选中渠道、上游返回错误），**路由前**失败（如不存在的 model）不落 `type=5`。故需制造一次真实渠道级失败才能观察到增长。

