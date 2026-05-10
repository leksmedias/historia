# Historia — Cinematic Historical Documentary Generator

A self-hosted web application that transforms historical scripts into cinematic documentary-style videos — AI-generated images via Google Imagen, professional narration via Inworld TTS, Ken Burns animated clips, and FFmpeg-rendered video export.

## Quick Start

```bash
git clone https://github.com/leksmedias/historia.git
cd historia
npm run setup   # installs Node deps
npm run dev     # builds frontend + starts Express server
```

**Requirements:** Node.js 18+, PostgreSQL

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
journalctl -u historia-3001 -n 30
```

## Overview

Historia automates the production pipeline for historical documentary content:

1. **Write a script** — paste your historical narrative
2. **Upload style references** — provide 2 reference images to guide the visual style
3. **Choose voice & split mode** — select a narration voice and how the script is divided into scenes
4. **AI generates scenes** — Groq splits your script into visual scenes with cinematic image prompts (long scripts are batched progressively — you're redirected as soon as the first batch is ready)
5. **Image generation** — Google Imagen creates historically-accurate images via the Gemini API
6. **Voice narration** — Inworld AI generates professional text-to-speech audio per scene (up to 3 auto-retries on failure)
7. **Video clip generation** — each scene becomes an MP4 clip, exactly synced to its narration length; still images get a Ken Burns pan/zoom effect
8. **Export** — download individual clips as ZIP or merge everything into a single documentary MP4
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
- **Audio mixing** — narration at full volume
- **Download options** — all clips as ZIP or full merged documentary MP4
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

### Settings & Health Checks
- **Render API health check** — shown at the top of Settings; "Test Connection" verifies the FFmpeg VPS is reachable
- **API connection testing** — test each provider (Groq, Inworld) with one click
- **Green/red status indicators** — instant visual feedback with detailed error messages
- **Custom voice management** — add/remove custom Inworld voice IDs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Backend | Express.js (Node.js) |
| Database | PostgreSQL (via Drizzle ORM) |
| AI — Script | Groq API (openai/gpt-oss-120b, 131k context) |
| AI — Images | Google Imagen via Gemini API (`imagen-3.0-generate-002`) |
| AI — TTS | Inworld AI (TTS 1.5 Max, 100 RPS) |
| Video | FFmpeg — Ken Burns (`scale+crop+t`), loudnorm, xfade |

## Setup

### Prerequisites
- Node.js 18+ ([install via nvm](https://github.com/nvm-sh/nvm#installing-and-updating))
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
npm run setup
# Create .env with your DATABASE_URL and GEMINI_API_KEY (see below)
npm run db:push
npm run dev
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:yourpassword@localhost:5432/historia

# Google Imagen image generation
GEMINI_API_KEY=AIza...
IMAGEN_MODEL_ID=imagen-3.0-generate-002   # optional, this is the default

# VPS external services
RENDER_API_URL=http://your-ffmpeg-server:9000
RENDER_API_KEY=alliswell
SERVER_URL=http://your-server:3001   # public URL of this server

# Optional — can also be configured in the app's Settings page
INWORLD_API_KEY=<your inworld api key>
```

### API Keys Configuration

| Key | Where to get it | Where to set it |
|-----|----------------|-----------------|
| **Gemini API Key** | [aistudio.google.com](https://aistudio.google.com) → Get API key | `.env` as `GEMINI_API_KEY` |
| **Groq API Key** | [console.groq.com](https://console.groq.com) | Settings page (stored in localStorage) |
| **Inworld API Key** | [inworld.ai/studio](https://inworld.ai/studio) | Settings page or `.env` as `INWORLD_API_KEY` |

Use the **"Test All Connections"** button in Settings to verify each key works before creating projects.

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

### "GEMINI_API_KEY is not set" / image generation fails

Add your Gemini API key to `.env`:
```env
GEMINI_API_KEY=AIza...your_key...
```
Get one at [aistudio.google.com](https://aistudio.google.com) → Get API key. Then restart the server.

### "Groq API key is invalid"

Go to [console.groq.com](https://console.groq.com), create a new API key, and update it in Settings.

### "Inworld API key is invalid"

Go to [inworld.ai/studio](https://inworld.ai/studio), generate a new key, and update it in Settings.

### Missing audio files / audio_status: failed

Click **"Retry Failed Audio"** on the project page. The pipeline retries each scene up to 3 times automatically — if audio is still failing, check your Inworld API key in Settings.

### Database connection error

Ensure `DATABASE_URL` is set correctly in your `.env` and PostgreSQL is running:
```bash
systemctl status postgresql
npm run db:push
```

### Images show as failed / need regeneration

Open the project in Preview — if a red **"N Failed"** button appears in the toolbar, click it, select all failed images, and hit **Regen Images**. Make sure `GEMINI_API_KEY` is set in `.env`.

> Mock image/audio generation has been fully removed. If a provider is not configured, generation fails with a clear error instead of saving a placeholder.

## Error Handling

- **Missing API keys** — clear error messages surfaced per scene and in Settings
- **Audio failures** — auto-retries up to 3 times (2s → 4s backoff); dedicated "Retry Failed Audio" button for bulk recovery
- **Rate limiting (429)** — short backoff and automatic retry
- **Generation failures** — shows provider-specific error details per scene on the Error Log page

## Project Structure

```
├── install.sh                 # One-click VPS installer
├── server/
│   ├── index.ts               # Express server entry point
│   ├── db.ts                  # Drizzle ORM database connection
│   ├── routes/
│   │   ├── projects.ts        # Project + scene CRUD, asset pipeline
│   │   ├── assets.ts          # File upload/download routes
│   │   ├── regenerate.ts      # Per-scene asset regeneration
│   │   ├── render.ts          # Video clip generation + merge routes
│   │   └── gemini-proxy.ts    # Imagen API proxy + Groq/Claude forwarding
│   └── lib/
│       └── gemini.ts          # Google Imagen API client (Gemini API key auth)
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
│   │   ├── providers.ts       # AI integrations (Groq, Imagen, Inworld, scene splitting)
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
npm run setup    # Install Node deps
npm run dev      # Build frontend + start Express server
npm run server   # Start Express server only (no rebuild)
npm run build    # Production Vite build only
npm run db:push  # Sync database schema
npm run deploy   # git push origin main
```

## License

Private project.
