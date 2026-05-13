# Veo Animation, Image Toggle, Page Cleanup & ErrorLog Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Veo 3.1 lite image-to-video animation per scene, a toggle to skip image generation, remove three unused pages, and redesign the ErrorLog with project-grouped accordion and retry buttons.

**Architecture:** The existing `/api/render/:id/animate` endpoint currently returns 501; we implement it with Vertex AI Veo via `predictLongRunning`, storing clips in `uploads/{id}/videos/{n}.mp4` (the render pipeline already prefers this path over still images). Image toggle is a boolean in `ProviderSettings` that the client-side pipeline respects. ErrorLog gains `video` error type sourced from new `video_status`/`video_error` DB columns.

**Tech Stack:** Express 5, Drizzle ORM, Vertex AI (Veo 3.0-fast-preview via gcloud auth), React 18, Vitest (jsdom), shadcn/ui (Switch, Accordion), FFmpeg (existing).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `shared/schema.ts` | Modify | Add `video_status`, `video_error` columns to scenes table |
| `src/lib/types.ts` | Modify | Add `video_status`, `video_error` to Scene interface |
| `src/pages/VideoGen.tsx` | Delete | Remove unused page |
| `src/pages/ImageToVideo.tsx` | Delete | Remove unused page |
| `src/pages/TextSplitter.tsx` | Delete | Remove unused page |
| `src/App.tsx` | Modify | Remove 3 routes + imports |
| `src/components/AppSidebar.tsx` | Modify | Remove 3 nav items |
| `src/lib/providers.ts` | Modify | Add `skipImageGeneration: boolean` to ProviderSettings |
| `src/lib/api.ts` | Modify | Skip image gen when `skipImageGeneration=true` |
| `src/pages/Settings.tsx` | Modify | Add toggle switch in Providers → Image Generation card |
| `server/lib/veo.ts` | Create | Vertex AI Veo 3.0-fast-preview image-to-video integration |
| `server/routes/render.ts` | Modify | Implement `POST /:id/animate` using Veo; add `runVeoAnimation` |
| `src/pages/ErrorLog.tsx` | Modify | Project-grouped accordion, retry buttons, video error type |
| `src/test/providers.test.ts` | Create | Test `skipImageGeneration` default and persistence |

---

## Task 1: DB Schema — add video_status and video_error

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Add columns to the scenes table**

Open `shared/schema.ts` and add two columns after `audio_error`:

```typescript
// existing line:
  audio_error: text("audio_error"),
// add after it:
  video_status: text("video_status").notNull().default("none"),
  video_error: text("video_error"),
```

The full updated `scenes` table definition (only the changed portion):

```typescript
  audio_attempts: integer("audio_attempts").notNull().default(0),
  image_error: text("image_error"),
  audio_error: text("audio_error"),
  video_status: text("video_status").notNull().default("none"),
  video_error: text("video_error"),
  needs_review: boolean("needs_review").notNull().default(false),
```

- [ ] **Step 2: Push schema to the database**

```bash
npm run db:push
```

Expected: Drizzle prints something like `[✓] Changes applied` or `No schema changes`. If it prompts for confirmation, type `y`.

- [ ] **Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add video_status and video_error columns to scenes"
```

---

## Task 2: Update Scene type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add fields to the Scene interface**

In `src/lib/types.ts`, update the `Scene` interface. Find the `audio_error` line and add two fields after it:

```typescript
  audio_error: string | null;
  video_status: "none" | "animating" | "completed" | "failed";
  video_error: string | null;
  needs_review: boolean;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -20
```

Expected: no errors about `video_status` or `video_error`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add video_status and video_error to Scene type"
```

---

## Task 3: Remove VideoGen, ImageToVideo, TextSplitter pages

**Files:**
- Delete: `src/pages/VideoGen.tsx`, `src/pages/ImageToVideo.tsx`, `src/pages/TextSplitter.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppSidebar.tsx`

- [ ] **Step 1: Delete the three page files**

```bash
rm src/pages/VideoGen.tsx src/pages/ImageToVideo.tsx src/pages/TextSplitter.tsx
```

- [ ] **Step 2: Remove routes from App.tsx**

In `src/App.tsx`, remove these three import lines:
```typescript
import TextSplitter from "./pages/TextSplitter";
import VideoGen from "./pages/VideoGen";
import ImageToVideo from "./pages/ImageToVideo";
```

And remove these three `<Route>` elements:
```tsx
<Route path="/text-splitter" element={<TextSplitter />} />
<Route path="/video-gen" element={<VideoGen />} />
<Route path="/image-to-video" element={<ImageToVideo />} />
```

- [ ] **Step 3: Remove nav items from AppSidebar.tsx**

In `src/components/AppSidebar.tsx`, remove these three entries from the `items` array:
```typescript
  { title: "Video Gen", url: "/video-gen", icon: Video },
  { title: "Image to Video", url: "/image-to-video", icon: ImagePlay },
  { title: "Text Splitter", url: "/text-splitter", icon: Scissors },
```

Also remove unused icon imports (`Video`, `ImagePlay`, `Scissors`) from the lucide-react import line.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | head -30
```

Expected: no import errors for the removed pages.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/AppSidebar.tsx
git commit -m "feat: remove VideoGen, ImageToVideo, TextSplitter pages from nav and routing"
```

---

## Task 4: Image generation toggle

**Files:**
- Create: `src/test/providers.test.ts`
- Modify: `src/lib/providers.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/test/providers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { loadProviderSettings, saveProviderSettings } from "../lib/providers";

describe("skipImageGeneration setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false when no settings saved", () => {
    const settings = loadProviderSettings();
    expect(settings.skipImageGeneration).toBe(false);
  });

  it("persists true when saved", () => {
    saveProviderSettings({ ...loadProviderSettings(), skipImageGeneration: true });
    const loaded = loadProviderSettings();
    expect(loaded.skipImageGeneration).toBe(true);
  });

  it("persists false when saved", () => {
    saveProviderSettings({ ...loadProviderSettings(), skipImageGeneration: false });
    const loaded = loadProviderSettings();
    expect(loaded.skipImageGeneration).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/providers.test.ts
```

Expected: FAIL — `skipImageGeneration` is undefined (field doesn't exist yet).

- [ ] **Step 3: Add skipImageGeneration to providers.ts**

In `src/lib/providers.ts`, add `skipImageGeneration: boolean` to the `ProviderSettings` interface after `customVoices`:

```typescript
export interface ProviderSettings {
  imageProvider: string;
  ttsProvider: string;
  voiceId: string;
  modelId: string;
  imageConcurrency: number;
  audioConcurrency: number;
  groqApiKey: string;
  anthropicApiKey: string;
  claudeModel: string;
  inworldApiKey: string;
  customVoices: CustomVoice[];
  skipImageGeneration: boolean;
}
```

Add the default in `DEFAULTS`:

```typescript
const DEFAULTS: ProviderSettings = {
  imageProvider: "gemini",
  ttsProvider: "inworld",
  voiceId: "Dennis",
  modelId: "inworld-tts-1.5-max",
  imageConcurrency: 2,
  audioConcurrency: 2,
  groqApiKey: "",
  anthropicApiKey: "",
  claudeModel: "claude-haiku-4-5-20251001",
  inworldApiKey: "",
  customVoices: [],
  skipImageGeneration: false,
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/providers.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Update api.ts to respect the toggle**

In `src/lib/api.ts`, inside `runClientSidePipeline`, find the image generation block (around line 223). Change:

```typescript
    if (!imageAlreadyDone) {
```

to:

```typescript
    if (!imageAlreadyDone && !settings.skipImageGeneration) {
```

The `else` branch below it (for `imageAlreadyDone`) stays unchanged. When `skipImageGeneration=true` and not already done, the scene simply gets no image — no status update is sent.

- [ ] **Step 6: Add toggle switch to Settings.tsx**

In `src/pages/Settings.tsx`, add `Switch` to the import from `@/components/ui/switch`:

```typescript
import { Switch } from "@/components/ui/switch";
```

Inside the **Providers tab** (`activeTab === "providers"`), find the "Image Generation" `<Card>`. After the concurrency `<Slider>` block, add:

```tsx
<div className="flex items-center justify-between pt-1">
  <div>
    <label className="text-sm font-medium text-foreground">Generate Images</label>
    <p className="text-xs text-muted-foreground">Turn off to skip image generation for new projects</p>
  </div>
  <Switch
    checked={!settings.skipImageGeneration}
    onCheckedChange={(checked) => setSettings(s => ({ ...s, skipImageGeneration: !checked }))}
  />
</div>
```

- [ ] **Step 7: Commit**

```bash
git add src/test/providers.test.ts src/lib/providers.ts src/lib/api.ts src/pages/Settings.tsx
git commit -m "feat: add skipImageGeneration toggle to settings and client pipeline"
```

---

## Task 5: Veo server lib

**Files:**
- Create: `server/lib/veo.ts`

- [ ] **Step 1: Create the Veo integration file**

Create `server/lib/veo.ts` with the following content:

```typescript
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const PROJECT_ID = process.env.VERTEX_PROJECT_ID || "project-f3847793-8610-4a16-945";
const LOCATION_ID = process.env.VERTEX_LOCATION_ID || "europe-west4";
const VEO_MODEL = "veo-3.0-fast-preview";
const API_ENDPOINT = `${LOCATION_ID}-aiplatform.googleapis.com`;

function getAccessToken(): string {
  try {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Failed to get gcloud access token — run: gcloud auth application-default login --no-browser");
  }
}

/**
 * Animate an image to an 8-second video clip using Veo 3.0-fast-preview.
 * Saves the result to outPath. Throws on failure or timeout.
 *
 * Audio sync note: the caller (buildVeoClip in render.ts) handles
 * speed adjustment when audio > 8s via setpts — no looping needed.
 */
export async function generateVeoClip(
  imagePath: string,
  prompt: string,
  outPath: string
): Promise<void> {
  const imageBytes = fs.readFileSync(imagePath);
  const imageBase64 = imageBytes.toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";

  const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION_ID}/publishers/google/models/${VEO_MODEL}:predictLongRunning`;

  const body = {
    instances: [{
      prompt,
      image: { bytesBase64Encoded: imageBase64, mimeType },
    }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1,
      durationSeconds: 8,
    },
  };

  const token = getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Veo request failed: ${res.status} ${text}`);
  }

  const operation = (await res.json()) as { name: string };
  if (!operation.name) throw new Error("Veo returned no operation name");

  await pollVeoOperation(operation.name, outPath);
}

async function pollVeoOperation(operationName: string, outPath: string): Promise<void> {
  const pollUrl = `https://${API_ENDPOINT}/v1/${operationName}`;
  const MAX_POLLS = 60; // 60 × 5 s = 5 min max

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 5_000));

    const token = getAccessToken();
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!pollRes.ok) {
      throw new Error(`Veo poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }

    const op = (await pollRes.json()) as {
      done?: boolean;
      error?: { message: string };
      response?: { predictions: Array<{ bytesBase64Encoded: string }> };
    };

    if (op.error) throw new Error(`Veo generation failed: ${op.error.message}`);

    if (op.done) {
      const videoBase64 = op.response?.predictions?.[0]?.bytesBase64Encoded;
      if (!videoBase64) throw new Error("Veo returned no video data in predictions");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(videoBase64, "base64"));
      return;
    }
  }

  throw new Error("Veo generation timed out after 5 minutes");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|veo" | head -20
```

Expected: no TypeScript errors from `server/lib/veo.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/lib/veo.ts
git commit -m "feat: add Veo 3.0-fast-preview image-to-video integration"
```

---

## Task 6: Implement the animate endpoint with Veo

**Files:**
- Modify: `server/routes/render.ts`

- [ ] **Step 1: Add import for generateVeoClip**

At the top of `server/routes/render.ts`, after the existing imports, add:

```typescript
import { generateVeoClip } from "../lib/veo.js";
```

- [ ] **Step 2: Replace the 501 stub with Veo logic**

Find the current animate route (around line 347):

```typescript
router.post("/:id/animate", async (req: Request, res: Response) => {
  res.status(501).json({ error: "Video animation is not configured" });
});
```

Replace the entire function body with:

```typescript
router.post("/:id/animate", async (req: Request, res: Response) => {
  const projectId = req.params.id as string;
  const sceneNumbers: number[] = req.body?.scenes || [];

  try {
    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    const toAnimate = sceneNumbers.length > 0
      ? allScenes.filter(s => sceneNumbers.includes(s.scene_number) && s.image_status === "completed")
      : allScenes.filter(s => s.image_status === "completed");

    if (toAnimate.length === 0) {
      return res.status(400).json({ error: "No scenes with completed images to animate" });
    }

    animateJobs[projectId] = {
      status: "animating",
      progress: 0,
      done: 0,
      total: toAnimate.length,
      sceneErrors: {},
    };

    res.json({ success: true, total: toAnimate.length });

    runVeoAnimation(projectId, toAnimate).catch(e => {
      console.error(`[veo] ${projectId} failed:`, e.message);
      if (animateJobs[projectId]) {
        animateJobs[projectId] = { ...animateJobs[projectId], status: "failed", error: e.message };
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: Add runVeoAnimation function**

After the `generateClips` function (around line 629), add this new function:

```typescript
async function runVeoAnimation(projectId: string, sceneList: any[]): Promise<void> {
  const total = sceneList.length;
  let done = 0;
  let head = 0;
  const VEO_CONCURRENCY = 2;

  async function worker(): Promise<void> {
    while (true) {
      const idx = head++;
      if (idx >= sceneList.length) break;
      const s = sceneList[idx];
      const num = s.scene_number;

      const imgPath = findImageFile(projectId, num, s.image_file);
      if (!imgPath) {
        animateJobs[projectId].sceneErrors[num] = "Image file not found";
        animateJobs[projectId].progress = Math.round((++done / total) * 100);
        await db.update(scenes)
          .set({ video_status: "failed", video_error: "Image file not found" })
          .where(eq(scenes.id, s.id));
        continue;
      }

      const outPath = path.join("uploads", projectId, "videos", `${num}.mp4`);

      try {
        console.log(`[veo] ${projectId}: scene ${num} animating`);
        await generateVeoClip(imgPath, s.image_prompt || "", outPath);

        await db.update(scenes)
          .set({ video_status: "completed", video_error: null })
          .where(eq(scenes.id, s.id));

        animateJobs[projectId].done = ++done;
        animateJobs[projectId].progress = Math.round((done / total) * 100);
        console.log(`[veo] ${projectId}: scene ${num} done (${done}/${total})`);
      } catch (e: any) {
        console.error(`[veo] ${projectId}: scene ${num} failed:`, e.message);
        animateJobs[projectId].sceneErrors[num] = e.message;
        animateJobs[projectId].progress = Math.round((++done / total) * 100);

        await db.update(scenes)
          .set({ video_status: "failed", video_error: e.message })
          .where(eq(scenes.id, s.id));
      }
    }
  }

  await Promise.all(Array.from({ length: VEO_CONCURRENCY }, worker));
  animateJobs[projectId] = { ...animateJobs[projectId], status: "done", progress: 100 };
  console.log(`[veo] ${projectId}: animation complete`);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/render.ts
git commit -m "feat: implement Veo image-to-video animation in /api/render/:id/animate"
```

---

## Task 7: ErrorLog redesign

**Files:**
- Modify: `src/pages/ErrorLog.tsx`

This task fully replaces `src/pages/ErrorLog.tsx`. The new version groups errors by project in a collapsible accordion, adds a "Video Failures" summary card, a `video` filter option, and per-error retry buttons.

- [ ] **Step 1: Replace ErrorLog.tsx**

Replace the entire contents of `src/pages/ErrorLog.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ImageIcon, Volume2, RefreshCw, Video } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface ErrorEntry {
  id: string;
  project_id: string;
  project_title: string;
  scene_number: number;
  type: "image" | "audio" | "video";
  error: string;
  attempts: number;
  updated_at: string;
}

interface ProjectGroup {
  project_id: string;
  project_title: string;
  errors: ErrorEntry[];
}

async function retryError(entry: ErrorEntry): Promise<void> {
  if (entry.type === "video") {
    const res = await fetch(`/api/render/${entry.project_id}/animate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes: [entry.scene_number] }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  } else {
    const res = await fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: entry.project_id,
        sceneNumber: entry.scene_number,
        type: entry.type,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  }
}

export default function ErrorLog() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio" | "video">("all");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const fetchErrors = async () => {
    setLoading(true);
    try {
      const allProjects: any[] = await fetch("/api/projects").then(r => r.json());
      const entries: ErrorEntry[] = [];

      for (const proj of allProjects) {
        const { scenes } = await fetch(`/api/projects/${proj.id}`).then(r => r.json());
        for (const s of (scenes || [])) {
          if (s.image_status === "failed" && s.image_error) {
            entries.push({
              id: `${s.id}-img`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "image",
              error: s.image_error,
              attempts: s.image_attempts,
              updated_at: s.updated_at,
            });
          }
          if (s.audio_status === "failed" && s.audio_error) {
            entries.push({
              id: `${s.id}-aud`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "audio",
              error: s.audio_error,
              attempts: s.audio_attempts,
              updated_at: s.updated_at,
            });
          }
          if (s.video_status === "failed" && s.video_error) {
            entries.push({
              id: `${s.id}-vid`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "video",
              error: s.video_error,
              attempts: 1,
              updated_at: s.updated_at,
            });
          }
        }
      }

      entries.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setErrors(entries);
    } catch (e) {
      console.error("Failed to fetch errors:", e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchErrors(); }, []);

  const filtered = filter === "all" ? errors : errors.filter(e => e.type === filter);

  const groups: ProjectGroup[] = Object.values(
    filtered.reduce<Record<string, ProjectGroup>>((acc, e) => {
      if (!acc[e.project_id]) {
        acc[e.project_id] = { project_id: e.project_id, project_title: e.project_title, errors: [] };
      }
      acc[e.project_id].errors.push(e);
      return acc;
    }, {})
  );

  const defaultOpen = filtered.length <= 10 ? groups.map(g => g.project_id) : [];

  const imageFails = errors.filter(e => e.type === "image").length;
  const audioFails = errors.filter(e => e.type === "audio").length;
  const videoFails = errors.filter(e => e.type === "video").length;

  const handleRetry = async (entry: ErrorEntry) => {
    setRetrying(prev => new Set(prev).add(entry.id));
    try {
      await retryError(entry);
      setErrors(prev => prev.filter(e => e.id !== entry.id));
      toast.success(`Queued retry for scene ${entry.scene_number}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRetrying(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
    }
  };

  const typeIcon = (type: ErrorEntry["type"]) => {
    if (type === "image") return <ImageIcon className="h-3 w-3 mr-1" />;
    if (type === "audio") return <Volume2 className="h-3 w-3 mr-1" />;
    return <Video className="h-3 w-3 mr-1" />;
  };

  const typeVariant = (type: ErrorEntry["type"]): "secondary" | "outline" => {
    return type === "image" ? "secondary" : "outline";
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Error Log</h1>
          <p className="text-sm text-muted-foreground">Failed asset generations across all projects</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchErrors} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-2xl font-bold text-foreground">{errors.length}</p>
              <p className="text-xs text-muted-foreground">Total Errors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ImageIcon className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{imageFails}</p>
              <p className="text-xs text-muted-foreground">Image Failures</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{audioFails}</p>
              <p className="text-xs text-muted-foreground">Audio Failures</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Video className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{videoFails}</p>
              <p className="text-xs text-muted-foreground">Video Failures</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="image">Images only</SelectItem>
            <SelectItem value="audio">Audio only</SelectItem>
            <SelectItem value="video">Video only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Accordion grouped by project */}
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No errors found 🎉</p>
      ) : (
        <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
          {groups.map(group => (
            <AccordionItem key={group.project_id} value={group.project_id} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-foreground">{group.project_title}</span>
                  <Badge variant="destructive" className="text-xs">{group.errors.length} error{group.errors.length !== 1 ? "s" : ""}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pb-2">
                  {group.errors.map(e => (
                    <div key={e.id} className="flex items-start gap-3 bg-secondary rounded px-3 py-2">
                      <div className="shrink-0 pt-0.5">
                        <Badge variant={typeVariant(e.type)} className="text-xs">
                          {typeIcon(e.type)}{e.type}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                          <span>Scene #{e.scene_number}</span>
                          <span>·</span>
                          <span>{e.attempts} attempt{e.attempts !== 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>{format(new Date(e.updated_at), "MMM d, HH:mm")}</span>
                        </div>
                        <p className="text-xs text-destructive font-mono truncate" title={e.error}>{e.error}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-xs"
                        disabled={retrying.has(e.id)}
                        onClick={() => handleRetry(e)}
                      >
                        {retrying.has(e.id) ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          "Retry"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/ErrorLog.tsx
git commit -m "feat: redesign ErrorLog with project accordion, retry buttons, and video error type"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run all tests**

```bash
npm run test
```

Expected: all tests pass including the 3 new providers tests.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Start dev server and smoke-test**

```bash
npm run dev
```

Verify:
- Sidebar no longer shows "Video Gen", "Image to Video", or "Text Splitter"
- Settings → Providers tab has "Generate Images" toggle
- ErrorLog shows 4 summary cards and groups errors by project with Retry buttons
- A project with completed images: "Animate" button on scenes → calls `/api/render/:id/animate` (watch server logs for `[veo]` prefix)

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup after feature implementation"
```
