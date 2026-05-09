# Design: Replace Whisk API with Gemini Web API

**Date:** 2026-05-09  
**Status:** Approved

---

## Overview

Replace Google Whisk (image generation + Veo animation) with `gemini_webapi` — a Python async wrapper for the Gemini web interface. The replacement covers:

- Scene image generation (currently: Whisk → Google Imagen 3.5)
- Scene video animation (currently: Veo 3.1 lite direct API + VPS fallback)

The rest of the pipeline (Groq script splitting, Inworld TTS, FFmpeg render) is unchanged.

---

## Architecture

### Python Gemini Sidecar (`gemini-service/`)

A FastAPI application that wraps `gemini_webapi`. Runs as a separate process alongside the Node.js server, on port `3060` (configurable via `GEMINI_SERVICE_URL` env var).

**Endpoints:**

```
POST /generate-image
  Body: { prompt, psid, psidts }
  Returns: { image_base64: "..." }

POST /generate-video
  Body: { prompt, image_path, psid, psidts }
  Returns: { video_base64: "..." }
```

- **Session caching**: keeps one `GeminiClient` instance alive in app state, keyed by `psid`. If the incoming `psid` matches the cached one, reuses the session (fast). If it changes (user updated cookies in Settings), re-initialises. `auto_refresh=True` keeps `__Secure-1PSIDTS` fresh in the background.
- Image generation: prompts Gemini to "Generate an image: {prompt}" — routes to Nano Banana
- Video generation: passes the existing scene PNG (`image_path` = absolute server-local path) as a file input alongside the scene prompt. Both Node.js and Python run on the same VPS so the path is directly accessible.
- `GEMINI_COOKIE_PATH` env var set so auto-refreshed cookies persist across sidecar restarts

**Files:**
```
gemini-service/
  main.py            FastAPI app with /generate-image and /generate-video
  requirements.txt   gemini_webapi, fastapi, uvicorn
  install.sh         Standalone setup script for VPS
```

### Node.js Server Changes

**Renamed/replaced files:**
- `server/routes/whisk-proxy.ts` → `server/routes/gemini-proxy.ts`
  - Mount: `/api/gemini-proxy` (frontend references updated)
  - `action: "generate"` → forwards to `GEMINI_SERVICE_URL/generate-image`
  - Returns same response shape: `{ imagePanels: [{ generatedImages: [{ encodedImage }] }] }`
  - Non-image actions (`groq-chat`, `claude-chat`, `session`) remain unchanged
- `server/lib/whisk.ts` → `server/lib/gemini.ts`
  - `generateWhiskImageWithRefs()` → `generateGeminiImage()` — calls sidecar `/generate-image`
  - `animateWhiskImage()` → `animateGeminiVideo()` — calls sidecar `/generate-video`
  - Removes: Veo 3.1 lite direct API path, `animateViaVpsProxy()` fallback
- `server/routes/render.ts` — updates import from `whisk.ts` to `gemini.ts`; reads `x-gemini-psid` + `x-gemini-psidts` headers instead of `x-whisk-cookie` for animation requests
- `server/index.ts` — mounts `gemini-proxy` instead of `whisk-proxy`

**New env var:**
```env
GEMINI_SERVICE_URL=http://localhost:3060
```

**Removed env vars:** `WHISK_COOKIE`, `WHISK_VPS_URL`

### Frontend Changes

**`src/lib/providers.ts`:**
- `whiskProxy()` → `geminiProxy()` — POSTs to `/api/gemini-proxy`
- `generateWhiskImage()` → `generateGeminiImage()` — same logic, new function name
- Reads `geminiPsid` + `geminiPsidts` from settings instead of `whiskCookie`
- Unused legacy functions removed: `createWhiskProject`, `captionWhiskImage`, `uploadToWhisk`, `blobToBase64DataUrl`

**`src/lib/api.ts`:**
- All references to `generateWhiskImage` → `generateGeminiImage`
- All references to `whiskCookie` → `geminiPsid` / `geminiPsidts`
- `imageProvider` stays — still supports `"whisk"` value name OR we rename it `"gemini"` (rename preferred for clarity)

**`src/pages/Settings.tsx`:**
- Remove: `whiskCookie` single-field input
- Add: two fields — `Gemini __Secure-1PSID` and `Gemini __Secure-1PSIDTS`
- Add instructions: how to get cookies from gemini.google.com (F12 → Network → copy cookie values)

**`shared/schema.ts` / `src/lib/types.ts`:**
- `ProjectSettings.imageProvider`: `"whisk"` value renamed to `"gemini"`
- Migration note: existing DB rows with `imageProvider: "whisk"` treated as `"gemini"` via fallback

---

## Install Experience

### One-click setup
```bash
npm run setup   # installs Node deps + creates Python venv + installs Python deps
npm run dev     # starts Node.js server + Python sidecar (via concurrently)
```

### VPS production
```bash
npm run setup
npm run server  # starts both processes
```

### `package.json` scripts

`concurrently` added as a devDependency.

```json
"setup": "npm install && cd gemini-service && python3 -m venv venv && venv/bin/pip install -r requirements.txt",
"dev": "npm run build && concurrently \"node --import tsx/esm server/index.ts\" \"cd gemini-service && venv/bin/uvicorn main:app --port 3060 --reload\"",
"server": "concurrently \"node --import tsx/esm server/index.ts\" \"cd gemini-service && venv/bin/uvicorn main:app --port 3060\""
```

> Note: The existing `build` step (Vite frontend) runs before both processes start. This matches the current `dev` script pattern.

---

## Data Flow

### Image Generation (client-side pipeline)
```
Frontend
  generateGeminiImage(prompt, psid, psidts)
    ↓
  POST /api/gemini-proxy { action: "generate", prompt, psid, psidts }
    ↓
Node.js (gemini-proxy.ts)
  POST http://localhost:3060/generate-image { prompt, psid, psidts }
    ↓
Python sidecar (main.py)
  GeminiClient(psid, psidts).generate_content("Generate an image: {prompt}")
    ↓
  response.images[0] → base64 PNG
    ↓
Node.js response
  { imagePanels: [{ generatedImages: [{ encodedImage: "base64..." }] }] }
    ↓
Frontend
  base64ToBlob() → PNG blob
  POST /api/assets/{projectId}/images/{sceneNumber}.png
  PATCH /api/projects/{projectId}/scenes/{sceneNumber} { image_status: "completed" }
```

### Video Animation
```
Frontend
  startAnimateScenes(projectId, sceneNumbers[], psid, psidts)
    ↓
  POST /api/render/{projectId}/animate
    ↓
Node.js (render.ts)
  animateGeminiVideo(imagePath, psid, psidts, prompt)
    ↓
  POST http://localhost:3060/generate-video { prompt, image_path, psid, psidts }
    ↓
Python sidecar
  GeminiClient(psid, psidts).generate_content(prompt, files=[image_path])
    ↓
  response.videos[0].save() → base64 MP4
    ↓
Node.js
  fs.writeFileSync(uploads/{projectId}/videos/{sceneNumber}.mp4, buf)
```

---

## Error Handling

- Sidecar returns HTTP 500 with `{ error: "..." }` on Gemini API failures
- Node.js proxy forwards error to frontend as existing `image_status: "failed"` + `error_log`
- If `GEMINI_SERVICE_URL` is not set, server logs a warning and image generation returns an error (no silent fallback to old Whisk path)
- Gemini image generation availability varies by region/account — error messages surfaced in the error log

---

## README Updates

- Replace "Whisk Cookie" setup with Gemini cookie setup (how to get `__Secure-1PSID` + `__Secure-1PSIDTS`)
- Add "Quick Start" section: `npm run setup && npm run dev`
- Update environment variables table: add `GEMINI_SERVICE_URL`, remove `WHISK_COOKIE` / `WHISK_VPS_URL`
- Update pipeline description: "Gemini image generation + Gemini video generation"
- Add note: Python 3.10+ required

---

## Files Changed Summary

| File | Change |
|------|--------|
| `gemini-service/main.py` | NEW — FastAPI sidecar |
| `gemini-service/requirements.txt` | NEW |
| `gemini-service/install.sh` | NEW |
| `server/routes/gemini-proxy.ts` | NEW (replaces whisk-proxy.ts) |
| `server/routes/whisk-proxy.ts` | DELETE |
| `server/lib/gemini.ts` | NEW (replaces whisk.ts) |
| `server/lib/whisk.ts` | DELETE |
| `server/routes/render.ts` | UPDATE — import gemini.ts |
| `server/index.ts` | UPDATE — mount gemini-proxy |
| `src/lib/providers.ts` | UPDATE — gemini functions, new settings fields |
| `src/lib/api.ts` | UPDATE — function/variable renames |
| `src/pages/Settings.tsx` | UPDATE — new cookie fields |
| `src/lib/types.ts` | UPDATE — imageProvider type |
| `package.json` | UPDATE — setup/dev/server scripts |
| `README.md` | UPDATE — install + Gemini cookie docs |
