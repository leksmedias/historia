# Historia — Cinematic Historical Documentary Generator

A self-hosted web application that transforms historical scripts into cinematic documentary-style videos — AI-generated images via Google Vertex AI (Imagen 4 / Gemini), professional narration via Inworld TTS, optional Veo animation, Ken Burns animated clips, and FFmpeg-rendered video export up to 1440p.

## Quick Start

```bash
git clone https://github.com/leksmedias/historia.git
cd historia
npm run setup   # installs Node deps
npm run dev     # builds frontend + starts Express server
```

**Requirements:** Node.js 18+, PostgreSQL, Google Cloud SDK (`gcloud`) authenticated

## Quick Install (VPS — one command)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/leksmedias/historia/main/install.sh)
```

Paste on any Ubuntu 22.04 / Debian 12 server as root. You'll be prompted for a port (default `3001`).

## Updating an Existing Install

```bash
cd /opt/historia
git pull
npm run setup
npm run build
systemctl restart historia-3001   # replace 3001 with your port
```

---

## Overview

Historia automates the production pipeline for historical documentary content:

1. **Write a script** — paste your historical narrative
2. **Upload style references** or provide a text style prompt to guide the visual style
3. **Choose voice, split mode, and image model** — control scene density and image quality
4. **AI generates scenes** — Groq or Claude splits your script into visual scenes with cinematic image prompts
5. **Image generation** — Google Vertex AI (Imagen 4 / Gemini 2.5 / Gemini 3.1) creates historically accurate images
6. **Voice narration** — Inworld AI generates professional TTS audio per scene with auto-retry
7. **Optional Veo animation** — send completed images to Veo 3.1 Lite to generate short video clips
8. **Clip generation** — each scene becomes an MP4 clip synced to its narration; stills get Ken Burns effects
9. **Merge & export** — download individual clips as ZIP or merge into a full documentary MP4 at up to 1440p
10. **Preview & refine** — cinematic player for review, prompt editing, and per-scene regeneration

---

## Features

### Image Generation
- **Five selectable models** via Google Vertex AI:
  - `Imagen 4 Fast` — fastest, good quality (default)
  - `Imagen 4` — balanced quality and speed
  - `Imagen 4 Ultra` — highest quality Imagen
  - `Gemini 2.5 Flash` — Gemini-based image generation
  - `Gemini 3.1 Flash (Preview)` — latest Gemini image model
- **Aspect ratio** — 16:9 (landscape) or 9:16 (portrait) applied to all models
- **Server-side semaphore** — max 2 concurrent Imagen calls to respect Vertex AI quota
- **Fallback prompts** — 3 progressive fallbacks per scene if primary prompt is rejected
- **Safety settings OFF** for Gemini models (all four harm categories)

### Video Pipeline
- **Ken Burns effects** — six animated effects (zoom-in/out, pan-right/left/up/down) applied to still images; effects rotate across scenes
- **Veo animation** — optionally animate selected scenes with Veo 3.1 Lite before clip generation; slow-motion applied when Veo is shorter than audio
- **xfade dissolve transitions** — smooth 1-second crossfade between every clip in the final merge
- **Render resolutions** — 480p (854×480), 720p (1280×720), **1080p (1920×1080)**, **1440p (2560×1440)**; default 1080p
- **Two-phase render** — Phase 1 generates individual clips; Phase 2 merges; or use "Auto" to run both server-side
- **Clip concurrency** — configurable via `CLIP_CONCURRENCY` env var (default: 3)

### Downloads
Every project's assets are accessible directly from the **Files & Downloads** card on the project page and the **Downloads** panel in the preview:

| What | Endpoint |
|------|----------|
| All images + audio | `GET /api/download/{projectId}` |
| Individual scene clips | `GET /api/render/{projectId}/clips/zip` |
| Veo animated scenes | `GET /api/render/{projectId}/animate/zip` |
| Final merged video | `GET /api/render/{projectId}/download` |
| Raw files (static) | `/uploads/{projectId}/images/`, `/audio/`, `/videos/`, `/clips/`, `/render/` |

### Script Splitting
- **Smart** — randomly groups 2–3 sentences per scene
- **Exact** — one sentence per scene
- **Duration** — groups sentences by speaking time (2.5 words/sec target)
- **Two** — exactly 2 sentences per scene
- **JSON Import** — bypass splitting entirely with a pre-structured `[{narration_text, visual_prompt}]` array

### Scene Management
- **Inline editing** — edit image prompts and script text directly on scene cards
- **Per-scene voice override** — change the narration voice per scene
- **Scene splitting** — split any scene at a sentence boundary
- **Image & audio regeneration** — regenerate individual or bulk assets
- **Failed scene recovery** — "N Failed" panel in preview with checkboxes and bulk regeneration

### Image Model Test
`/image-test` page lets you run all five models against the same prompt side by side — choose aspect ratio, click "Run All", and compare quality and speed before committing to a model for a project.

### Settings
- **API keys** — Groq, Anthropic (Claude), Inworld; stored in localStorage
- **Image model + aspect ratio** — default applied to all new projects
- **TTS model** — Inworld 1.5 Max/Mini, 1.0 Max/Standard
- **Custom voices** — add Inworld voice IDs not in the built-in list
- **Connection health checks** — test Groq, Inworld, and the external render API with one click

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Backend | Express.js 5 (Node.js + tsx) |
| Database | PostgreSQL via Drizzle ORM |
| AI — Script splitting | Groq API (Llama 3.3 70B) or Anthropic (Claude) |
| AI — Images | Google Vertex AI — Imagen 4 / Gemini 2.5 / Gemini 3.1 |
| AI — Animation | Google Vertex AI — Veo 3.1 Lite (`us-central1`) |
| AI — TTS | Inworld AI (TTS 1.5 Max) |
| Video | FFmpeg — Ken Burns (`scale+crop`), xfade dissolve, loudnorm |

---

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL
- Google Cloud SDK — `gcloud auth application-default login` authenticated on the server host (required for Vertex AI)

### VPS Installation (Ubuntu / Debian)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/leksmedias/historia/main/install.sh)
```

The script automatically installs Node.js 20, PostgreSQL, creates the database, writes `.env`, builds the app, and creates a systemd service.

After install, configure Vertex AI and API keys in `.env`:

```bash
nano /opt/historia/.env
systemctl restart historia-3001
```

### Manual Local Installation

```bash
git clone https://github.com/leksmedias/historia.git
cd historia
npm run setup
# Create .env (see below)
npm run db:push
npm run dev
```

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:yourpassword@localhost:5432/historia

# Google Vertex AI — for Imagen + Gemini image generation
# Requires: gcloud auth application-default login on the server
VERTEX_PROJECT_ID=your-gcp-project-id
VERTEX_LOCATION_ID=europe-west4          # Imagen region
VERTEX_MODEL_ID=imagen-4.0-fast-generate-001

# Veo animation (us-central1 only)
VEO_LOCATION_ID=us-central1
VEO_MODEL_ID=veo-3.1-lite-generate-001

# External FFmpeg render API
RENDER_API_URL=http://your-ffmpeg-server:9000
RENDER_API_KEY=alliswell
SERVER_URL=http://your-server:3001        # public URL (used by render API to fetch assets)

# Optional — TTS; can also be set in the app's Settings page
INWORLD_API_KEY=<base64-encoded-key>

# Optional — LLM for scene generation; can also be passed per-request from Settings
GROQ_API_KEY=<key>
ANTHROPIC_API_KEY=<key>

# Optional tuning
CLIP_CONCURRENCY=3                        # parallel clip generation workers (default: 3)
```

### API Keys

| Key | Where to get it | Where to configure |
|-----|----------------|--------------------|
| **Vertex AI** | [console.cloud.google.com](https://console.cloud.google.com) → enable Vertex AI API | `gcloud auth application-default login` on server + `.env` `VERTEX_PROJECT_ID` |
| **Groq** | [console.groq.com](https://console.groq.com) | Settings page (stored in localStorage) |
| **Anthropic** | [console.anthropic.com](https://console.anthropic.com) | Settings page (takes priority over Groq when set) |
| **Inworld TTS** | [inworld.ai/studio](https://inworld.ai/studio) | Settings page or `.env` `INWORLD_API_KEY` |

---

## Pages

| Route | Description |
|-------|-------------|
| `/` | New project form — script, style, voice, split mode |
| `/projects` | Project list |
| `/projects/:id` | Project status, stats, scene cards, Downloads card |
| `/projects/:id/preview` | Cinematic preview player, render controls, Downloads panel |
| `/json-to-video` | JSON import — paste pre-structured scene list, skip splitting |
| `/image-test` | Compare all image models side by side |
| `/settings` | API keys, model config, aspect ratio, voice config, health checks |
| `/errors` | Error log — all failed scenes across all projects with retry buttons |

---

## Project Structure

```
├── server/
│   ├── index.ts               # Express 5 entry — serves dist/ + SPA fallback
│   ├── db.ts                  # Drizzle + PostgreSQL connection
│   ├── lib/
│   │   ├── gemini.ts          # Vertex AI image generation (Imagen + Gemini)
│   │   └── veo.ts             # Vertex AI Veo animation
│   └── routes/
│       ├── projects.ts        # Project + scene CRUD, asset pipeline trigger
│       ├── assets.ts          # File upload/download, project ZIP
│       ├── regenerate.ts      # Per-scene image/audio regeneration
│       ├── gemini-proxy.ts    # Multi-service proxy (Imagen, Groq, Claude)
│       └── render.ts          # Ken Burns clips, xfade merge, Veo animation, downloads
├── shared/
│   └── schema.ts              # Drizzle schema (projects, scenes)
├── src/
│   ├── components/
│   │   ├── AppLayout.tsx / AppSidebar.tsx
│   │   ├── SceneCard.tsx      # Scene detail card with inline editing
│   │   ├── Timeline.tsx       # Horizontal scene thumbnail strip
│   │   └── ui/                # shadcn/ui components
│   ├── lib/
│   │   ├── api.ts             # Pipeline orchestration, all API calls
│   │   ├── providers.ts       # AI integrations, settings, script splitting
│   │   ├── types.ts           # TypeScript interfaces
│   │   └── GenerationContext.tsx  # Global generation state
│   └── pages/
│       ├── Index.tsx          # New project form
│       ├── Projects.tsx       # Project list
│       ├── ProjectStatus.tsx  # Project detail + Downloads card
│       ├── ProjectPreview.tsx # Cinematic player + render + Downloads panel
│       ├── JsonToVideo.tsx    # JSON import page
│       ├── ImageModelTest.tsx # Image model comparison tool
│       ├── Settings.tsx       # Config + health checks
│       └── ErrorLog.tsx       # Error log with retry
└── uploads/                   # Generated assets (gitignored)
    └── {projectId}/
        ├── images/            # {sceneNumber}.png — generated images
        ├── audio/             # {sceneNumber}.mp3 — TTS narration
        ├── videos/            # {sceneNumber}.mp4 — Veo animated clips
        ├── clips/             # {sceneNumber}.mp4 — final scene clips
        ├── render/            # output.mp4 — merged documentary
        └── style/             # style1.png, style2.png — reference images
```

---

## Database Schema

### `projects`
| Column | Type | Notes |
|--------|------|-------|
| `id` | text | `proj_abc12345` |
| `title` | text | |
| `mode` | text | `"history"` (default) |
| `status` | text | `created` \| `processing` \| `completed` \| `partial` \| `failed` \| `stopped` |
| `settings` | jsonb | Voice, model, split mode, TTS provider, aspect ratio |
| `style_summary` | jsonb | Palette, lighting, framing, mood |
| `stats` | jsonb | Scene/image/audio counts; recalculated on every `GET /api/projects/:id` |

### `scenes`
| Column | Type | Notes |
|--------|------|-------|
| `project_id` | text | FK → projects (cascade delete) |
| `scene_number` | int | 1-based, sequential |
| `script_text` | text | Display text |
| `tts_text` | text | Text sent to TTS (may differ) |
| `image_prompt` | text | Cinematic image generation prompt |
| `motion_prompt` | text | Veo animation prompt (falls back to `image_prompt`) |
| `fallback_prompts` | jsonb | Array of 3 alternative prompts |
| `image_status` | text | `pending` \| `completed` \| `failed` |
| `audio_status` | text | `pending` \| `completed` \| `failed` |
| `video_status` | text | `none` \| `animating` \| `completed` \| `failed` |
| `image_file` / `audio_file` | text | Filename in uploads dir |
| `needs_review` | bool | Set true on generation failure |
| `voice_id` | text | Per-scene voice override |

---

## Useful VPS Commands

```bash
# Live logs
journalctl -u historia-3001 -f

# Restart / stop
systemctl restart historia-3001
systemctl stop historia-3001

# Edit config
nano /opt/historia/.env

# Update to latest
cd /opt/historia && git pull && npm run setup && npm run build && systemctl restart historia-3001

# Re-auth Vertex AI
gcloud auth application-default login --no-browser
```

## Nginx Reverse Proxy (optional)

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

---

## Troubleshooting

**Vertex AI auth failed**
```bash
gcloud auth login --no-browser
gcloud auth application-default login --no-browser
```

**Gemini / Imagen quota exceeded (429)**
The server retries automatically with 10s / 20s / 30s backoff (4 attempts). If still failing, check your Vertex AI quota at [console.cloud.google.com](https://console.cloud.google.com) → Quotas.

**Audio generation fails**
Check the Inworld API key in Settings. The pipeline retries up to 3 times per scene. Click **"Retry Failed Audio"** on the project page for bulk recovery.

**Images show as SVG placeholders**
Click `POST /api/projects/:id/fix-mocks` (or open the project in Preview — it runs automatically) to reset mock scenes to `failed` so they can be regenerated.

**Database connection error**
```bash
systemctl status postgresql
npm run db:push
```

**Render API unreachable**
Go to Settings and click **"Test Connection"** under Render API. Ensure `RENDER_API_URL` and `RENDER_API_KEY` are set in `.env`.

---

## License

Private project.
