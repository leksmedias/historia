# Historia Deployment Guide

A comprehensive, step-by-step guide to deploying **Historia — Cinematic Historical Documentary Generator** to a production server (Ubuntu 22.04 LTS / Debian 12 VPS).

---

## Table of Contents
1. [Architecture & Workflow](#1-architecture--workflow)
2. [Server Prerequisites](#2-server-prerequisites)
3. [Automated Installation (Recommended)](#3-automated-installation-recommended)
4. [Manual Installation (Step-by-Step)](#4-manual-installation-step-by-step)
5. [Google Cloud Platform & Vertex AI Setup](#5-google-cloud-platform--vertex-ai-setup)
6. [Environment Variables (`.env`)](#6-environment-variables-env)
7. [Systemd Service Management](#7-systemd-service-management)
8. [Nginx Reverse Proxy & SSL Setup](#8-nginx-reverse-proxy--ssl-setup)
9. [In-App Configuration (Settings Page)](#9-in-app-configuration-settings-page)
10. [Updating an Existing Installation](#10-updating-an-existing-installation)
11. [Troubleshooting & Maintenance](#11-troubleshooting--maintenance)

---

## 1. Architecture & Workflow

Historia consists of three main components:
- **React Frontend (Vite):** A single-page application served statically from the backend.
- **Express Backend (Node.js):** Orchestrates API routes, manages database interactions, coordinates AI pipelines, and generates video clips locally using the **FFmpeg CLI**.
- **PostgreSQL Database:** Stores information about projects, scenes, and asset generation statuses.
- **GCP Integration (Vertex AI):** Generates cinematic images (via Imagen 4) and video animations (via Veo 3.1 Lite) using the Google Cloud SDK for authorization.

```
┌────────────────────────────────────────────────────────┐
│                     Client Browser                     │
└───────────┬────────────────────────────────────────────┘
            │ HTTPS (API requests & Web UI)
┌───────────▼────────────────────────────────────────────┐
│                    Nginx Reverse Proxy                 │
└───────────┬────────────────────────────────────────────┘
            │ Proxy Pass (Port 3001)
┌───────────▼────────────────────────────────────────────┐
│                  Express Node.js Server                │
└───────────┬──────────────────────┬─────────────┬───────┘
            │ Local CLI calls      │ SQL Queries │ REST
┌───────────▼────────────┐  ┌──────▼─────┐  ┌────▼───────┐
│       FFmpeg CLI       │  │ PostgreSQL │  │ Vertex AI  │
│ (Clip Generation/Merge)│  │  Database  │  │ (GCP Cloud)│
└────────────────────────┘  └────────────┘  └────────────┘
```

### Asset generation modes

- **Images** are always generated client-side via `/api/gemini-proxy` (Vertex AI Imagen). The browser drives image generation.
- **Audio (TTS)** is generated server-side when `INWORLD_API_KEY` is set and the project's `ttsProvider` is `inworld`. Otherwise the browser drives it.
- **Video clips** are generated server-side by FFmpeg (Ken Burns effect) and merged into a final `output.mp4`.
- **Render jobs** (`clipJobs`, `mergeJobs`, `animateJobs`, `autoJobs`) are stored **in-memory** — they do not survive server restarts.

---

## 2. Server Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | Ubuntu 22.04 LTS / Debian 12 | Same |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Storage | 20 GB SSD | 50 GB SSD |
| DNS | Domain/subdomain pointing to VPS IP | Same |
| Ports open | 80, 443, 3001 | Same |

---

## 3. Automated Installation (Recommended)

Historia features a one-click automated installer that sets up Node.js 20, PostgreSQL, generates secure database credentials, runs Drizzle database sync, builds the frontend, and installs a systemd daemon.

Run the following command on your server as the `root` user:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/leksmedias/historia/main/install.sh)
```

### What the script does:
1. **Prompts for custom port** — defaults to `3001`.
2. **Installs system packages** — `curl`, `git`, `build-essential`, `openssl`, `ca-certificates`, `python3`, `ffmpeg`.
3. **Installs Node.js 20** — via NodeSource.
4. **Installs & configures PostgreSQL** — generates a random strong password, creates the `historia` user and database.
5. **Clones the app repository** — to `/opt/historia`.
6. **Configures environment** — creates `/opt/historia/.env`.
7. **Compiles assets & syncs DB** — runs `npm install`, `npm run build`, and `npm run db:push`.
8. **Installs systemd service** — creates `historia-<port>.service` with auto-restart.
9. **Opens firewall** — configures `ufw`.

---

## 4. Manual Installation (Step-by-Step)

### Step 4.1: Install Node.js & System Dependencies
```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential ffmpeg openssl python3 python3-venv

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node --version   # must be >= 20
ffmpeg -version  # confirm FFmpeg is available
```

### Step 4.2: Install and Set Up PostgreSQL
```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Replace 'YourSecurePasswordHere' with a strong password
sudo -u postgres psql -c "CREATE USER historia WITH PASSWORD 'YourSecurePasswordHere';"
sudo -u postgres psql -c "CREATE DATABASE historia OWNER historia;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE historia TO historia;"
```

### Step 4.3: Clone the Application & Install Node Dependencies
```bash
sudo git clone https://github.com/leksmedias/historia.git /opt/historia
cd /opt/historia
sudo chown -R $USER:$USER /opt/historia
npm install
```

### Step 4.4: Configure Environment, Sync DB, and Build Frontend
Create your `.env` file first (see [Section 6](#6-environment-variables-env)), then run:

```bash
npm run db:push   # push schema to PostgreSQL
npm run build     # compile React frontend into dist/
```

---

## 5. Google Cloud Platform & Vertex AI Setup

Historia uses Google Vertex AI — Imagen 4 for images and Veo 3.1 for video animation. The host server must be authorized to call GCP APIs.

### Prerequisites: Enable APIs in GCP
1. Go to [Google Cloud Console](https://console.cloud.google.com/) and note your **Project ID**.
2. Go to **APIs & Services → Library** and enable:
   - **Vertex AI API** (`aiplatform.googleapis.com`)
   - **Cloud Storage API** (`storage-api.googleapis.com`) — required to download Veo output

### IAM Roles Required

| Role | Purpose |
|------|---------|
| `roles/aiplatform.user` | Submit Imagen 4 and Veo predictions |
| `roles/storage.objectViewer` | Download Veo-generated clips from GCS |

### Regions

| Service | Region |
|---------|--------|
| Imagen 4 | `europe-west4` (default) or any Imagen-supported region |
| Veo | **`us-central1` only** — do not change |

---

### Option A: Service Account JSON Key (Production — Recommended)

A service account does not expire and does not require browser interaction.

1. Go to **IAM & Admin → Service Accounts → Create Service Account**.
2. Name it (e.g., `historia-vps`) and click **Create and Continue**.
3. Grant these roles: `Vertex AI User`, `Storage Object Viewer`.
4. Open the service account → **Keys** tab → **Add Key → Create new key → JSON**.
5. Download the JSON file and upload it to `/opt/historia/gcp-key.json` on your server.
6. Secure the key:
   ```bash
   chmod 600 /opt/historia/gcp-key.json
   ```
7. Add to `.env`:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS=/opt/historia/gcp-key.json
   ```

---

### Option B: Google Cloud SDK (CLI Auth — Development/Staging)

```bash
# Install gcloud CLI
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install google-cloud-cli -y
```

Authenticate using `--no-launch-browser` — this prints a URL you open in any browser, sign in, and paste the code back into the server terminal:

```bash
gcloud auth login --no-launch-browser
# Opens a URL → sign in with your Google account → paste the code shown back here

gcloud auth application-default login --no-launch-browser
# Repeat the same process for Application Default Credentials

gcloud config set project YOUR_GCP_PROJECT_ID
```

Test that it worked:

```bash
gcloud auth print-access-token   # should print a long token string
```

> The server calls `gcloud auth print-access-token` at runtime for every Imagen/Veo request. The OS user running the Node process must be authenticated.

---

## 6. Environment Variables (`.env`)

Create `/opt/historia/.env`:

```env
# ── Server ─────────────────────────────────────────────────────────────────────
PORT=3001

# JWT secret for admin session cookies — generate with:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your_64_byte_hex_secret_here

# ── PostgreSQL ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://historia:YourSecurePasswordHere@localhost:5432/historia

# ── Vertex AI — Imagen ─────────────────────────────────────────────────────────
VERTEX_PROJECT_ID=your-gcp-project-id
VERTEX_LOCATION_ID=europe-west4                  # Imagen region
VERTEX_MODEL_ID=imagen-4.0-fast-generate-001     # default image model

# ── Vertex AI — Veo ────────────────────────────────────────────────────────────
# Veo is us-central1 ONLY — do not change VEO_LOCATION_ID
VEO_LOCATION_ID=us-central1
VEO_MODEL_ID=veo-3.1-lite-generate-001

# ── GCP Service Account (Option A) ─────────────────────────────────────────────
GOOGLE_APPLICATION_CREDENTIALS=/opt/historia/gcp-key.json

# ── Optional: TTS (can also be set in-app via Settings page) ───────────────────
INWORLD_API_KEY=your_inworld_key

# ── Optional: LLM keys (can also be passed per-request from the browser) ────────
ANTHROPIC_API_KEY=your_anthropic_key
GROQ_API_KEY=your_groq_key

# ── Performance ────────────────────────────────────────────────────────────────
CLIP_CONCURRENCY=3   # parallel FFmpeg workers for clip generation (default: 3)
```

> **Note on API keys:** Groq, Inworld, and Anthropic keys can alternatively be entered directly in the app's **Settings** page and are stored in the browser's `localStorage`. The `.env` values serve as server-side fallbacks for the proxy routes.

---

## 7. Systemd Service Management

Running the app under a systemd daemon ensures it starts automatically on boot and restarts after crashes.

1. Create the service file:
   ```bash
   sudo nano /etc/systemd/system/historia.service
   ```
2. Paste this configuration (verify the Node.js path with `which node`):
   ```ini
   [Unit]
   Description=Historia Cinematic Documentary Generator (Port 3001)
   After=network.target postgresql.service

   [Service]
   Type=simple
   User=root
   WorkingDirectory=/opt/historia
   EnvironmentFile=/opt/historia/.env
   ExecStart=/usr/bin/node --import tsx/esm /opt/historia/server/index.ts
   Restart=on-failure
   RestartSec=5
   StandardOutput=journal
   StandardError=journal
   SyslogIdentifier=historia-3001

   [Install]
   WantedBy=multi-user.target
   ```
3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable historia
   sudo systemctl start historia
   ```

### Management Commands

```bash
sudo journalctl -u historia -f      # live logs
sudo systemctl status historia      # current status
sudo systemctl restart historia     # restart
sudo systemctl stop historia        # stop
```

---

## 8. Nginx Reverse Proxy & SSL Setup

### Step 8.1: Install Nginx
```bash
sudo apt-get install -y nginx
```

### Step 8.2: Configure Virtual Host

Create `/etc/nginx/sites-available/historia`:

```nginx
server {
    listen 80;
    server_name historia.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name historia.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/historia.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/historia.yourdomain.com/privkey.pem;

    # Increase for large uploads (style reference images, audio)
    client_max_body_size 100M;

    # Long timeouts — FFmpeg renders can take several minutes
    proxy_read_timeout    600s;
    proxy_connect_timeout 60s;
    proxy_send_timeout    600s;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/historia /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default   # remove default welcome page
sudo nginx -t                               # validate config
sudo systemctl restart nginx
```

### Step 8.3: SSL with Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d historia.yourdomain.com
```

Certbot rewrites the Nginx config and sets up automatic renewal.

---

## 9. In-App Configuration (Settings Page)

**First-time setup:** On the very first visit to the app, you will see a setup screen to create your admin username and password. This can only be done once — the setup screen disappears permanently after account creation. Every subsequent visit requires login. Sessions last 30 days.

After logging in, go to **Settings** to configure:

| Setting | Description |
|---------|-------------|
| Groq API Key | LLM for scene splitting and image prompt generation (default provider) |
| Inworld API Key | Server-side TTS audio generation |
| Anthropic API Key | Use Claude as the text provider |
| Text Provider | `groq` (default, batch 10), `claude` (batch 5), or `inworld` (batch 15) |
| Image Model | `imagen-4.0-fast-generate-001` (default), `-generate-001`, `-ultra`, `gemini-2.5-flash-image`, or `gemini-3.1-flash-image-preview` |
| Visual Theme | `impasto` (digital oil painting) or `ww2` (B&W archival photorealism) |
| Skip Image Generation | Bypass Imagen calls entirely — useful for testing script/audio flows |

---

## 10. Updating an Existing Installation

```bash
cd /opt/historia
git pull origin main
npm install          # only if package.json changed
npm run db:push      # only if shared/schema.ts changed
npm run build        # always — rebuilds the React frontend
sudo systemctl restart historia
```

Or use the bundled update script:

```bash
sudo bash /opt/historia/scripts/update.sh
```

---

## 11. Troubleshooting & Maintenance

### A. Vertex AI Authentication Failures

**Error:** `Vertex AI auth failed — run: gcloud auth login`

1. Re-run: `gcloud auth application-default login --no-browser`
2. If using a service account key, verify `GOOGLE_APPLICATION_CREDENTIALS` in `.env` points to the correct path and the file is readable by the server process.
3. Confirm the service account has `roles/aiplatform.user` and `roles/storage.objectViewer`.

---

### B. Imagen 4 Rate Limit Errors (429)

**Cause:** Default testing quotas for Vertex AI Imagen 4 are **1 request per minute** — too low for documentary generation (20–60 images per project).

**Resolution:** Request a quota increase from Google Cloud Console → **Support** → **Create Case**. Use this template:

> **Subject:** Quota Increase Request — Vertex AI Imagen 4 for SaaS Platform (Testing Phase)
>
> Hi Google Cloud Team,
>
> I'm reaching out to request a quota increase for Vertex AI Imagen 4 (`imagen-4.0-fast-generate-001`) on our project in the `europe-west4` region.
>
> **About our product:**
> We are building **Historia**, an AI-powered cinematic documentary generation platform. The platform transforms historical scripts into full documentary videos (generated images, voice narration, video export).
>
> **Current situation:**
> We are onboarding our first users. Each user session generates 20–60 images per project. Our current quota of **1 request per minute** creates significant bottlenecks, rendering the platform unusable even at small scale.
>
> **What we need:**
> We request an increase to **60 requests per minute** to support concurrent users during testing.
>
> **Project details:**
> - Project ID: `[YOUR_PROJECT_ID]`
> - Region: `europe-west4`
> - Model: `imagen-4.0-fast-generate-001`
> - Current quota: 1 request/minute
> - Requested quota: 60 requests/minute

---

### C. FFmpeg Not Found

```bash
which ffmpeg          # must return a path
sudo apt-get install -y ffmpeg
ffmpeg -version
```

The OS user running Node must have `ffmpeg` on their `PATH`.

---

### D. PostgreSQL Connection Errors

```bash
sudo systemctl status postgresql
sudo systemctl start postgresql

# Test connection directly
psql $DATABASE_URL
```

---

### E. File Permission Errors (`uploads/` directory)

```bash
sudo chown -R root:root /opt/historia   # replace root:root with your service user
sudo chmod -R 755 /opt/historia/uploads
```

The `uploads/` directory is **not in git** and must be preserved manually across server migrations.

---

### F. Images Showing as `.svg` Placeholders

Mock SVG placeholders in `uploads/{projectId}/images/` are never usable for rendering. Reset them so real images can be generated:

```
POST /api/projects/{id}/fix-mocks
```

This sets their status to `failed` so the pipeline regenerates them.

---

### G. Render Jobs Lost After Restart

Render jobs are stored in-memory only. After a server restart, re-trigger any in-progress render from the app's UI — the source assets (images, audio) on disk are preserved.
