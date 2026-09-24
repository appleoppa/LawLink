#!/bin/zsh
# LawLink production supervisor: keep HTTP and cron in separate Node processes.
set -u

ENV_FILE="$HOME/Library/Application Support/PGG/LawLink/runtime/lawlink.env"
# 目录自定位：脚本放在哪个 release 里就运行哪个 release，切换版本只改宿主入口指向。
RELEASE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORAGE_ROOT="$HOME/PGG-WIKI/lawlink/storage"

if [[ ! -r "$ENV_FILE" ]]; then
  print -u2 "LawLink runtime environment file is unavailable"
  exit 78
fi
if [[ ! -d "$RELEASE_ROOT/.next-build" || ! -d "$RELEASE_ROOT/node_modules" ]]; then
  print -u2 "LawLink runtime release is incomplete"
  exit 78
fi

cd "$RELEASE_ROOT"
set -a
source "$ENV_FILE"
set +a
export NODE_ENV=production
export NEXT_DIST_DIR=.next-build
export APP_STORAGE_DIR="$STORAGE_ROOT"

cron_pid=""
app_pid=""

cleanup() {
  local exit_code=$?
  trap - INT TERM EXIT
  if [[ -n "$cron_pid" ]] && kill -0 "$cron_pid" 2>/dev/null; then
    kill -TERM "$cron_pid" 2>/dev/null || true
  fi
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  [[ -n "$cron_pid" ]] && wait "$cron_pid" 2>/dev/null || true
  [[ -n "$app_pid" ]] && wait "$app_pid" 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup INT TERM EXIT

"$RELEASE_ROOT/node_modules/.bin/tsx" "$RELEASE_ROOT/src/server/cron/standalone.ts" &
cron_pid=$!
# Web 进程必须关掉自己的 cron：v2.0.1 起 instrumentation 也会注册同一套作业，
# 而本脚本已经用独立进程跑调度。两边同时注册会让每个作业每次触发两遍
# （周报重复推送、备份双份、提醒重复扫描）。standalone.ts 不读这个开关。
DISABLE_CRON=1 "$HOME/.local/bin/npm" run start -- -p 3100 -H 0.0.0.0 &
app_pid=$!

print "[lawlink-supervisor] http_pid=$app_pid cron_pid=$cron_pid"

while true; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    print -u2 "[lawlink-supervisor] next-server exited; stopping cron worker"
    exit 1
  fi
  if ! kill -0 "$cron_pid" 2>/dev/null; then
    print -u2 "[lawlink-supervisor] cron worker exited; stopping next-server"
    exit 1
  fi
  sleep 2
done
