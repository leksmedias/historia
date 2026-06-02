# Reboot-Safe Render Jobs + In-Browser Video Player — Design Spec
**Date:** 2026-06-02
**Status:** Approved

## Overview

Two features:
1. **Reboot-safe render jobs** — persist clip/merge/animate/auto job state to PostgreSQL at key checkpoints (start, done, fail) so server restarts don't lose progress. Live progress during execution continues to use in-memory state + filesystem fallbacks.
2. **In-browser video player** — a "Video" tab on the ProjectPreview page plays the final `output.mp4` directly in the browser using a native HTML5 `<video>` element. Appears automatically when a render completes.

---

## 1. Database

New `render_jobs` table in `shared/schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid, PK | auto-generated |
| `project_id` | text, FK → projects | cascade delete |
| `type` | text, not null | `"clip"` \| `"merge"` \| `"animate"` \| `"auto"` |
| `status` | text, not null | `"running"` \| `"done"` \| `"failed"` |
| `resolution` | text, nullable | e.g. `"1080p"` |
| `total` | integer, nullable | total scene count |
| `error` | text, nullable | error message on failure |
| `started_at` | timestamp | set on upsert |
| `updated_at` | timestamp | updated on every write |

**Unique constraint:** explicit `uniqueIndex("render_jobs_project_type_idx", ["project_id", "type"])` on `(project_id, type)` — one active row per job type per project. All writes use upsert (`ON CONFLICT (project_id, type) DO UPDATE`).

Schema change: `npm run db:push` after editing `shared/schema.ts`.

---

## 2. Server — Render Jobs Persistence

### When to write to DB

| Event | DB action |
|-------|-----------|
| Job starts | Upsert `status=running`, `resolution`, `total`, clear `error` |
| Job completes | Update `status=done`, `updated_at` |
| Job fails | Update `status=failed`, `error=message` |

No writes during progress updates — progress percentage comes from in-memory counters and filesystem counts.

### Status endpoint resolution order

All four status endpoints (`/clips/status`, `/status`, `/animate/status`, `/auto/status`) resolve state using this priority:

1. **In-memory job** — fastest, authoritative during active run
2. **DB row** — survives server restart; if `status=running` in DB but no in-memory job, means server rebooted mid-job → return `{ status: "failed", error: "Server restarted mid-job" }` and update DB to `failed`
3. **Filesystem fallback** — existing logic (count files in `clips/`, check `output.mp4` exists) — used if no DB row

### Files changed

- `shared/schema.ts` — add `render_jobs` table
- `server/routes/render.ts` — add DB writes at job start/done/fail; update status endpoints to check DB

### Helper function

A shared helper in `render.ts`:

```ts
async function upsertJobStatus(
  projectId: string,
  type: "clip" | "merge" | "animate" | "auto",
  status: "running" | "done" | "failed",
  opts?: { resolution?: string; total?: number; error?: string }
): Promise<void>
```

Called at the start, end, and failure of `generateClips()`, `mergeVideo()`, `runVeoAnimation()`, and `runAutoPipeline()`.

---

## 3. Frontend — Video Player Tab

### Location

`src/pages/ProjectPreview.tsx` — the main image viewer area gets a tab bar above it.

### Tab bar

Two tabs rendered above the image/video area:

- **Scenes** — always visible, selected by default
- **Video** — only rendered when `renderStatus === "done"`

Tab state: local `useState<"scenes" | "video">` defaulting to `"scenes"`. A `useEffect` watches `renderStatus` — when it transitions to `"done"`, auto-switch to `"video"` tab and show a toast: `"Video ready — watching now"`.

### Video tab content

```html
<video
  src="/uploads/{projectId}/render/output.mp4"
  controls
  className="w-full h-full object-contain bg-black"
/>
```

- Native browser controls (play/pause, seek, volume, fullscreen)
- No custom player code needed
- Served by existing Express static handler at `/uploads/*`
- Audio controls bar and scene timeline are hidden when Video tab is active

### Scenes tab

Identical to current behavior — image viewer, subtitle overlay, audio controls bar, scene timeline at bottom. No changes to existing code paths.

### Download buttons

Stay in the top bar and work regardless of active tab.

---

## 4. Files Changed / Created

| Action | File |
|--------|------|
| Modified | `shared/schema.ts` |
| Modified | `server/routes/render.ts` |
| Modified | `src/pages/ProjectPreview.tsx` |

---

## 5. Constraints

- The `render_jobs` table uses upsert — re-running a render on the same project simply overwrites the previous row for that job type
- A `running` DB row with no in-memory job means the server rebooted — the endpoint reports it as `failed` and updates the DB accordingly so the user can retry
- The video player uses native `<video controls>` — no external library required
- `/uploads/*` is already served as static files by Express with no auth check (intentional — needed by the render pipeline)
