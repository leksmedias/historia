# Render Jobs Persistence + Video Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist render job state to PostgreSQL at start/done/fail checkpoints so server restarts don't lose progress, and add a Video tab to the ProjectPreview page that plays the final output.mp4 natively in the browser.

**Architecture:** A new `render_jobs` table stores one row per `(project_id, type)` using upsert. A shared `upsertJobStatus()` helper in `render.ts` writes at job lifecycle points. The four status GET endpoints are updated to check the DB when no in-memory job exists. On the frontend, a tab bar above the image viewer toggles between the existing scene slideshow and a native HTML5 `<video>` element; the Video tab auto-appears when render status transitions to `"done"`.

**Tech Stack:** Drizzle ORM (upsert with onConflictDoUpdate), PostgreSQL, React useState/useEffect, native HTML5 `<video controls>`

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modified | `shared/schema.ts` | Add `renderJobs` table with unique index |
| Modified | `server/routes/render.ts` | Add `upsertJobStatus`, DB writes at lifecycle points, DB fallback in status endpoints |
| Modified | `src/pages/ProjectPreview.tsx` | Add `activeTab` state, tab bar UI, video element |

---

## Task 1: Add render_jobs table to schema

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Update the import line**

Open `shared/schema.ts`. Replace the first import line with:

```ts
import { pgTable, text, integer, boolean, timestamp, jsonb, uuid, serial, uniqueIndex } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Append the renderJobs table**

Add this after the `admin` table at the bottom of `shared/schema.ts`:

```ts
export const renderJobs = pgTable("render_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  project_id: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  status: text("status").notNull(),
  resolution: text("resolution"),
  total: integer("total"),
  error: text("error"),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (table) => ({
  projectTypeIdx: uniqueIndex("render_jobs_project_type_idx").on(table.project_id, table.type),
}));
```

- [ ] **Step 3: Push schema to database**

```bash
npm run db:push
```

Expected: Drizzle prints that `render_jobs` table was created and the unique index applied. No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add render_jobs table for persistent job state"
```

---

## Task 2: Add upsertJobStatus helper and DB writes

**Files:**
- Modify: `server/routes/render.ts`

- [ ] **Step 1: Update imports at top of render.ts**

Replace the existing import lines at the top of `server/routes/render.ts`:

```ts
import express, { Request, Response } from "express";
import { db } from "../db.js";
import { projects, scenes, renderJobs } from "../../shared/schema.js";
import { eq, and } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { execSync, spawn } from "child_process";
import archiver from "archiver";
import { generateVeoClip } from "../lib/veo.js";
```

- [ ] **Step 2: Add upsertJobStatus helper**

Add this function immediately after the `const router = express.Router();` line and before the Ken Burns section:

```ts
async function upsertJobStatus(
  projectId: string,
  type: "clip" | "merge" | "animate" | "auto",
  status: "running" | "done" | "failed",
  opts: { resolution?: string; total?: number; error?: string | null } = {}
): Promise<void> {
  try {
    await db.insert(renderJobs).values({
      project_id: projectId,
      type,
      status,
      resolution: opts.resolution ?? null,
      total: opts.total ?? null,
      error: opts.error ?? null,
      updated_at: new Date(),
    }).onConflictDoUpdate({
      target: [renderJobs.project_id, renderJobs.type],
      set: {
        status,
        resolution: opts.resolution ?? null,
        total: opts.total ?? null,
        error: opts.error ?? null,
        updated_at: new Date(),
      },
    });
  } catch (e) {
    console.error(`[render-jobs] upsert failed for ${projectId}/${type}:`, e);
  }
}
```

- [ ] **Step 3: Add DB write at clip job start**

In `POST /:id/clips`, find these two lines:

```ts
clipJobs[projectId] = { status: "generating", progress: 0, done: 0, total: ready.length, resolution: resKey };
res.json({ success: true, total: ready.length, resolution: resKey });
```

Replace with:

```ts
clipJobs[projectId] = { status: "generating", progress: 0, done: 0, total: ready.length, resolution: resKey };
await upsertJobStatus(projectId, "clip", "running", { resolution: resKey, total: ready.length });
res.json({ success: true, total: ready.length, resolution: resKey });
```

- [ ] **Step 4: Add DB write at clip job done/fail**

In `server/routes/render.ts`, find the `.catch()` after `generateClips(...)`:

```ts
generateClips(projectId, ready, W, H).catch(e => {
  console.error(`[clips] ${projectId} failed:`, e.message);
  clipJobs[projectId] = { ...clipJobs[projectId], status: "failed", error: e.message };
});
```

Replace with:

```ts
generateClips(projectId, ready, W, H).catch(e => {
  console.error(`[clips] ${projectId} failed:`, e.message);
  clipJobs[projectId] = { ...clipJobs[projectId], status: "failed", error: e.message };
  upsertJobStatus(projectId, "clip", "failed", { error: e.message });
});
```

Then in `generateClips()` function, find the final line:

```ts
clipJobs[projectId] = { ...clipJobs[projectId], status: "done", progress: 100 };
console.log(`[clips] ${projectId}: all clips done → ${clipsDir}`);
```

Replace with:

```ts
clipJobs[projectId] = { ...clipJobs[projectId], status: "done", progress: 100 };
await upsertJobStatus(projectId, "clip", "done", { total: total });
console.log(`[clips] ${projectId}: all clips done → ${clipsDir}`);
```

- [ ] **Step 5: Add DB write at merge job start/done/fail**

In `POST /:id`, find:

```ts
mergeJobs[projectId] = { status: "rendering", progress: 0, total: ready.length, resolution: resKey };
res.json({ success: true, total: ready.length, resolution: resKey });
```

Replace with:

```ts
mergeJobs[projectId] = { status: "rendering", progress: 0, total: ready.length, resolution: resKey };
await upsertJobStatus(projectId, "merge", "running", { resolution: resKey, total: ready.length });
res.json({ success: true, total: ready.length, resolution: resKey });
```

Find the `.catch()` after `mergeVideo(...)`:

```ts
mergeVideo(projectId, ready, W, H).catch(e => {
  console.error(`[merge] ${projectId} failed:`, e.message);
  mergeJobs[projectId] = { ...mergeJobs[projectId], status: "failed", error: e.message };
});
```

Replace with:

```ts
mergeVideo(projectId, ready, W, H).catch(e => {
  console.error(`[merge] ${projectId} failed:`, e.message);
  mergeJobs[projectId] = { ...mergeJobs[projectId], status: "failed", error: e.message };
  upsertJobStatus(projectId, "merge", "failed", { error: e.message });
});
```

In `mergeVideo()` function, find:

```ts
mergeJobs[projectId] = { status: "done", progress: 100, total: sceneList.length, resolution: mergeJobs[projectId].resolution };
console.log(`[merge] ${projectId}: done → ${outPath}`);
```

Replace with:

```ts
mergeJobs[projectId] = { status: "done", progress: 100, total: sceneList.length, resolution: mergeJobs[projectId].resolution };
await upsertJobStatus(projectId, "merge", "done", { total: sceneList.length });
console.log(`[merge] ${projectId}: done → ${outPath}`);
```

- [ ] **Step 6: Add DB write at animate job start/done/fail**

In `POST /:id/animate`, find:

```ts
animateJobs[projectId] = {
  status: "animating",
  progress: 0,
  done: 0,
  total: toAnimate.length,
  sceneErrors: {},
};

res.json({ success: true, total: toAnimate.length });
```

Replace with:

```ts
animateJobs[projectId] = {
  status: "animating",
  progress: 0,
  done: 0,
  total: toAnimate.length,
  sceneErrors: {},
};
await upsertJobStatus(projectId, "animate", "running", { total: toAnimate.length });
res.json({ success: true, total: toAnimate.length });
```

Find the `.catch()` after `runVeoAnimation(...)`:

```ts
runVeoAnimation(projectId, toAnimate).catch(e => {
  console.error(`[veo] ${projectId} failed:`, e.message);
  if (animateJobs[projectId]) {
    animateJobs[projectId] = { ...animateJobs[projectId], status: "failed", error: e.message };
  }
});
```

Replace with:

```ts
runVeoAnimation(projectId, toAnimate).catch(e => {
  console.error(`[veo] ${projectId} failed:`, e.message);
  if (animateJobs[projectId]) {
    animateJobs[projectId] = { ...animateJobs[projectId], status: "failed", error: e.message };
  }
  upsertJobStatus(projectId, "animate", "failed", { error: e.message });
});
```

In `runVeoAnimation()` function, find:

```ts
job.status = "done";
job.progress = 100;
console.log(`[veo] ${projectId}: animation complete`);
```

Replace with:

```ts
job.status = "done";
job.progress = 100;
await upsertJobStatus(projectId, "animate", "done", { total: total });
console.log(`[veo] ${projectId}: animation complete`);
```

- [ ] **Step 7: Add DB write at auto job start/done/fail**

In `POST /:id/auto`, find:

```ts
res.json({ success: true, message: "Auto pipeline started in background" });
runAutoPipeline(projectId, resKey).catch(e => {
  console.error(`[auto] ${projectId} failed:`, e.message);
  if (autoJobs[projectId]) autoJobs[projectId] = { ...autoJobs[projectId], status: "failed", error: e.message };
});
```

Replace with:

```ts
await upsertJobStatus(projectId, "auto", "running", { resolution: resKey });
res.json({ success: true, message: "Auto pipeline started in background" });
runAutoPipeline(projectId, resKey).catch(e => {
  console.error(`[auto] ${projectId} failed:`, e.message);
  if (autoJobs[projectId]) autoJobs[projectId] = { ...autoJobs[projectId], status: "failed", error: e.message };
  upsertJobStatus(projectId, "auto", "failed", { error: e.message });
});
```

In `runAutoPipeline()` function, find:

```ts
autoJobs[projectId].status = "done";
console.log(`[auto] ${projectId}: pipeline complete`);
```

Replace with:

```ts
autoJobs[projectId].status = "done";
await upsertJobStatus(projectId, "auto", "done");
console.log(`[auto] ${projectId}: pipeline complete`);
```

- [ ] **Step 8: Commit**

```bash
git add server/routes/render.ts
git commit -m "feat: persist render job state to DB at start/done/fail"
```

---

## Task 3: Update status endpoints to use DB fallback

**Files:**
- Modify: `server/routes/render.ts`

- [ ] **Step 1: Update clips status endpoint**

Replace the entire `GET /:id/clips/status` handler:

```ts
/** GET /api/render/:id/clips/status */
router.get("/:id/clips/status", async (req: Request, res: Response) => {
  const projectId = req.params.id as string;

  // 1. In-memory job (authoritative during active run)
  const job = clipJobs[projectId];
  if (job) return res.json(job);

  // 2. DB row (survives restarts)
  try {
    const [dbJob] = await db.select().from(renderJobs)
      .where(and(eq(renderJobs.project_id, projectId), eq(renderJobs.type, "clip")));
    if (dbJob) {
      if (dbJob.status === "running") {
        await upsertJobStatus(projectId, "clip", "failed", { error: "Server restarted mid-job — please re-run" });
        return res.json({ status: "failed", error: "Server restarted mid-job — please re-run" });
      }
      if (dbJob.status === "done") {
        return res.json({ status: "done", progress: 100, done: dbJob.total ?? 0, total: dbJob.total ?? 0, resolution: dbJob.resolution ?? "unknown" });
      }
      if (dbJob.status === "failed") {
        return res.json({ status: "failed", error: dbJob.error ?? "Unknown error" });
      }
    }
  } catch { /* fall through to filesystem */ }

  // 3. Filesystem fallback
  const clipsDir = path.join("uploads", projectId, "clips");
  if (fs.existsSync(clipsDir)) {
    const clips = fs.readdirSync(clipsDir).filter(f => f.endsWith(".mp4"));
    if (clips.length > 0) {
      return res.json({ status: "done", progress: 100, done: clips.length, total: clips.length, resolution: "unknown" });
    }
  }
  res.json({ status: "idle" });
});
```

- [ ] **Step 2: Update merge status endpoint**

Replace the entire `GET /:id/status` handler:

```ts
/** GET /api/render/:id/status */
router.get("/:id/status", async (req: Request, res: Response) => {
  const projectId = req.params.id as string;

  const job = mergeJobs[projectId];
  if (job) return res.json(job);

  try {
    const [dbJob] = await db.select().from(renderJobs)
      .where(and(eq(renderJobs.project_id, projectId), eq(renderJobs.type, "merge")));
    if (dbJob) {
      if (dbJob.status === "running") {
        await upsertJobStatus(projectId, "merge", "failed", { error: "Server restarted mid-job — please re-run" });
        return res.json({ status: "failed", error: "Server restarted mid-job — please re-run" });
      }
      if (dbJob.status === "done") {
        return res.json({ status: "done", progress: 100, total: dbJob.total ?? 0, resolution: dbJob.resolution ?? "unknown" });
      }
      if (dbJob.status === "failed") {
        return res.json({ status: "failed", error: dbJob.error ?? "Unknown error" });
      }
    }
  } catch { /* fall through to filesystem */ }

  const outPath = path.join("uploads", projectId, "render", "output.mp4");
  if (fs.existsSync(outPath)) return res.json({ status: "done", progress: 100, total: 0, resolution: "unknown" });
  res.json({ status: "idle" });
});
```

- [ ] **Step 3: Update animate status endpoint**

Replace the entire `GET /:id/animate/status` handler:

```ts
/** GET /api/render/:id/animate/status */
router.get("/:id/animate/status", async (req: Request, res: Response) => {
  const projectId = req.params.id as string;
  const videosDir = path.join("uploads", projectId, "videos");

  const getAnimatedNums = (): number[] => {
    if (!fs.existsSync(videosDir)) return [];
    return fs.readdirSync(videosDir)
      .filter(f => f.endsWith(".mp4"))
      .map(f => parseInt(f))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
  };

  const job = animateJobs[projectId];
  if (job) {
    const animatedSceneNums = getAnimatedNums();
    return res.json({ ...job, animatedSceneNums });
  }

  // DB fallback — only used for "running" reboot detection
  try {
    const [dbJob] = await db.select().from(renderJobs)
      .where(and(eq(renderJobs.project_id, projectId), eq(renderJobs.type, "animate")));
    if (dbJob?.status === "running") {
      await upsertJobStatus(projectId, "animate", "failed", { error: "Server restarted mid-job — please re-run" });
      return res.json({ status: "failed", error: "Server restarted mid-job — please re-run", done: 0, total: 0, sceneErrors: {}, animatedSceneNums: [] });
    }
  } catch { /* fall through */ }

  // Filesystem fallback
  const animatedSceneNums = getAnimatedNums();
  if (animatedSceneNums.length > 0) {
    return res.json({ status: "done", progress: 100, done: animatedSceneNums.length, total: animatedSceneNums.length, sceneErrors: {}, animatedSceneNums });
  }
  res.json({ status: "idle", done: 0, total: 0, sceneErrors: {}, animatedSceneNums: [] });
});
```

- [ ] **Step 4: Update auto status endpoint**

Replace the entire `GET /:id/auto/status` handler:

```ts
/** GET /api/render/:id/auto/status */
router.get("/:id/auto/status", async (req: Request, res: Response) => {
  const projectId = req.params.id as string;

  const job = autoJobs[projectId];
  if (job) return res.json(job);

  try {
    const [dbJob] = await db.select().from(renderJobs)
      .where(and(eq(renderJobs.project_id, projectId), eq(renderJobs.type, "auto")));
    if (dbJob) {
      if (dbJob.status === "running") {
        await upsertJobStatus(projectId, "auto", "failed", { error: "Server restarted mid-job — please re-run" });
        return res.json({ status: "failed", error: "Server restarted mid-job — please re-run" });
      }
      if (dbJob.status === "done") return res.json({ status: "done", resolution: dbJob.resolution ?? "unknown" });
      if (dbJob.status === "failed") return res.json({ status: "failed", error: dbJob.error ?? "Unknown error" });
    }
  } catch { /* fall through */ }

  const outPath = path.join("uploads", projectId, "render", "output.mp4");
  if (fs.existsSync(outPath)) return res.json({ status: "done", resolution: "unknown" });
  res.json({ status: "idle" });
});
```

- [ ] **Step 5: Verify server starts**

```bash
npm run server
```

Expected: `Server running on port` printed. No TypeScript errors. Kill with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add server/routes/render.ts
git commit -m "feat: add DB fallback to render status endpoints"
```

---

## Task 4: Add video player tab to ProjectPreview

**Files:**
- Modify: `src/pages/ProjectPreview.tsx`

- [ ] **Step 1: Add activeTab state**

In `src/pages/ProjectPreview.tsx`, find the block of `useState` declarations near the top of the component (around line 40, after `const [showDownloads, setShowDownloads]`). Add this line:

```ts
const [activeTab, setActiveTab] = useState<"scenes" | "video">("scenes");
```

- [ ] **Step 2: Add useEffect to auto-switch to video tab**

Find the block of `useEffect` hooks. After the existing render state restore `useEffect` (the one that calls `getRenderStatus`), add:

```ts
useEffect(() => {
  if (renderStatus === "done") {
    setActiveTab("video");
    toast.success("Video ready — watching now");
  }
}, [renderStatus]);
```

- [ ] **Step 3: Add tab bar above the image viewer**

Find this line in the JSX (it starts the image viewer section):

```tsx
{/* Image viewer */}
<div className="flex-1 relative bg-background flex items-center justify-center overflow-hidden">
```

Insert the tab bar immediately before it:

```tsx
{/* Tab bar */}
<div className="flex border-b border-border bg-card shrink-0">
  <button
    onClick={() => setActiveTab("scenes")}
    className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
      activeTab === "scenes"
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`}
  >
    Scenes
  </button>
  {renderStatus === "done" && (
    <button
      onClick={() => setActiveTab("video")}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        activeTab === "video"
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      Video
    </button>
  )}
</div>
```

- [ ] **Step 4: Replace image viewer with conditional render**

Find and replace the image viewer div and its content:

```tsx
{/* Image viewer */}
<div className="flex-1 relative bg-background flex items-center justify-center overflow-hidden">
  {imgUrl ? (
    <img src={imgUrl} alt={`Scene ${scene.scene_number}`} className="max-w-full max-h-full object-contain" />
  ) : (
    <div className="flex flex-col items-center gap-2 text-muted-foreground">
      <ImageIcon className="h-16 w-16" />
      <span className="text-sm">No image generated</span>
    </div>
  )}
  {/* Subtitle overlay */}
  <div className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[80%] px-4 py-2 bg-background/80 backdrop-blur-sm rounded-lg">
    <p className="text-sm text-foreground text-center leading-relaxed">{scene.script_text}</p>
  </div>
</div>
```

Replace with:

```tsx
{/* Image viewer / Video player */}
{activeTab === "video" ? (
  <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
    <video
      key={projectId}
      src={`/uploads/${projectId}/render/output.mp4`}
      controls
      className="w-full h-full object-contain"
    />
  </div>
) : (
  <div className="flex-1 relative bg-background flex items-center justify-center overflow-hidden">
    {imgUrl ? (
      <img src={imgUrl} alt={`Scene ${scene.scene_number}`} className="max-w-full max-h-full object-contain" />
    ) : (
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <ImageIcon className="h-16 w-16" />
        <span className="text-sm">No image generated</span>
      </div>
    )}
    {/* Subtitle overlay */}
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 max-w-[80%] px-4 py-2 bg-background/80 backdrop-blur-sm rounded-lg">
      <p className="text-sm text-foreground text-center leading-relaxed">{scene.script_text}</p>
    </div>
  </div>
)}
```

- [ ] **Step 5: Hide audio controls and timeline when video tab is active**

Find the audio controls section:

```tsx
{/* Audio controls */}
<div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-card">
```

Wrap it and the timeline section in a conditional. Find the full block from `{/* Audio controls */}` through the closing `</div>` of `{/* Horizontal timeline */}` and wrap both like this:

```tsx
{activeTab === "scenes" && (
  <>
    {/* Audio controls */}
    <div className="flex items-center gap-3 px-4 py-3 border-t border-border bg-card">
      {/* ... existing audio controls content unchanged ... */}
    </div>

    {/* Horizontal timeline */}
    <div className="border-t border-border bg-card px-2 pt-2 shrink-0" style={{ height: "90px" }}>
      {/* ... existing timeline content unchanged ... */}
    </div>
  </>
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectPreview.tsx
git commit -m "feat: add video player tab to ProjectPreview page"
```

---

## Task 5: Build and smoke-test

- [ ] **Step 1: Build the frontend**

```bash
npm run build
```

Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 2: Run the test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 3: Manual verification checklist**

Start the server (`npm run server`) and open the app. Verify:

1. Navigate to any project → Preview page
2. The **Scenes** tab is selected by default, image viewer works as before
3. The **Video** tab does NOT appear when render hasn't been done
4. Start a clip generation → Merge → when merge completes, the **Video** tab appears automatically and the page switches to it
5. The video player loads and plays `output.mp4`
6. Switching back to **Scenes** tab shows the image viewer and audio controls
7. The timeline and audio playback still work on the Scenes tab

To test reboot recovery:
1. Start a clip generation job
2. Kill the server (`Ctrl+C`) while it's running
3. Restart the server
4. Open the preview page for that project
5. The clips status should show `failed` with "Server restarted mid-job" (not stuck in "generating")

- [ ] **Step 4: Push**

```bash
git push origin main
```
