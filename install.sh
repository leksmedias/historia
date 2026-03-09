#!/bin/bash
set -e

# Historia — One-click VPS Installer
# Paste this single command on your server:
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/leksautomate/historia/main/install.sh)
#
# Tested on Ubuntu 22.04 / Debian 12

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ  $*${NC}"; }
ok()    { echo -e "${GREEN}✅ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $*${NC}"; }
die()   { echo -e "${RED}❌ $*${NC}"; exit 1; }

# Read from /dev/tty so prompts work when the script is piped through curl
ask() {
  local prompt="$1" default="$2" answer
  printf "${CYAN}%s${NC}" "$prompt" >/dev/tty
  read answer </dev/tty
  echo "${answer:-$default}"
}

GIT_URL="https://github.com/leksautomate/historia.git"
APP_DIR="/opt/historia"
DB_NAME="historia"
DB_USER="historia"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Historia — One-Click Installer             ║${NC}"
echo -e "${CYAN}║   Cinematic Historical Documentary Generator     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Port prompt ───────────────────────────────────────────────────────────────
APP_PORT=$(ask "Port to run Historia on [default: 3001]: " "3001")
SERVICE_NAME="historia-${APP_PORT}"

echo ""
info "Installing Historia on port ${APP_PORT} → ${APP_DIR}"
info "Systemd service: ${SERVICE_NAME}"
echo ""

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  die "Please run as root:  sudo bash <(curl -fsSL ...)"
fi

# ── 1. System packages ────────────────────────────────────────────────────────
info "Updating package list..."
apt-get update -qq

info "Installing prerequisites..."
apt-get install -y -qq curl git build-essential openssl ca-certificates

# ── 2. Node.js 20 ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  info "Installing Node.js 20..."
  export NVM_DIR="/root/.nvm"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
  nvm alias default 20
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

# Create DB user + database (idempotent)
info "Setting up database..."
PG_EXISTING=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" 2>/dev/null || true)

# Always generate a fresh password — ensures DATABASE_URL is always valid
DB_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)
DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

if [ -z "$PG_EXISTING" ]; then
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null
  ok "Database created: ${DB_NAME}  user: ${DB_USER}"
else
  # Reset password so DATABASE_URL is always valid (no stale placeholders)
  sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
  ok "Database password rotated"
fi

# ── 4. Clone / update app ─────────────────────────────────────────────────────
if [ -d "${APP_DIR}/.git" ]; then
  info "Updating existing install..."
  git -C "$APP_DIR" pull
else
  info "Cloning Historia..."
  git clone "$GIT_URL" "$APP_DIR"
fi

# ── 5. Environment file ───────────────────────────────────────────────────────
ENV_FILE="${APP_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
PORT=${APP_PORT}
DATABASE_URL=${DB_URL}

# Add your API keys below, or configure them inside the app → Settings
# GROQ_API_KEY=
# WHISK_COOKIE=
# INWORLD_API_KEY=
EOF
  ok ".env created"
else
  # Update PORT
  if grep -q "^PORT=" "$ENV_FILE"; then
    sed -i "s/^PORT=.*/PORT=${APP_PORT}/" "$ENV_FILE"
  else
    echo "PORT=${APP_PORT}" >> "$ENV_FILE"
  fi
  # Update DATABASE_URL only when we have a known-good value
  if [ -n "$DB_URL" ]; then
    if grep -q "^DATABASE_URL=" "$ENV_FILE"; then
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" "$ENV_FILE"
    else
      echo "DATABASE_URL=${DB_URL}" >> "$ENV_FILE"
    fi
  fi
  info ".env updated"
fi

# ── 6. Install deps & build ───────────────────────────────────────────────────
info "Installing npm dependencies..."
cd "$APP_DIR"
npm install --prefer-offline 2>&1 | tail -5

info "Building frontend..."
npm run build 2>&1 | tail -5

info "Syncing database schema..."
npm run db:push 2>&1 | tail -8

ok "Build complete"

# ── 7. Systemd service ────────────────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_BIN=$(which node)

cat > "$SERVICE_FILE" <<EOF
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
  warn "Service may have failed — check: journalctl -u ${SERVICE_NAME} -n 50"
fi

# ── Open firewall port (if ufw is active) ─────────────────────────────────────
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "${APP_PORT}" >/dev/null
  ok "Firewall: port ${APP_PORT} opened"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ✅  Historia is running!                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App URL:      ${CYAN}http://<your-server-ip>:${APP_PORT}${NC}"
echo -e "  Service:      ${CYAN}${SERVICE_NAME}${NC}"
echo -e "  Directory:    ${CYAN}${APP_DIR}${NC}"
echo ""
echo "  Useful commands:"
echo -e "    Logs:       ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "    Restart:    ${CYAN}systemctl restart ${SERVICE_NAME}${NC}"
echo -e "    Config:     ${CYAN}nano ${APP_DIR}/.env${NC}"
echo ""
echo "  After opening the app, go to Settings and add your API keys:"
echo "    • Groq API Key    → https://console.groq.com"
echo "    • Whisk Cookie    → https://labs.google/fx/tools/whisk"
echo "    • Inworld API Key → https://inworld.ai/studio"
echo ""
