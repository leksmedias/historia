#!/bin/bash
set -e

# Historia — VPS Deployment Script
# Tested on Ubuntu 22.04 / Debian 12
# Usage: bash deploy.sh [--port PORT] [--dir DIR] [--git-url URL]
# Example: bash deploy.sh --port 3001 --git-url https://github.com/user/historia.git

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ  $*${NC}"; }
ok()    { echo -e "${GREEN}✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()   { echo -e "${RED}❌ $*${NC}"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Historia — VPS Deployment Script           ║${NC}"
echo -e "${CYAN}║   Cinematic Historical Documentary Generator     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Parse arguments ────────────────────────────────────────────────────────────
APP_PORT=""
APP_DIR=""
GIT_URL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)    APP_PORT="$2"; shift 2 ;;
    --dir)     APP_DIR="$2";  shift 2 ;;
    --git-url) GIT_URL="$2";  shift 2 ;;
    *) shift ;;
  esac
done

# ── Interactive prompts ────────────────────────────────────────────────────────

if [ -z "$APP_PORT" ]; then
  read -p "$(echo -e ${CYAN}"Port to run Historia on [default: 3001]: "${NC})" APP_PORT
  APP_PORT="${APP_PORT:-3001}"
fi

if [ -z "$APP_DIR" ]; then
  read -p "$(echo -e ${CYAN}"Install directory [default: /opt/historia]: "${NC})" APP_DIR
  APP_DIR="${APP_DIR:-/opt/historia}"
fi

if [ -z "$GIT_URL" ] && [ ! -f "$APP_DIR/package.json" ]; then
  read -p "$(echo -e ${CYAN}"Git URL for Historia repo: "${NC})" GIT_URL
fi

DB_NAME="historia"
DB_USER="historia"
DB_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)
SERVICE_NAME="historia-${APP_PORT}"

echo ""
info "Deploying Historia on port ${APP_PORT} → ${APP_DIR}"
info "Systemd service name: ${SERVICE_NAME}"
echo ""

# ── Root check ─────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  warn "Not running as root. Some steps (apt, systemd) may fail."
  warn "Run with: sudo bash deploy.sh"
  echo ""
fi

# ── 1. System packages ─────────────────────────────────────────────────────────
info "Updating apt..."
apt-get update -qq

info "Installing prerequisites..."
apt-get install -y -qq curl git build-essential openssl

# ── 2. Node.js via NVM ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  info "Installing Node.js 20 via nvm..."
  export NVM_DIR="/root/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
  # Make node/npm available system-wide
  ln -sf "$NVM_DIR/versions/node/$(nvm current)/bin/node" /usr/local/bin/node
  ln -sf "$NVM_DIR/versions/node/$(nvm current)/bin/npm"  /usr/local/bin/npm
  ln -sf "$NVM_DIR/versions/node/$(nvm current)/bin/npx"  /usr/local/bin/npx
fi
ok "Node.js $(node -v)"

# ── 3. PostgreSQL ─────────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
  info "Installing PostgreSQL..."
  apt-get install -y -qq postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi
ok "PostgreSQL $(psql --version | awk '{print $3}')"

# Create database user and database (idempotent)
info "Setting up database '${DB_NAME}'..."
PG_EXISTING=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null || echo "")

if [ -z "$PG_EXISTING" ]; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null
  ok "Database created: ${DB_NAME} / user: ${DB_USER}"
  DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
else
  warn "User '${DB_USER}' already exists — skipping DB creation"
  warn "If this is a fresh install, manually set DATABASE_URL in ${APP_DIR}/.env"
  DB_URL="postgresql://${DB_USER}:<EXISTING_PASSWORD>@localhost:5432/${DB_NAME}"
fi

# ── 4. Clone or update app ─────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  info "Pulling latest code in ${APP_DIR}..."
  git -C "$APP_DIR" pull
elif [ -n "$GIT_URL" ]; then
  info "Cloning ${GIT_URL} → ${APP_DIR}..."
  git clone "$GIT_URL" "$APP_DIR"
elif [ -d "$(pwd)/.git" ] && [ -f "$(pwd)/package.json" ]; then
  info "Copying current directory to ${APP_DIR}..."
  mkdir -p "$APP_DIR"
  cp -r . "$APP_DIR/"
else
  die "No git URL provided and no existing repo at ${APP_DIR}. Provide --git-url."
fi

# ── 5. Environment file ────────────────────────────────────────────────────────
ENV_FILE="${APP_DIR}/.env"
if [ ! -f "$ENV_FILE" ]; then
  info "Creating ${ENV_FILE}..."
  cat > "$ENV_FILE" << EOF
PORT=${APP_PORT}
DATABASE_URL=${DB_URL}

# Configure these in the app's Settings page after first launch,
# or set them here as environment variables:
# WHISK_COOKIE=<your labs.google cookie>
# INWORLD_API_KEY=<your inworld api key>
EOF
  ok ".env created"
else
  warn ".env already exists — updating PORT only"
  sed -i "s/^PORT=.*/PORT=${APP_PORT}/" "$ENV_FILE" || echo "PORT=${APP_PORT}" >> "$ENV_FILE"
fi

# ── 6. Install dependencies & build ───────────────────────────────────────────
info "Installing npm dependencies..."
cd "$APP_DIR"
npm install --prefer-offline 2>&1 | tail -5

info "Building frontend..."
npm run build 2>&1 | tail -5

info "Syncing database schema..."
npm run db:push 2>&1 | tail -10

ok "Build complete"

# ── 7. Systemd service ────────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
info "Creating systemd service: ${SERVICE_NAME}..."

NODE_BIN=$(which node)
NPX_BIN=$(which npx)

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Historia Documentary Generator (port ${APP_PORT})
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE_BIN} --import tsx/esm ${APP_DIR}/server/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  ok "Service '${SERVICE_NAME}' is running"
else
  warn "Service may have failed — check: journalctl -u ${SERVICE_NAME} -n 30"
fi

# ── 8. Summary ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ✅  Deployment Complete!                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App directory:   ${CYAN}${APP_DIR}${NC}"
echo -e "  Running on:      ${CYAN}http://<your-server-ip>:${APP_PORT}${NC}"
echo -e "  Service name:    ${CYAN}${SERVICE_NAME}${NC}"
echo -e "  Database:        ${CYAN}postgresql://localhost:5432/${DB_NAME}${NC}"
echo ""
echo "  Useful commands:"
echo -e "    View logs:     ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "    Restart:       ${CYAN}systemctl restart ${SERVICE_NAME}${NC}"
echo -e "    Stop:          ${CYAN}systemctl stop ${SERVICE_NAME}${NC}"
echo -e "    Edit config:   ${CYAN}nano ${APP_DIR}/.env${NC}"
echo ""
echo "  After opening the app:"
echo "    → Go to Settings and add your API keys:"
echo "      • Groq API Key   (https://console.groq.com)"
echo "      • Whisk Cookie   (https://labs.google/fx/tools/whisk)"
echo "      • Inworld API Key (https://inworld.ai/studio)"
echo ""

# ── 9. Nginx config hint ───────────────────────────────────────────────────────
echo -e "${YELLOW}  Optional — Nginx reverse proxy config:${NC}"
echo "  Add this to your Nginx site config:"
echo ""
cat << NGINX
  location /historia/ {
      proxy_pass         http://127.0.0.1:${APP_PORT}/;
      proxy_http_version 1.1;
      proxy_set_header   Upgrade \$http_upgrade;
      proxy_set_header   Connection 'upgrade';
      proxy_set_header   Host \$host;
      proxy_cache_bypass \$http_upgrade;
      client_max_body_size 50M;
  }
NGINX
echo ""
echo -e "  Or as a standalone domain:"
echo ""
cat << NGINX
  server {
      listen 80;
      server_name your-domain.com;

      location / {
          proxy_pass         http://127.0.0.1:${APP_PORT};
          proxy_http_version 1.1;
          proxy_set_header   Upgrade \$http_upgrade;
          proxy_set_header   Connection 'upgrade';
          proxy_set_header   Host \$host;
          proxy_cache_bypass \$http_upgrade;
          client_max_body_size 50M;
      }
  }
NGINX
echo ""
