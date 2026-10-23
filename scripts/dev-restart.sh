#!/bin/bash
# Restart the dev stack in the order PGlite needs.
#
# PGlite serves ONE connection at a time and does not always release it when a
# client is killed mid-session: the port stays open while every connect is
# refused, and the API then dies at boot with "Can't reach database server".
# The cure is to stop the client FIRST, let the socket close, and clear the
# stale lock before starting the server again.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="${LOG_DIR:-$ROOT/.devlogs}"
mkdir -p "$LOGS"

say() { printf '  %-28s %s\n' "$1" "$2"; }

# 1. API first, so PGlite sees a clean disconnect.
if PID=$(lsof -ti TCP:3001 -sTCP:LISTEN 2>/dev/null); then
  kill "$PID" 2>/dev/null; sleep 2
  kill -9 "$PID" 2>/dev/null
  say "api" "stopped"
fi

# 2. Then the database.
if PID=$(lsof -ti TCP:5432 -sTCP:LISTEN 2>/dev/null); then
  kill "$PID" 2>/dev/null; sleep 2
  kill -9 "$PID" 2>/dev/null
  say "pglite" "stopped"
fi

# A lock left by a killed process blocks the next start.
[ -f "$ROOT/.pgdata/postmaster.pid" ] && rm -f "$ROOT/.pgdata/postmaster.pid" && say "stale lock" "cleared"

cd "$ROOT"
nohup node scripts/pglite-server.mjs --port 5432 --dir ./.pgdata > "$LOGS/pglite.log" 2>&1 &
for _ in $(seq 1 20); do
  sleep 1
  grep -q "listening" "$LOGS/pglite.log" 2>/dev/null && break
done
say "pglite" "$(grep -q listening "$LOGS/pglite.log" && echo 'up on 5432' || echo 'FAILED - see .devlogs/pglite.log')"

cd "$ROOT/apps/api"
nohup node --enable-source-maps dist/src/main > "$LOGS/api.log" 2>&1 &
for _ in $(seq 1 25); do
  sleep 1
  curl -fsS -m 2 localhost:3001/api/health >/dev/null 2>&1 && break
done
if curl -fsS -m 3 localhost:3001/api/health >/dev/null 2>&1; then
  say "api" "up on 3001"
else
  say "api" "FAILED - see .devlogs/api.log"
  tail -5 "$LOGS/api.log" | sed 's/\x1b\[[0-9;]*m//g'
  exit 1
fi

curl -fsS -m 3 -o /dev/null localhost:3000/ 2>/dev/null && say "web" "up on 3000" || say "web" "not running (pnpm dev)"
