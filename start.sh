#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load nvm if node isn't in PATH (systemd has a stripped environment)
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="/root/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
fi

NODE_BIN=$(command -v node)

# Start Gemini Python sidecar in background
"$APP_DIR/gemini-service/venv/bin/python" -m uvicorn main:app \
  --host 0.0.0.0 --port 3060 \
  --app-dir "$APP_DIR/gemini-service" &
GEMINI_PID=$!

# Kill sidecar when this script exits (systemd stop / crash)
trap "kill $GEMINI_PID 2>/dev/null; exit" EXIT INT TERM

# Start Node.js server in foreground — systemd tracks this process
cd "$APP_DIR"
exec "$NODE_BIN" --import tsx/esm server/index.ts
