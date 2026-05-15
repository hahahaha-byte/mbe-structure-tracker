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

clear
echo "MBE Tracker"
echo "Project: $APP_DIR"
echo "URL:     $URL"
echo

if is_healthy; then
  echo "The local service is already running."
  echo "Opening the web page..."
  open "$URL"
  echo
  echo "You can close this window."
  read -r "?Press Enter to close."
  exit 0
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
