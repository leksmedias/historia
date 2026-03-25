#!/bin/bash
# Historia — server-side update script
# Run this on the VPS to pull latest code and restart the app.
set -e

APP_DIR="${APP_DIR:-/opt/historia}"
SERVICE="${SERVICE_NAME:-historia-3001}"

cd "$APP_DIR"

echo "▶ Preserving .env..."
# Back up .env before any git operations
cp .env /tmp/historia-env-backup 2>/dev/null || true

echo "▶ Pulling latest code..."
git fetch origin main
git reset --hard origin/main

echo "▶ Restoring .env..."
# Restore .env (not tracked in git — keeps DB password, API keys safe)
if [ -f /tmp/historia-env-backup ]; then
  cp /tmp/historia-env-backup .env
  echo "   .env restored"
else
  echo "   WARNING: no .env backup found — check your environment variables!"
fi

echo "▶ Installing dependencies..."
npm install --prefer-offline --silent

echo "▶ Building frontend..."
npm run build 2>&1 | tail -5

echo "▶ Restarting service $SERVICE..."
systemctl restart "$SERVICE"

sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  echo "✅ $SERVICE is running"
else
  echo "❌ Service failed — check: journalctl -u $SERVICE -n 30"
  exit 1
fi
