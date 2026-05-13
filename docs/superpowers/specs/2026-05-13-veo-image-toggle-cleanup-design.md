# Historia: Veo Animation, Image Toggle, Page Cleanup & ErrorLog Redesign

**Date:** 2026-05-13  
**Status:** Approved

---

## Overview

Four coordinated changes to Historia:

1. **Image generation toggle** — skip image gen per project/globally via a Settings switch
2. **Page cleanup** — remove VideoGen, ImageToVideo, TextSplitter from nav and routing
3. **Veo 3.1 lite image-to-video** — per-scene "Animate" button that sends the generated image to Veo 3.0-fast-preview on Vertex AI, producing an 8s video clip; audio > 8s slows the clip down (no looping)
4. **ErrorLog redesign** — project-grouped accordion, retry buttons, video error type, 4-card summary

---

## 1. Image Generation Toggle

### What changes
- `ProviderSettings` interface in `src/lib/providers.ts` gains `skipImageGeneration: boolean` (default `false`)
- `DEFAULTS` updated accordingly
- Settings → Providers tab → Image Generation card: toggle switch labeled "Generate Images". When off, concurrency slider and provider selector are disabled/grayed out.
- Client-side pipeline (`src/lib/api.ts`): when `skipImageGeneration=true`, skip the image generation step for each scene (images are always client-side — `serverCanHandleImages` is hardcoded `false` in projects.ts, so no server-side change needed)

### Behavior
- Toggle is persisted in localStorage via `saveProviderSettings`
- Turning off does NOT retroactively change existing scene statuses
- Scenes with no image simply remain `pending` for image; audio still generates

---

## 2. Page Cleanup

### Remove
- `src/pages/VideoGen.tsx` — delete file
- `src/pages/ImageToVideo.tsx` — delete file
- `src/pages/TextSplitter.tsx` — delete file

### Update
- `src/App.tsx` — remove imports and routes for the three pages
- `src/components/AppSidebar.tsx` — remove nav items: "Video Gen", "Image to Video", "Text Splitter"

### Keep
- `JsonToVideo` page and route (not in removal list)
- Backend `/api/render/image-to-video` route (harmless, may be reused)

---

## 3. Veo 3.1 Lite Image-to-Video

### Architecture

**New file: `server/lib/veo.ts`**

Calls Vertex AI `veo-3.0-fast-preview` via `predictLongRunning`:
- Auth: same `gcloud auth print-access-token` pattern as `gemini.ts`
- Project/location: same env vars (`VERTEX_PROJECT_ID`, `VERTEX_LOCATION_ID`)
- Request: image (base64 JPEG) + scene `image_prompt`, `durationSeconds: 8`, `resolution: "720p"`, `aspectRatio: "16:9"`, `sampleCount: 1`
- Operation polling: `GET .../operations/{name}` every 5s, timeout 5 minutes
- On success: decode video bytes from response, save to `uploads/{projectId}/videos/{sceneNum}.mp4`

**New routes in `server/routes/render.ts`**

```
POST /api/render/:id/veo/:sceneNum
  - Reads scene from DB (must have image_status=completed)
  - Reads image file from uploads/{id}/images/
  - Fires generateVeoClip() async
  - Returns { success: true, status: "animating" }
  - Tracks progress in veoSceneJobs[projectId][sceneNum]

GET /api/render/:id/veo/:sceneNum/status
  - Returns veoSceneJobs[projectId]?.[sceneNum] or file-existence check

POST /api/render/:id/veo-animate-all
  - Queues all scenes with image_status=completed and no videos/{n}.mp4
  - Runs concurrently (up to 2 workers — Veo has quota constraints)
  - Returns { total, queued }
```

**In-memory job store** (per scene):
```ts
type VeoSceneJob = {
  status: "animating" | "done" | "failed";
  error?: string;
}
veoSceneJobs: Record<string, Record<number, VeoSceneJob>>
```

**Frontend: `src/pages/ProjectStatus.tsx`**

Per-scene row, when `image_status === "completed"`:
- If `videos/{n}.mp4` exists (checked via a scene field or API): show "Animated ✓" badge
- If Veo job in progress: show spinner "Animating..."
- Otherwise: show "Animate" button that calls `POST /api/render/:id/veo/:sceneNum`
- Frontend polls `GET /api/render/:id/veo/:sceneNum/status` every 3s while animating

### Audio sync
Handled by existing `buildVeoClip` in `render.ts`:
- `speed = veoDur / audioDur` where `veoDur` is always ≤ 8s
- If `audioDur > 8`: speed < 1.0 → `setpts=PTS/${speed}` slows video down
- If `audioDur ≤ 8`: video is trimmed to audio duration via FFmpeg `-t`
- No looping at any point

### Scene status tracking
Add `video_status: "none" | "animating" | "completed" | "failed"` and `video_error: string | null` to the DB schema (`shared/schema.ts`) and scene select responses. This lets the frontend persist animation state across page reloads.

---

## 4. ErrorLog Redesign

### New error type
`ErrorEntry.type` gains `"video"` as a valid value. Video errors come from `video_status === "failed"` scenes.

### Layout
Replace flat `<Table>` with project-grouped accordion:
- Each project = one collapsible `<AccordionItem>` showing project title + error count badge
- Inside: a compact table of errors for that project (scene#, type, attempts, error text, retry button)
- Default: all items open if total errors ≤ 10, else collapsed

### Summary cards (4 total)
1. Total Errors
2. Image Failures  
3. Audio Failures
4. Video Failures (new)

### Filter
Dropdown gains `"video"` option alongside existing `"all"`, `"image"`, `"audio"`.

### Retry buttons
Per error row:
- Image error: calls `POST /api/projects/:id/regenerate` with `{ sceneNumbers: [n], type: "image" }`
- Audio error: calls same with `type: "audio"`
- Video error: calls `POST /api/render/:id/veo/:sceneNum`
- On success: removes entry from local error list and shows a toast

---

## Data Flow Summary

```
User clicks "Animate" on scene N
  → POST /api/render/:projectId/veo/:N
  → server reads uploads/{id}/images/N.png + scene.image_prompt
  → Vertex AI veo-3.0-fast-preview (predictLongRunning)
  → poll until done (≤5 min)
  → save video to uploads/{id}/videos/N.mp4
  → update scene: video_status="completed"
  → frontend polls status, shows "Animated ✓"

Later: POST /api/render/:id/clips
  → for scene N: finds videos/N.mp4 → uses buildVeoClip()
  → if audioDur > 8s: setpts slows video; no loop
  → output: clips/N.mp4
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/providers.ts` | Add `skipImageGeneration` to interface + defaults |
| `src/lib/api.ts` | Skip image gen when flag set |
| `src/pages/Settings.tsx` | Toggle switch in Providers tab |
| `src/pages/VideoGen.tsx` | Delete |
| `src/pages/ImageToVideo.tsx` | Delete |
| `src/pages/TextSplitter.tsx` | Delete |
| `src/App.tsx` | Remove 3 routes + imports |
| `src/components/AppSidebar.tsx` | Remove 3 nav items |
| `src/pages/ProjectStatus.tsx` | Per-scene Animate button + polling |
| `src/pages/ErrorLog.tsx` | Full redesign (accordion, retry, video type) |
| `shared/schema.ts` | Add `video_status`, `video_error` columns |
| `server/lib/veo.ts` | New — Vertex AI Veo integration |
| `server/routes/render.ts` | New Veo routes + veoSceneJobs store |
| `server/routes/projects.ts` | No change needed (images are always client-side) |
