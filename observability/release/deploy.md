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
  -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.40-obs.1'" \
  -o ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64 .

file ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64
#  期望：ELF 64-bit LSB executable, x86-64, ..., statically linked, ..., stripped
shasum -a 256 ~/.hermes/cache/scratch/obs-t6/new-api-linux-amd64
```

**本次已验证产物**（基线 `upstream/main` = `v1.0.0-rc.40` + `#7504`）：

```
ELF 64-bit LSB executable, x86-64, statically linked, stripped
sha256: 2fe0841c2a7bcce90d8bf4b0722d593c4c41efcb48bb574a3bec6aa0c2afe7aa
版本字符串（仅用于展示/遥测）：v1.0.0-rc.40-obs.1
```

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
- [ ] `/api/status` = 200，且 `version` = `v1.0.0-rc.40-obs.1`
- [ ] `/api/observability/summary` **由 404 变为 401**（未带管理员凭证时 401 即正确：路由已注册且鉴权生效）
- [ ] `/api/observability/nonexistent` = 404（反证路由非兜底通配）
- [ ] 浏览器打开三页，各核对**一个已知数字**与手工 SQL 一致：
      ```bash
      $SSH 'sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" \
        "select count(*), sum(quota) from logs where type=2 and created_at >= strftime(\"%s\",\"now\",\"-1 day\");"'
      ```
- [ ] 既有页面回归：overview / models / logs / channel 正常
- [ ] 侧边栏出现「可观测性」分组（位于「常规」之后）
- [ ] 开启 `ERROR_LOG_ENABLED` 后制造一次失败请求，确认 `logs` 出现 `type=5`：
      ```bash
      $SSH 'sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" "select count(*) from logs where type=5;"'
      ```
      **若仍为 0**：失败事件未落库，此时仪表盘失败率仍走 `perf_metrics` 近似路径
      （`data_source.failure_source=perf_metrics`），需另案排查 `service/relay_error.go:76`。

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
