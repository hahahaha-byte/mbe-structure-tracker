#!/bin/zsh

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST="127.0.0.1"
PORT="8765"
URL="http://${HOST}:${PORT}"

cd "$APP_DIR"

is_healthy() {
  python3 - "$URL" <<'PY'
import sys
import urllib.request

try:
    with urllib.request.urlopen(sys.argv[1] + "/api/health", timeout=1) as response:
        raise SystemExit(0 if response.status == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
}

stop_existing_service() {
  local pids
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "Stopping existing service on port $PORT..."
  echo "$pids" | xargs kill 2>/dev/null || true

  for _ in {1..20}; do
    if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Old service stopped."
      return
    fi
    sleep 0.2
  done

  echo "Force stopping old service..."
  echo "$pids" | xargs kill -9 2>/dev/null || true
}

clear
echo "MBE Tracker"
echo "Project: $APP_DIR"
echo "URL:     $URL"
echo

if is_healthy; then
  echo "The local service is already running."
  echo "Restarting it so the latest code is used."
  stop_existing_service
  echo
fi

echo "Starting the local service..."
echo "Keep this Terminal window open while using the app."
echo "Close this window or press Ctrl+C here to stop the service."
echo

(sleep 1; open "$URL") &
python3 "$APP_DIR/server.py" serve --host "$HOST" --port "$PORT"

echo
echo "The local service has stopped."
read -r "?Press Enter to close."
