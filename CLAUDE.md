# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Build frontend + start Express server (PORT, default 3001)
npm run build        # Vite production build
npm run server       # Start Express server only (no rebuild)
npm run lint         # ESLint
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
npx vitest run src/test/specific.test.ts   # Run a single test file
npx vitest run -t "test name pattern"      # Run tests matching a name
npm run db:push      # Sync Drizzle schema to PostgreSQL
npm run deploy       # git push origin main
```

## Architecture

Historia is a cinematic historical documentary generator: script → AI scene splitting → image generation → TTS narration → video clips. It's a full-stack React + Express app with PostgreSQL.

### Frontend (React 18 + Vite, `src/`)
- **Routing**: React Router v6. Routes defined in `App.tsx`.
- **State**: TanStack Query v5 for server data; localStorage (via helpers in `src/lib/providers.ts`) for API keys and user settings.
- **Pages** in `src/pages/`: Home → Projects → ProjectStatus → ProjectPreview → Settings → ErrorLog → VideoGen → ImageToVideo → TextSplitter
- **Core logic** lives in two files:
  - `src/lib/api.ts` — pipeline orchestration, all API calls, progressive batching, polling, bulk operations
  - `src/lib/providers.ts` — AI integrations (Groq, Whisk, Inworld TTS), script splitting, settings management

### Backend (Express 5, `server/`)
- Entry: `server/index.ts` — starts on `PORT` (default 3001), serves static `dist/` + SPA fallback
- Routes: `server/routes/` — `projects.ts`, `assets.ts`, `regenerate.ts`, `render.ts`, `whisk-proxy.ts`
- The Whisk proxy at `/api/whisk-proxy/*` is a CORS bypass that forwards browser session cookies to Google's API

### Shared (`shared/`)
- `shared/schema.ts` — Drizzle ORM schema for `projects` and `scenes` tables; imported by both frontend and backend
- `src/lib/types.ts` — TypeScript interfaces (`Project`, `Scene`, `ProjectSettings`, `StyleSummary`, `ProjectStats`) used on both sides

### Database
- PostgreSQL via Drizzle ORM. Two tables: `projects` (metadata, settings, style_summary, stats as JSONB) and `scenes` (per-scene prompts, file paths, statuses, error logs).
- Schema changes: edit `shared/schema.ts` → `npm run db:push`

### Asset file storage (`uploads/`)
```
uploads/{projectId}/
  style/       style1.png, style2.png — reference images for Whisk
  images/      {sceneNumber}.png — generated images (.svg = mock placeholder, never use for render)
  audio/       {sceneNumber}.mp3 — TTS audio
  videos/      {sceneNumber}.mp4 — Veo-animated clips (optional)
  clips/       {sceneNumber}.mp4 — final per-scene clips with Ken Burns + audio
  render/      output.mp4 — merged documentary
```

## Pipeline

### Dual-mode asset generation

When the server has both `WHISK_COOKIE` and `INWORLD_API_KEY` set, `POST /api/projects/:id/scenes` fires `runAssetPipeline()` server-side and returns `{ serverPipeline: true }`. The frontend then polls instead of generating locally.

When those env vars are absent, the client generates assets via the Whisk proxy and Inworld API directly, then saves files by calling `PATCH /api/projects/:id/scenes/:num`.

The `stats.serverPipeline` boolean in the `projects` table is the flag the frontend reads to decide whether to poll or drive generation itself.

### Full pipeline flow
1. User submits script + optional style images → `POST /api/projects` creates project record
2. Script split into scenes client-side (Groq API, batched 30 scenes/request)
3. Scenes inserted via `POST /api/projects/:id/scenes` — triggers server pipeline if configured
4. Images: Google Imagen 3.5 via Whisk (`/api/whisk-proxy/` or server-side); 3 concurrent workers
5. Audio: Inworld TTS API; sequential (100 RPS, retries up to 3× with backoff)
6. Video export (VideoGen page):
   - Phase 1: `POST /api/render/:id/clips` — one MP4 per scene with Ken Burns effect
   - Phase 2: `POST /api/render/:id` — concat clips into `output.mp4`
   - Or: `POST /api/render/:id/auto` — all phases in one background job
   - Optional: `POST /api/render/:id/animate` — Veo animation via Whisk before clip generation

**Render jobs (`clipJobs`, `mergeJobs`, `animateJobs`, `autoJobs`) are stored in-memory — they don't survive server restarts.**

## Key Conventions

- **AI providers** (Groq key, Whisk cookie, Inworld key) are stored in `localStorage` and set via the Settings page — not in `.env`. The Groq key is **never** in `.env`.
- **shadcn/ui** components live in `src/components/ui/`. Fonts: Cinzel (headings), Source Sans 3 (body).
- Scene status fields (`image_status`, `audio_status`): `pending` | `completed` | `failed`
- Project status values: `created` | `processing` | `completed` | `partial` | `failed` | `stopped`
- `scene_number` is sequential (1-based) per project; scenes can be appended via `/api/projects/:id/scenes/append`.
- `project.stats` is recalculated from live scene rows on every `GET /api/projects/:id` — the stored value is a cache that self-corrects on fetch.
- `.svg` files in `uploads/{id}/images/` are mock placeholders; `POST /api/projects/:id/fix-mocks` resets them to `failed` so real images can be generated.

## Environment Variables

Create `.env` in project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:password@localhost:5432/historia
RENDER_API_URL=http://5.189.146.143:9000   # External FFmpeg render API
RENDER_API_KEY=alliswell
WHISK_VPS_URL=http://5.189.146.143:3050    # Google Whisk proxy (image gen + Veo)
SERVER_URL=http://5.189.146.143:3001       # Public URL of this server (used by render API to fetch assets)
WHISK_COOKIE=<session cookie>              # Can also be set via Settings page
INWORLD_API_KEY=<key>                      # Can also be set via Settings page
```
