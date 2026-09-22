#!/usr/bin/env bash
# 上游同步助手：fetch 上游 → 试合并 → 报告冲突与侵入点状态
# 用法：
#   bash observability/scripts/sync-upstream.sh           # 只探测，不改动工作区
#   bash observability/scripts/sync-upstream.sh --apply   # 冲突清理完成后正式合并提交
#
# 注意：所有变量插值统一使用 ${VAR} 花括号形式。
# 中文全角标点紧跟 $VAR 时，bash 在非 UTF-8 locale 下会把标点字节并入变量名，
# 触发 "unbound variable"。
set -euo pipefail

BRANCH="feat/observability"
TMP_BRANCH="sync-probe/upstream"
TOUCHPOINTS=("router/api-router.go" "web/src/hooks/use-sidebar-data.ts" "web/src/i18n/locales")

cd "$(git rev-parse --show-toplevel)"

restore() {
  git merge --abort 2>/dev/null || true
  git checkout -q "${BRANCH}" 2>/dev/null || true
  git branch -D "${TMP_BRANCH}" >/dev/null 2>&1 || true
}
trap restore EXIT

echo "==> 当前分支：$(git rev-parse --abbrev-ref HEAD)"
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "${BRANCH}" ]]; then
  echo "!! 请先切到 ${BRANCH}（当前非目标分支）" >&2
  trap - EXIT
  exit 1
fi

echo "==> fetch upstream"
git fetch --tags upstream

echo "==> 上游领先本分支的提交（最近 10 条）"
git log --oneline "${BRANCH}"..upstream/main | head -10 || true

if [[ "${1:-}" == "--apply" ]]; then
  trap - EXIT
  echo "==> 正式合并 upstream/main -> ${BRANCH}"
  git merge upstream/main --no-edit
  echo "==> 合并完成。请执行验证清单（见 observability/release/UPGRADE-MERGE.md 第 3 节）"
  exit 0
fi

echo "==> 试合并（临时分支 ${TMP_BRANCH}，不影响 ${BRANCH}）"
git checkout -q -b "${TMP_BRANCH}" "${BRANCH}"
if git merge --no-commit --no-ff upstream/main >/dev/null 2>&1; then
  echo "    OK 无冲突，可安全执行 --apply"
else
  echo "    NG 存在冲突，涉及文件："
  git diff --name-only --diff-filter=U | sed 's/^/      /'
fi

echo "==> 侵入点状态（上游是否改动过我们碰过的文件）"
for f in "${TOUCHPOINTS[@]}"; do
  n=$(git log --oneline "${BRANCH}"..upstream/main -- "${f}" | wc -l | tr -d ' ')
  printf "    %-42s 上游变更 %s 次\n" "${f}" "${n}"
done

echo "==> 探测结束，工作区已恢复（未做任何提交）"
