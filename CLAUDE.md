# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Build frontend + start Express server on port 5000
npm run build        # Vite production build
npm run server       # Start Express server only (no rebuild)
npm run lint         # ESLint
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
npm run db:push      # Sync Drizzle schema to PostgreSQL
npm run deploy       # git push origin main
```

## Architecture

Historia is a cinematic historical documentary generator: script → AI scene splitting → image generation → TTS narration → video clips. It's a full-stack React + Express app with PostgreSQL.

### Frontend (React 18 + Vite, `src/`)
- **Routing**: React Router v6. Routes defined in `App.tsx`.
- **State**: TanStack Query v5 for server data; localStorage (via helpers in `src/lib/providers.ts`) for API keys and user settings.
- **Pages** in `src/pages/`: Home → Projects → ProjectStatus → ProjectPreview → Settings → ErrorLog → VideoGen → ImageToVideo
- **Core logic** lives in two files:
  - `src/lib/api.ts` — pipeline orchestration, all API calls, progressive batching, polling
  - `src/lib/providers.ts` — AI integrations (Groq, Whisk, Inworld TTS), script splitting, settings management

### Backend (Express 5, `server/`)
- Entry: `server/index.ts` — starts on `PORT` (default 5000), serves static `dist/` + SPA fallback
- Routes: `server/routes/` — `projects.ts`, `assets.ts`, `regenerate.ts`, `render.ts`, `whisk-proxy.ts`
- The Whisk proxy at `/api/whisk-proxy/*` is a CORS bypass that forwards browser session cookies to Google's API

### Shared (`shared/`)
- `shared/schema.ts` — Drizzle ORM schema for `projects` and `scenes` tables; imported by both frontend and backend

### Database
- PostgreSQL via Drizzle ORM. Two tables: `projects` (metadata, settings, style_summary, stats as JSONB) and `scenes` (per-scene prompts, file paths, statuses, error logs).
- Schema changes: edit `shared/schema.ts` → `npm run db:push`

### Pipeline (Frontend-Driven)
1. User submits script + style images → project created via `/api/projects`
2. Script is split into scenes client-side (Groq API, batched 30 scenes/request)
3. Images generated client-side via `/api/whisk-proxy/` (Google Imagen 3.5)
4. Audio generated client-side via Inworld TTS API
5. Video export: `/api/render/*` (external FFmpeg VPS)

## Key Conventions

- **AI providers** (Groq key, Whisk cookie, Inworld key) are stored in `localStorage` and set via the Settings page — not in `.env`. The Groq key is **never** in `.env`.
- **shadcn/ui** components live in `src/components/ui/`. Fonts: Cinzel (headings), Source Sans 3 (body).
- Scene status fields: `pending` | `completed` | `failed` for both `image_status` and `audio_status`.
- `scene_number` is sequential (1-based) per project; scenes can be appended via `/api/projects/:id/scenes/append`.

## Environment Variables

Create `.env` in project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:password@localhost:5432/historia
RENDER_API_URL=http://5.189.146.143:9000   # External FFmpeg render API
RENDER_API_KEY=alliswell
WHISK_VPS_URL=http://5.189.146.143:3050    # Google Whisk proxy (image gen + Veo)
SERVER_URL=http://5.189.146.143:3001       # Public URL of this server
WHISK_COOKIE=<session cookie>              # Can also be set via Settings page
INWORLD_API_KEY=<key>                      # Can also be set via Settings page
```
