# Historia — Cinematic Historical Documentary Generator

A self-hosted web application that transforms historical scripts into cinematic documentary-style videos — AI-generated images via Gemini, professional narration via Inworld TTS, Ken Burns animated clips, and optional Gemini image-to-video scenes.

## Quick Start

```bash
git clone https://github.com/leksmedias/historia.git
cd historia
npm run setup   # installs Node deps + creates Python venv + installs Python deps
npm run dev     # builds frontend, starts Express server + Gemini Python sidecar
```

**Requirements:** Node.js 18+, Python 3.10+, PostgreSQL

## Quick Install (VPS — one command)

Paste this on any Ubuntu 22.04 / Debian 12 server as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/leksmedias/historia/main/install.sh)
```

You'll be asked for a port (default: `3001`). Everything else is fully automated.

## Updating an Existing Install

SSH into your VPS and run:

```bash
cd /opt/historia
git pull
npm run setup
npm run build
systemctl restart historia-3001   # replace 3001 with your port
```

Check it's running:

```bash
journalctl -u historia-3001 -n 30
```

## Overview

Historia automates the production pipeline for historical documentary content:

1. **Write a script** — paste your historical narrative
2. **Upload style references** — provide 2 reference images to guide the visual style
3. **Choose voice & split mode** — select a narration voice and how the script is divided into scenes
4. **AI generates scenes** — Groq (openai/gpt-oss-120b) splits your script into visual scenes with cinematic image prompts (long scripts are batched progressively — you're redirected as soon as the first batch is ready)
5. **Image generation** — Gemini creates historically-accurate images (or a text style prompt — no reference images required)
6. **Voice narration** — Inworld AI generates professional text-to-speech audio per scene (up to 3 auto-retries on failure)
7. **Video clip generation** — each scene becomes an MP4 clip, exactly synced to its narration length; still images get a Ken Burns pan/zoom effect, or you can animate any scene with Gemini image-to-video
8. **Export** — download individual clips as ZIP, download animated scenes only, or merge everything into a single documentary MP4
9. **Preview & refine** — use the built-in cinematic player to review, edit prompts, and regenerate assets

## Features

### Project Creation
- **Voice selection** — choose from 16 built-in Inworld narration voices (8 male / 8 female), or add custom voices in Settings
- **Script split modes** — three modes to control scene density:
  - **Smart** — randomly groups 2–3 sentences per scene
  - **Exact** — one sentence per scene
  - **Duration** — groups sentences by speaking time (2.5 words/sec × scene duration), adapts to sentence length automatically
- **Dual style references** — upload 2 images to anchor the visual tone across all generated scenes
- **Style Prompt mode** — instead of reference images, paste a text style prompt (e.g. "19th-century oil painting, muted earth tones, dramatic chiaroscuro…") to guide all scene images without uploading any files
- **Progressive batching** — long scripts are split into batches of 30; the project is created after the first batch so you're redirected immediately while remaining batches process in the background

### Scene Pipeline
- **Code-based scene splitting** — script is split in code (no AI), then sent to Groq in batches for image prompt generation only — eliminates token limit issues
- **Cinematic image prompts** — generates detailed prompts with historical accuracy, anonymous figures, and documentary framing
- **Fallback prompts** — 3 progressive fallbacks per scene if primary prompt fails
- **Auto-retry audio** — Inworld TTS retries up to 3 times per scene (2s → 4s backoff) before marking as failed
- **Bulk retry** — one-click retry for all failed assets; dedicated **Retry Failed Audio** button for audio-only failures
- **Background image generation** — "Generate All Missing Images" runs server-side; navigate away and generation continues uninterrupted; live progress polling updates every 3 seconds

### Video Export Pipeline
- **Two-phase render** — Phase 1 generates individual scene clips (stored in `clips/`); Phase 2 merges them into one video or you download as ZIP — independently
- **Ken Burns effects** — six animated effects (zoom-in, zoom-out, pan-right, pan-left, pan-up, pan-down) applied to still images; effects rotate so no two consecutive scenes repeat
- **Per-scene Gemini animation** — click the video icon on any timeline thumbnail (or use the sidebar button) to mark a scene for Gemini image-to-video animation; click "Animate X with Gemini" to generate
- **Audio mixing** — narration at full volume; if Gemini generates ambient audio it is mixed at 10% underneath
- **Loop to fill** — Gemini video clips (~8s) are looped seamlessly to match the narration duration of each scene
- **Download options** — all clips as ZIP, animated-scenes-only ZIP, or full merged documentary MP4
- **Resolution** — 480p or 720p selectable before rendering

### Scene Preview Player
- **Full-screen image viewer** with subtitle overlay showing script text
- **Audio playback controls** — play/pause, seek, volume, auto-advance to next scene
- **Horizontal timeline** — scrollable scene thumbnails with duration badges
- **Prompt editing sidebar** — edit image prompts, regenerate via AI, or regenerate images directly

### Scene Management
- **Inline editing** — edit script text and image prompts directly on scene cards
- **Scene splitting** — split scenes at sentence boundaries for finer control
- **Per-scene voice** — override the default voice for individual scenes
- **Image & audio regeneration** — regenerate individual assets with updated prompts

### Failed Scene Recovery
- **"N Failed" button** — appears in the preview toolbar when any scenes have failed images or audio
- **Images panel** — checkboxes to select individual failed image scenes; "All" shortcut; "Regen Images" regenerates in sequence
- **Audio panel** — same for failed audio scenes
- **Auto mock cleanup** — on project load, any legacy SVG placeholder files are detected, deleted, and the scene is reset to `failed` so it can be regenerated with a real provider

### Settings & Health Checks
- **Render API health check** — shown at the top of Settings; "Test Connection" verifies the FFmpeg VPS is reachable
- **API connection testing** — test each provider (Groq, Gemini, Inworld) with one click
- **Green/red status indicators** — instant visual feedback with detailed error messages
- **Custom voice management** — add/remove custom Inworld voice IDs
- **"Test All Connections"** button for quick verification of your entire setup
- **No mock providers** — mock image/audio generation has been removed; misconfigured providers fail with a clear error message

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Backend | Express.js (Node.js) + FastAPI Python sidecar |
| Database | PostgreSQL (via Drizzle ORM) |
| AI — Script | Groq API (openai/gpt-oss-120b, 131k context) |
| AI — Images | Gemini (via `gemini_webapi` Python sidecar) |
| AI — Video | Gemini image-to-video (via `gemini_webapi` Python sidecar) |
| AI — TTS | Inworld AI (TTS 1.5 Max, 100 RPS) |
| Video | FFmpeg — Ken Burns (`scale+crop+t`), loudnorm, xfade |

## Setup

### Prerequisites
- Node.js 18+ ([install via nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
- Python 3.10+
- PostgreSQL database

### VPS Installation (Ubuntu / Debian — recommended)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/leksmedias/historia/main/install.sh)
```

What the script does automatically:
- Installs **Node.js 20** via nvm (if not installed)
- Installs **PostgreSQL** (if not installed)
- Creates a database user and database named `historia` with a secure auto-generated password
- Writes a `.env` with `PORT` and `DATABASE_URL`
- Runs `npm run setup`, `npm run build`, and `npm run db:push`
- Creates and starts a **systemd service** (`historia-<port>`) so it survives reboots
- Opens the port in UFW firewall if active

### Updating on VPS

```bash
cd /opt/historia
git pull
npm run setup
npm run build
systemctl restart historia-3001   # replace 3001 with your port
```

### Manual Local Installation

```bash
git clone https://github.com/leksmedias/historia.git
cd historia
npm run setup          # installs Node deps + Python venv + Python deps
# Create .env with your DATABASE_URL (see Environment Variables below)
npm run db:push
npm run dev            # starts Express + Gemini sidecar
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:yourpassword@localhost:5432/historia

# VPS external services
RENDER_API_URL=http://5.189.146.143:9000
RENDER_API_KEY=alliswell
SERVER_URL=http://5.189.146.143:3001   # public URL of this server

# Gemini Python sidecar (default: http://localhost:3060)
GEMINI_SERVICE_URL=http://localhost:3060

# Optional — can also be configured in the app's Settings page
INWORLD_API_KEY=<your inworld api key>
```

> Groq API key and Gemini cookies are always set via the Settings page (stored in localStorage).

### API Keys Configuration

Open the app → navigate to **Settings** → configure:

| Key | Where to get it | Used for |
|-----|----------------|----------|
| **Groq API Key** | [console.groq.com](https://console.groq.com) | Scene manifest generation, prompt regeneration |
| **Gemini `__Secure-1PSID`** | Cookie from gemini.google.com (see below) | Gemini image + video generation |
| **Gemini `__Secure-1PSIDTS`** | Cookie from gemini.google.com (see below) | Gemini image + video generation |
| **Inworld API Key** | [inworld.ai/studio](https://inworld.ai/studio) | Text-to-speech narration |

Use the **"Test All Connections"** button to verify each key works before creating projects.

### Getting Gemini Cookies

Gemini uses Google session cookies for authentication. **These expire periodically — refresh them if image generation starts failing.**

1. Go to [gemini.google.com](https://gemini.google.com) and sign in with your Google account
2. Open DevTools (F12) → **Network** tab → refresh the page → click any request to gemini.google.com
3. In the **Request Headers** section, find the `cookie:` header
4. Copy the value of `__Secure-1PSID` (everything between `__Secure-1PSID=` and the next `;`)
5. Copy the value of `__Secure-1PSIDTS` the same way
6. Paste each into **Settings → Gemini PSID / Gemini PSIDTS** and save
7. Click **"Test Gemini"** to confirm it works

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — new project form with voice & split mode selection |
| `/projects` | Project list |
| `/projects/:id` | Project status, stats, scene cards |
| `/projects/:id/preview` | Cinematic preview player |
| `/settings` | API keys, provider config, health checks |
| `/errors` | Error log viewer — all failed scenes across all projects |
| `/text-splitter` | Smart text splitter utility |

## Useful Commands (VPS)

```bash
# Logs (live)
journalctl -u historia-3001 -f

# Restart service
systemctl restart historia-3001

# Stop service
systemctl stop historia-3001

# Edit config
nano /opt/historia/.env

# Update to latest version
cd /opt/historia && git pull && npm run setup && npm run build && systemctl restart historia-3001
```

## Nginx Reverse Proxy (optional)

To serve Historia on a domain without exposing the port:

```nginx
server {
    listen 80;
    server_name historia.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50M;
    }
}
```

## Troubleshooting

### "Gemini image generation failed" / cookies expired

Your Gemini session cookies have expired. Fix:
1. Go to [gemini.google.com](https://gemini.google.com) and log in
2. Open DevTools → Network tab → refresh → click any gemini.google.com request
3. Copy `__Secure-1PSID` and `__Secure-1PSIDTS` from the `cookie:` request header
4. Paste into **Settings → Gemini PSID / PSIDTS** and save
5. Click **"Test Gemini"** — if it goes green, use **"Generate All Missing Images"** or **"Retry All Failed"** on your project

### "Groq API key is invalid"

Go to [console.groq.com](https://console.groq.com), create a new API key, and update it in Settings.

### "Inworld API key is invalid"

Go to [inworld.ai/studio](https://inworld.ai/studio), generate a new key, and update it in Settings.

### Missing audio files / audio_status: failed

Click **"Retry Failed Audio"** on the project page. The pipeline retries each scene up to 3 times automatically — if audio is still failing, check your Inworld API key in Settings.

### Gemini animation fails / "only landscape images can be animated"

Gemini video generation only accepts landscape (16:9) images. Historia generates landscape images by default — if you see this error, regenerate the scene image first, then retry the animation.

### Gemini sidecar not reachable

Make sure the Python sidecar is running:

```bash
# Check if port 3060 is listening
ss -tlnp | grep 3060

# Or start it manually
cd gemini-service && venv/bin/uvicorn main:app --port 3060
```

If `npm run dev` starts both processes, check for Python errors in the terminal output.

### Database connection error

Ensure `DATABASE_URL` is set correctly in your `.env` and PostgreSQL is running:
```bash
systemctl status postgresql
npm run db:push
```

### Images show as failed / need regeneration

If you had SVG placeholder images from an older build, they are automatically cleared on project load. Open the project in Preview — if a red **"N Failed"** button appears in the toolbar, click it, select all failed images, and hit **Regen Images**. Make sure your Gemini cookies are valid first (Settings → Test Gemini).

> Mock image/audio generation has been fully removed. If a provider is not configured, generation fails with a clear error instead of saving a placeholder.

## Error Handling

- **Missing API keys** — prompts user to configure in Settings
- **Gemini cookie expiry** — error message surfaced per scene; refresh cookies in Settings
- **Audio failures** — auto-retries up to 3 times (2s → 4s backoff); dedicated "Retry Failed Audio" button for bulk recovery
- **Rate limiting (429)** — short backoff and automatic retry
- **Generation failures** — shows provider-specific error details per scene on the Error Log page

## Project Structure

```
├── install.sh                 # One-click VPS installer
├── gemini-service/            # Python FastAPI sidecar (image + video via gemini_webapi)
│   ├── main.py                # FastAPI app: /generate-image, /generate-video, /health
│   ├── requirements.txt       # gemini_webapi, fastapi, uvicorn
│   └── install.sh             # Standalone sidecar setup script
├── server/
│   ├── index.ts               # Express server entry point
│   ├── db.ts                  # Drizzle ORM database connection
│   ├── routes/
│   │   ├── projects.ts        # Project + scene CRUD, asset pipeline
│   │   ├── assets.ts          # File upload/download routes
│   │   ├── regenerate.ts      # Per-scene asset regeneration
│   │   ├── render.ts          # Video clip generation, merge, Gemini animation routes
│   │   └── gemini-proxy.ts    # Gemini API proxy (forwards to Python sidecar)
│   └── lib/
│       └── gemini.ts          # Gemini sidecar client wrapper
├── shared/
│   └── schema.ts              # Drizzle schema (projects, scenes)
├── src/
│   ├── components/
│   │   ├── AppLayout.tsx      # Main layout with sidebar
│   │   ├── AudioPlayer.tsx    # Inline audio player
│   │   ├── ProjectForm.tsx    # New project form
│   │   ├── SceneCard.tsx      # Scene detail card with editing
│   │   ├── SplitSceneDialog.tsx
│   │   ├── Timeline.tsx       # Horizontal scene timeline
│   │   └── ui/                # shadcn/ui components
│   ├── lib/
│   │   ├── api.ts             # Pipeline orchestration, CRUD, progressive batching
│   │   ├── providers.ts       # AI integrations (Groq, Gemini, Inworld, scene splitting)
│   │   ├── types.ts           # TypeScript interfaces
│   │   └── utils.ts           # Utility functions
│   └── pages/
│       ├── Index.tsx          # Home / project form
│       ├── Projects.tsx       # Project list
│       ├── ProjectStatus.tsx  # Project detail + scene cards
│       ├── ProjectPreview.tsx # Cinematic preview player
│       ├── Settings.tsx       # Config + health checks + custom voices
│       ├── ErrorLog.tsx       # Error log viewer
│       └── TextSplitter.tsx   # Smart text splitter utility
└── uploads/                   # Generated images and audio (gitignored)
```

## Database Schema

### `projects`
| Column | Type | Description |
|--------|------|-------------|
| `id` | text | e.g. `proj_abc12345` |
| `title` | text | Project name |
| `status` | text | `created`, `processing`, `completed`, `partial`, `failed`, `stopped` |
| `settings` | jsonb | Voice ID, split mode, provider config |
| `style_summary` | jsonb | Visual style guide (palette, lighting, framing, mood) |
| `stats` | jsonb | Scene/image/audio counts, needs-review count |

### `scenes`
| Column | Type | Description |
|--------|------|-------------|
| `project_id` | text | FK to projects |
| `scene_number` | int | Sequential scene index |
| `script_text` | text | Original script chunk |
| `tts_text` | text | Narration text (always equal to script_text) |
| `image_prompt` | text | Cinematic image prompt |
| `fallback_prompts` | jsonb | Array of 3 fallback prompts |
| `image_status` / `audio_status` | text | `pending`, `completed`, `failed` |
| `image_error` / `audio_error` | text | Last error message if generation failed |
| `image_attempts` / `audio_attempts` | int | Number of generation attempts |
| `voice_id` | text | Per-scene voice override |
| `needs_review` | bool | Flagged for attention |

## Scripts

```bash
npm run setup    # Install Node deps + create Python venv + install Python deps
npm run dev      # Build frontend + start Express server + Gemini Python sidecar
npm run server   # Start Express server + Gemini sidecar (no rebuild)
npm run build    # Production Vite build only
npm run db:push  # Sync database schema
```

## License

Private project.
