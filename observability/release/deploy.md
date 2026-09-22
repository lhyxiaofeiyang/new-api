# 部署与回滚手册

> 状态：**本地开发验证通过后才执行**。执行前请确认服务器改动项已获授权。
> 服务器：`xiaoqi-lighthouse`（腾讯云，4C/3.7G）；既有布局：`/opt/new-api/current/new-api`（v1.0.0-rc.39）。

## 1. 构建（本地交叉编译，无需 Docker）

```bash
cd ~/Documents/personal/project/new-api
export PATH="$HOME/.bun/bin:$PATH"

# 前端
cd web && bun install --frozen-lockfile && bun run build && cd ..

# 后端（内嵌 web/dist，单二进制）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags "-s -w -X 'new-api/common.Version=v0.1.0-observability'" \
  -o dist/new-api-linux-amd64 .

file dist/new-api-linux-amd64   # 期望：ELF 64-bit LSB executable, x86-64, statically linked
```

## 2. 部署前检查（只读）

```bash
ssh xiaoqi-lighthouse '
  systemctl list-units --type=service | grep -i new-api      # 确认 unit 名（待核实）
  ls -la /opt/new-api/current/
  sqlite3 "file:/opt/new-api/current/one-api.db?mode=ro" "select count(*) from logs;"
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/status
'
```

## 3. 部署（替换二进制 + 重启）

```bash
# 上传
scp dist/new-api-linux-amd64 xiaoqi-lighthouse:/tmp/new-api-new

ssh xiaoqi-lighthouse '
  set -e
  cd /opt/new-api/current
  cp new-api "new-api.old.$(date +%Y%m%d-%H%M%S)"     # 备份先于替换
  install -m 0755 /tmp/new-api-new ./new-api
  systemctl restart <unit-name>
  sleep 3
  systemctl is-active <unit-name>
  curl -s -o /dev/null -w "status=%{http_code}\n" http://127.0.0.1:3000/api/status
  curl -s -o /dev/null -w "observability=%{http_code}\n" http://127.0.0.1:3000/api/observability/summary
'
```

## 4. 验收

- [ ] `systemctl is-active` = active；`/api/status` = 200
- [ ] `/api/observability/summary` = 200（未带管理员 cookie 时 401 亦为正常鉴权表现）
- [ ] 浏览器打开三页，各核对**一个已知数字**（与 `sqlite3 -readonly` 手工查询一致）
- [ ] 既有页面（overview / models / logs / channel）回归正常
- [ ] 侧边栏「可观测性」分组显示正常

## 5. 回滚（约 3 秒）

```bash
ssh xiaoqi-lighthouse '
  cd /opt/new-api/current
  cp new-api.old.<时间戳> new-api      # 或 install -m0755
  systemctl restart <unit-name>
  sleep 3 && systemctl is-active <unit-name>
'
```

## 6. 与本次改造同时决定的事项（需单独授权）

- rc.39 → rc.40 的版本升级（基线对齐）
- `ERROR_LOG_ENABLED=true`（失败明细所需；需先备份 unit 文件留回滚点）
