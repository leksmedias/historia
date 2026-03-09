#!/bin/bash
set -e

# Historia — One-click install script
# Usage (from repo root): chmod +x install.sh && ./install.sh
# Usage (remote):         curl -fsSL https://raw.githubusercontent.com/YOUR_USER/historia/main/install.sh | bash -s -- <git-url>

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║          Historia — Installer                ║"
echo "║   Cinematic Historical Documentary Generator ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Prerequisites ──────────────────────────────────────────────────────────────

command -v node >/dev/null 2>&1 || {
  echo "❌  Node.js is required but not installed."
  echo "    Install it via nvm (recommended):"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo "    source ~/.bashrc && nvm install 20"
  exit 1
}

command -v npm >/dev/null 2>&1 || {
  echo "❌  npm is required but not installed. It usually ships with Node.js."
  exit 1
}

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "⚠️   Node.js 18+ is required (you have $(node -v))"
  echo "    Run: nvm install 20 && nvm use 20"
  exit 1
fi

echo "✅  Node.js $(node -v)"
echo "✅  npm $(npm -v)"
echo ""

# ── Clone or detect project directory ──────────────────────────────────────────

if [ -d ".git" ] && [ -f "package.json" ]; then
  echo "📂  Already in project directory — skipping clone"
else
  if [ -z "$1" ]; then
    echo "❌  Please provide a Git URL:"
    echo "    ./install.sh https://github.com/YOUR_USER/historia.git"
    exit 1
  fi
  echo "📂  Cloning Historia from $1 ..."
  git clone "$1" historia
  cd historia
fi

# ── Install Node dependencies ───────────────────────────────────────────────────

echo ""
echo "📦  Installing dependencies..."
npm install

# ── Environment setup ──────────────────────────────────────────────────────────

if [ ! -f ".env" ]; then
  echo ""
  echo "⚙️   Creating .env file..."
  cat > .env << 'EOF'
# PostgreSQL connection string — required
# Local example:  postgresql://postgres:password@localhost:5432/historia
# Replit/cloud:   copy the DATABASE_URL from your environment
DATABASE_URL=postgresql://user:password@localhost:5432/historia

# Optional: set these here OR configure them in the app's Settings page
# WHISK_COOKIE=<paste your labs.google session cookie here>
# INWORLD_API_KEY=<your inworld api key>
EOF
  echo "   ⚠️   Edit .env and set DATABASE_URL before continuing"
  echo ""
  echo "   To get DATABASE_URL:"
  echo "   • Local PostgreSQL: postgresql://postgres:<password>@localhost:5432/historia"
  echo "   • Replit: copy the DATABASE_URL environment variable from your Repl"
  echo ""
fi

# ── Database schema ─────────────────────────────────────────────────────────────

if grep -q "DATABASE_URL=postgresql://user:password" .env 2>/dev/null; then
  echo "⚠️   Skipping database setup — update DATABASE_URL in .env first, then run:"
  echo "    npm run db:push"
else
  echo ""
  echo "🗄️   Setting up database schema..."
  npm run db:push && echo "✅  Database schema ready" || {
    echo "⚠️   Database setup failed. Check DATABASE_URL in .env and run: npm run db:push"
  }
fi

# ── Done ────────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║           ✅  Install Complete!              ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env and set DATABASE_URL (if not done yet)"
echo "     Then run: npm run db:push"
echo ""
echo "  2. Start the server:"
echo "     npm run dev"
echo ""
echo "  3. Open http://localhost:5000"
echo ""
echo "  4. Go to Settings and configure your API keys:"
echo ""
echo "     • Groq API Key   → https://console.groq.com"
echo "       (for scene generation — free tier available)"
echo ""
echo "     • Whisk Cookie   → https://labs.google/fx/tools/whisk"
echo "       Sign in → DevTools → Application → Cookies → labs.google"
echo "       Copy ALL cookies and paste them as one string"
echo "       ⚠️  These expire every few days — see README troubleshooting"
echo ""
echo "     • Inworld API Key → https://inworld.ai/studio"
echo "       (for text-to-speech narration)"
echo ""
echo "  5. Click 'Test All Connections' to verify everything works"
echo ""
echo "  6. Create your first project! 🎬"
echo ""
echo "  Troubleshooting: see README.md → Troubleshooting section"
echo ""
