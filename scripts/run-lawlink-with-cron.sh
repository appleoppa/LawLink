#!/bin/zsh
# LawLink production supervisor: keep HTTP and cron in separate Node processes.
set -u

ENV_FILE="$HOME/Library/Application Support/PGG/LawLink/runtime/lawlink.env"
RELEASE_ROOT="$HOME/PGG-WIKI/lawlink/runtime/releases/lawlink-nine-closure-20260723-100000"
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
"$HOME/.local/bin/npm" run start -- -p 3100 -H 0.0.0.0 &
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
