import express, { Request, Response } from "express";
import multer from "multer";
import { db } from "../db.js";
import { projects, scenes } from "../../shared/schema.js";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { execSync, spawn } from "child_process";
import archiver from "archiver";
import { animateWhiskImage } from "../lib/whisk.js";

const router = express.Router();
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── External render API ────────────────────────────────────────────────────
const RENDER_API = (process.env.RENDER_API_URL ?? "http://5.189.146.143").replace(/\/$/, "");
const RENDER_API_KEY = process.env.RENDER_API_KEY ?? "";
// Default to the actual port the app runs on (3001), not 5000
const SERVER_URL = (process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3001}`).replace(/\/$/, "");

async function callRenderApi(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`${RENDER_API}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": RENDER_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Render API ${endpoint} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function downloadFile(url: string, localPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} → ${res.status}`);
  fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
}

// ── Ken Burns effect types ─────────────────────────────────────────────────
type KBEffect = "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "pan-up" | "pan-down";
const KB_EFFECTS: KBEffect[] = ["zoom-in", "zoom-out", "pan-right", "pan-left", "pan-up", "pan-down"];

function pickEffect(prev?: KBEffect): KBEffect {
  const pool = prev ? KB_EFFECTS.filter(e => e !== prev) : KB_EFFECTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

const KB_TO_API: Record<KBEffect, string> = {
  "zoom-in":   "zoom_in",
  "zoom-out":  "zoom_out",
  "pan-right": "pan_right",
  "pan-left":  "pan_left",
  "pan-up":    "pan_zoom",
  "pan-down":  "pan_zoom",
};

/**
 * Ken Burns using fixed scale + per-frame crop with `t` expressions.
 *
 * `scale` evaluates w/h only at init (no `t` support) — so we pre-scale
 * to a fixed larger size, then use `crop` (which re-evaluates per frame
 * and fully supports `t`) to produce the zoom/pan motion, then post-scale
 * zoom clips back to the target resolution.
 *
 * @param maxZoom  zoom factor: 1.3 for stills, 1.15 for Veo clips
 */
function buildKB(effect: KBEffect, dur: number, width: number, height: number, maxZoom = 1.3): string {
  const d = dur.toFixed(3);
  // Pre-scaled dimensions — must be even for libx264
  const pW = Math.round(width * maxZoom / 2) * 2;
  const pH = Math.round(height * maxZoom / 2) * 2;
  const dx = pW - width;   // extra horizontal pixels
  const dy = pH - height;  // extra vertical pixels
  switch (effect) {
    case "zoom-in":
      // Crop window shrinks pW×pH → W×H (shows progressively less = zooms in)
      // then post-scale stretches back to W×H for consistent output size
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${pW}-${dx}*min(t\\,${d})/${d}:${pH}-${dy}*min(t\\,${d})/${d}:(iw-out_w)/2:(ih-out_h)/2,` +
             `scale=${width}:${height}:flags=lanczos`;
    case "zoom-out":
      // Crop window grows W×H → pW×pH (shows progressively more = zooms out)
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${width}+${dx}*min(t\\,${d})/${d}:${height}+${dy}*min(t\\,${d})/${d}:(iw-out_w)/2:(ih-out_h)/2,` +
             `scale=${width}:${height}:flags=lanczos`;
    case "pan-right":
      // Crop x advances left→right; output is always W×H so no post-scale needed
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${width}:${height}:min(${dx}*min(t\\,${d})/${d}\\,${dx}):${dy / 2}`;
    case "pan-left":
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${width}:${height}:max(${dx}*(1-min(t\\,${d})/${d})\\,0):${dy / 2}`;
    case "pan-up":
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${width}:${height}:${dx / 2}:max(${dy}*(1-min(t\\,${d})/${d})\\,0)`;
    case "pan-down":
      return `scale=${pW}:${pH}:flags=lanczos,` +
             `crop=${width}:${height}:${dx / 2}:min(${dy}*min(t\\,${d})/${d}\\,${dy})`;
  }
}

const RESOLUTIONS: Record<string, [number, number]> = {
  "480p": [854, 480],
  "720p": [1280, 720],
};

// ── In-memory job stores ───────────────────────────────────────────────────
type AutoJob = {
  status: "waiting_assets" | "animating" | "generating_clips" | "merging" | "done" | "failed";
  resolution: string;
  error?: string;
};
const autoJobs: Record<string, AutoJob> = {};

type ClipJob = {
  status: "generating" | "done" | "failed";
  progress: number; // 0–100
  done: number;
  total: number;
  resolution: string;
  error?: string;
};

type MergeJob = {
  status: "rendering" | "done" | "failed";
  progress: number; // 0–100
  total: number;
  resolution: string;
  error?: string;
};

const clipJobs: Record<string, ClipJob> = {};
const mergeJobs: Record<string, MergeJob> = {};

type AnimateJob = {
  status: "animating" | "done" | "failed";
  progress: number;
  done: number;
  total: number;
  error?: string;
  sceneErrors: Record<number, string>; // scene_number → error message
};
const animateJobs: Record<string, AnimateJob> = {};

// ── FFmpeg helpers ─────────────────────────────────────────────────────────

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    proc.stderr.on("data", d => (stderr += d.toString()));
    proc.on("close", code =>
      code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-800)}`))
    );
  });
}

function getAudioDuration(file: string): number {
  try {
    const val = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`
    ).toString().trim();
    return Math.max(parseFloat(val) || 3, 0.5);
  } catch { return 3; }
}

function findImageFile(projectId: string, sceneNumber: number, dbFile?: string | null): string | null {
  const imgDir = path.join("uploads", projectId, "images");
  const candidates = [
    dbFile && !dbFile.endsWith(".svg") ? path.join(imgDir, dbFile) : null,
    path.join(imgDir, `${sceneNumber}.png`),
    path.join(imgDir, `${sceneNumber}.jpg`),
    path.join(imgDir, `${sceneNumber}.jpeg`),
    // .svg are mock placeholders — never use for rendering
  ].filter(Boolean) as string[];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

function hasAudioStream(file: string): boolean {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=noprint_wrappers=1 "${file}"`
    ).toString().trim();
    return out.length > 0;
  } catch { return false; }
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/render/health
 * Pings the external render API and reports connectivity + response time.
 */
router.get("/health", async (_req: Request, res: Response) => {
  const url = RENDER_API;
  const start = Date.now();
  try {
    const r = await fetch(`${url}/health`, {
      method: "GET",
      headers: { "X-API-Key": RENDER_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    const ms = Date.now() - start;
    // Accept any HTTP response — a 404 still means the server is reachable
    return res.json({ ok: true, url, status: r.status, ms });
  } catch (e: any) {
    const ms = Date.now() - start;
    return res.json({ ok: false, url, ms, error: e.message ?? "Unreachable" });
  }
});

/**
 * POST /api/render/image-to-video
 * Convert a single uploaded image to an animated video clip.
 * Body: multipart/form-data — image (required), animation, duration, resolution
 * Returns: { url: string }  — the video URL from the render API (download directly)
 */
router.post("/image-to-video", memUpload.single("image"), async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: "No image file provided" });

  const animation = req.body.animation || "random";
  const duration = Math.min(Math.max(parseFloat(req.body.duration) || 5, 1), 30);
  const resKey = req.body.resolution === "480p" ? "480p" : "720p";
  const [W, H] = RESOLUTIONS[resKey];
  const FPS = 25;

  // Save image to a temporary folder so the render API can fetch it
  const tmpId = `itv_${Date.now()}`;
  const tmpDir = path.join("uploads", tmpId, "images");
  fs.mkdirSync(tmpDir, { recursive: true });
  const ext = path.extname(file.originalname || "image.jpg") || ".jpg";
  const imgPath = path.join(tmpDir, `1${ext}`);
  fs.writeFileSync(imgPath, file.buffer);

  try {
    const imgUrl = `${SERVER_URL}/${imgPath.replace(/\\/g, "/")}`;
    const chosenAnim = animation === "random" ? KB_TO_API[pickEffect()] : animation;

    const animRes = await callRenderApi("/animate", {
      media_url:  imgUrl,
      media_type: "image",
      animation:  chosenAnim,
      duration,
      fps:        FPS,
      resolution: `${W}x${H}`,
      folder:     tmpId,
    });

    return res.json({ url: animRes.url, animation: chosenAnim, duration, resolution: `${W}x${H}` });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  } finally {
    // Clean up temp image (video lives on render API side)
    try { fs.rmSync(path.join("uploads", tmpId), { recursive: true, force: true }); } catch {}
  }
});

/**
 * POST /api/render/:id/clips
 * Phase 1: generate individual MP4 clips (1.mp4, 2.mp4, …) into uploads/{id}/clips/
 * Each clip duration = audio duration, Ken Burns effect applied.
 */
router.post("/:id/clips", async (req: Request, res: Response) => {
  const projectId = req.params.id;
  try {
    try { execSync("ffmpeg -version", { stdio: "ignore" }); }
    catch { return res.status(500).json({ error: "FFmpeg not installed. Run: apt-get install -y ffmpeg" }); }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    const ready = allScenes.filter(s => s.image_status === "completed" && s.audio_status === "completed");
    if (ready.length === 0)
      return res.status(400).json({ error: "No scenes ready — need completed image AND audio for each scene." });

    const resKey = req.body?.resolution === "480p" ? "480p" : "720p";
    const [W, H] = RESOLUTIONS[resKey];

    clipJobs[projectId] = { status: "generating", progress: 0, done: 0, total: ready.length, resolution: resKey };
    res.json({ success: true, total: ready.length, resolution: resKey });

    generateClips(projectId, ready, W, H).catch(e => {
      console.error(`[clips] ${projectId} failed:`, e.message);
      clipJobs[projectId] = { ...clipJobs[projectId], status: "failed", error: e.message };
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/render/:id/clips/status */
router.get("/:id/clips/status", (req: Request, res: Response) => {
  const job = clipJobs[req.params.id];
  if (job) return res.json(job);
  // Check if clips dir already has files (e.g. after server restart)
  const clipsDir = path.join("uploads", req.params.id, "clips");
  if (fs.existsSync(clipsDir)) {
    const clips = fs.readdirSync(clipsDir).filter(f => f.endsWith(".mp4"));
    if (clips.length > 0) {
      return res.json({ status: "done", progress: 100, done: clips.length, total: clips.length, resolution: "unknown" });
    }
  }
  res.json({ status: "idle" });
});

/**
 * GET /api/render/:id/clips/zip
 * Download all individual clips as a ZIP file.
 */
router.get("/:id/clips/zip", (req: Request, res: Response) => {
  const clipsDir = path.join("uploads", req.params.id, "clips");
  if (!fs.existsSync(clipsDir)) {
    return res.status(404).json({ error: "No clips found. Generate clips first." });
  }
  const clipFiles = fs.readdirSync(clipsDir)
    .filter(f => f.endsWith(".mp4"))
    .sort((a, b) => parseInt(a) - parseInt(b));
  if (clipFiles.length === 0) {
    return res.status(404).json({ error: "No clips found. Generate clips first." });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="clips.zip"`);

  const archive = archiver("zip", { zlib: { level: 0 } }); // level 0 = store only (MP4s already compressed)
  archive.on("error", err => { console.error("[zip] error:", err); res.destroy(); });
  archive.pipe(res);
  for (const f of clipFiles) {
    archive.file(path.join(clipsDir, f), { name: f });
  }
  archive.finalize();
});

/**
 * POST /api/render/:id/animate
 * Animate selected scenes using Whisk/Veo. Body: { scenes: number[] }
 * Header: x-whisk-cookie
 */
router.post("/:id/animate", async (req: Request, res: Response) => {
  const projectId = req.params.id;
  const cookie = req.headers["x-whisk-cookie"] as string;
  if (!cookie) return res.status(400).json({ error: "Whisk cookie required (x-whisk-cookie header)" });

  const sceneNums = (req.body?.scenes as number[]) || [];
  if (sceneNums.length === 0) return res.status(400).json({ error: "No scenes provided" });

  const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId)).orderBy(scenes.scene_number);
  const toAnimate = allScenes.filter(s => sceneNums.includes(s.scene_number) && s.image_status === "completed");
  if (toAnimate.length === 0) return res.status(400).json({ error: "No scenes with completed images to animate" });

  animateJobs[projectId] = { status: "animating", progress: 0, done: 0, total: toAnimate.length, sceneErrors: {} };
  res.json({ success: true, total: toAnimate.length });

  animateScenes(projectId, sceneNums, allScenes, cookie).catch(e => {
    animateJobs[projectId] = { ...animateJobs[projectId], status: "failed", error: e.message };
  });
});

/** GET /api/render/:id/animate/status */
router.get("/:id/animate/status", (req: Request, res: Response) => {
  const videosDir = path.join("uploads", req.params.id, "videos");
  const getAnimatedNums = (): number[] => {
    if (!fs.existsSync(videosDir)) return [];
    return fs.readdirSync(videosDir)
      .filter(f => f.endsWith(".mp4"))
      .map(f => parseInt(f))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);
  };

  const job = animateJobs[req.params.id];
  if (job) {
    const animatedSceneNums = getAnimatedNums();
    return res.json({ ...job, animatedSceneNums });
  }
  const animatedSceneNums = getAnimatedNums();
  if (animatedSceneNums.length > 0) {
    return res.json({ status: "done", progress: 100, done: animatedSceneNums.length, total: animatedSceneNums.length, sceneErrors: {}, animatedSceneNums });
  }
  res.json({ status: "idle", done: 0, total: 0, sceneErrors: {}, animatedSceneNums: [] });
});

/**
 * GET /api/render/:id/animate/zip
 * Download animated scenes as ZIP. Prefers final clips (with audio), falls back to raw Veo.
 */
router.get("/:id/animate/zip", (req: Request, res: Response) => {
  const projectId = req.params.id;
  const videosDir = path.join("uploads", projectId, "videos");
  const clipsDir = path.join("uploads", projectId, "clips");

  if (!fs.existsSync(videosDir)) return res.status(404).json({ error: "No animated scenes found." });

  const animatedNums = fs.readdirSync(videosDir)
    .filter(f => f.endsWith(".mp4"))
    .map(f => parseInt(f))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  if (animatedNums.length === 0) return res.status(404).json({ error: "No animated scenes found." });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="animated-scenes.zip"`);

  const archive = archiver("zip", { zlib: { level: 0 } });
  archive.on("error", err => { console.error("[zip] error:", err); res.destroy(); });
  archive.pipe(res);

  for (const num of animatedNums) {
    const clip = path.join(clipsDir, `${num}.mp4`);
    const raw = path.join(videosDir, `${num}.mp4`);
    if (fs.existsSync(clip)) {
      archive.file(clip, { name: `scene_${num}_animated.mp4` });
    } else if (fs.existsSync(raw)) {
      archive.file(raw, { name: `scene_${num}_animated_raw.mp4` });
    }
  }
  archive.finalize();
});

/**
 * POST /api/render/:id/auto
 * Full background pipeline: wait for assets → (optionally) animate with Veo → generate clips → merge.
 * Returns immediately; runs entirely server-side.
 * Body: { resolution?, whiskCookie? }
 */
router.post("/:id/auto", async (req: Request, res: Response) => {
  const projectId = req.params.id;
  const resKey = req.body?.resolution === "480p" ? "480p" : "720p";
  const whiskCookie: string | undefined = req.body?.whiskCookie || undefined;
  res.json({ success: true, message: "Auto pipeline started in background" });
  runAutoPipeline(projectId, resKey, whiskCookie).catch(e => {
    console.error(`[auto] ${projectId} failed:`, e.message);
    if (autoJobs[projectId]) autoJobs[projectId] = { ...autoJobs[projectId], status: "failed", error: e.message };
  });
});

/** GET /api/render/:id/auto/status */
router.get("/:id/auto/status", (req: Request, res: Response) => {
  const job = autoJobs[req.params.id];
  if (job) return res.json(job);
  const outPath = path.join("uploads", req.params.id, "render", "output.mp4");
  if (fs.existsSync(outPath)) return res.json({ status: "done", resolution: "unknown" });
  res.json({ status: "idle" });
});

/**
 * POST /api/render/:id
 * Phase 2: merge clips into a single output.mp4 with smooth transitions.
 * Uses pre-generated clips from clips/ dir if available, otherwise generates inline.
 */
router.post("/:id", async (req: Request, res: Response) => {
  const projectId = req.params.id;
  try {
    try { execSync("ffmpeg -version", { stdio: "ignore" }); }
    catch { return res.status(500).json({ error: "FFmpeg not installed. Run: apt-get install -y ffmpeg" }); }

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    const ready = allScenes.filter(s => s.image_status === "completed" && s.audio_status === "completed");
    if (ready.length === 0)
      return res.status(400).json({ error: "No scenes are fully ready." });

    const resKey = req.body?.resolution === "480p" ? "480p" : "720p";
    const [W, H] = RESOLUTIONS[resKey];

    mergeJobs[projectId] = { status: "rendering", progress: 0, total: ready.length, resolution: resKey };
    res.json({ success: true, total: ready.length, resolution: resKey });

    mergeVideo(projectId, ready, W, H).catch(e => {
      console.error(`[merge] ${projectId} failed:`, e.message);
      mergeJobs[projectId] = { ...mergeJobs[projectId], status: "failed", error: e.message };
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/render/:id/status */
router.get("/:id/status", (req: Request, res: Response) => {
  const job = mergeJobs[req.params.id];
  if (job) return res.json(job);
  const outPath = path.join("uploads", req.params.id, "render", "output.mp4");
  if (fs.existsSync(outPath)) return res.json({ status: "done", progress: 100, total: 0, resolution: "unknown" });
  res.json({ status: "idle" });
});

/** GET /api/render/:id/download */
router.get("/:id/download", async (req: Request, res: Response) => {
  const outPath = path.join("uploads", req.params.id, "render", "output.mp4");
  if (!fs.existsSync(outPath)) return res.status(404).json({ error: "Render not found. Start a render first." });
  let filename = "video.mp4";
  try {
    const [project] = await db.select({ title: projects.title }).from(projects).where(eq(projects.id, req.params.id));
    if (project?.title) {
      const safe = project.title.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_").slice(0, 80);
      if (safe) filename = `${safe}.mp4`;
    }
  } catch { /* fall back to video.mp4 */ }
  res.download(outPath, filename);
});

// ── Core functions ─────────────────────────────────────────────────────────

// silenceremove removed — stop_periods=1 terminates the stream on any inter-word pause
const AUDIO_FILTER = `loudnorm=I=-16:LRA=11:TP=-1.5`;

async function buildVeoClip(
  veoPath: string, audioPath: string, dur: number,
  width: number, height: number, outPath: string
): Promise<void> {
  const veoDur = getAudioDuration(veoPath); // ffprobe format=duration works for video too
  const speed  = veoDur / dur;              // < 1.0 → Veo is shorter than audio → slow down

  const veoAudio = hasAudioStream(veoPath);
  const FPS = 25;
  const kbFilter = buildKB(pickEffect(), dur, width, height, 1.15);

  // Always slow down to match audio — setpts has no lower limit so no looping needed.
  // speed=0.8 → setpts=PTS/0.8=1.25×PTS → video runs 25% slower.
  const vScale = speed < 1.0
    ? `setpts=PTS/${speed},fps=${FPS},${kbFilter},setsar=1,format=yuv420p`
    : `fps=${FPS},${kbFilter},setsar=1,format=yuv420p`;

  const encArgs = [
    "-c:v", "libx264", "-preset", "fast", "-crf", "22",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
  ];

  if (veoAudio) {
    // atempo min is 0.5; clamp so Veo's ambient audio stays audibly in sync
    const atempoSpeed = Math.max(speed, 0.5).toFixed(4);
    const veoAudioFilter = speed < 1.0 ? `atempo=${atempoSpeed},volume=0.1` : `volume=0.1`;
    await ffmpeg([
      "-y", "-i", veoPath, "-i", audioPath,
      "-filter_complex",
        `[0:v]${vScale}[v];` +
        `[0:a]${veoAudioFilter}[va];[1:a]${AUDIO_FILTER}[na];[va][na]amix=inputs=2:duration=first[a]`,
      "-map", "[v]", "-map", "[a]", "-t", `${dur}`,
      ...encArgs, outPath,
    ]);
  } else {
    await ffmpeg([
      "-y", "-i", veoPath, "-i", audioPath,
      "-filter_complex", `[0:v]${vScale}[v];[1:a]${AUDIO_FILTER}[a]`,
      "-map", "[v]", "-map", "[a]", "-t", `${dur}`,
      ...encArgs, outPath,
    ]);
  }
}

/**
 * Phase 1: generate one MP4 per scene, named by scene number (1.mp4, 2.mp4, …).
 * Duration = audio duration. Ken Burns effect applied at random (no repeat).
 */
async function generateClips(projectId: string, sceneList: any[], width: number, height: number) {
  const FPS = 25;
  const clipsDir = path.join("uploads", projectId, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  let prevEffect: KBEffect | undefined;
  let done = 0;

  for (let i = 0; i < sceneList.length; i++) {
    const s = sceneList[i];
    const num = s.scene_number;

    const img = findImageFile(projectId, num, s.image_file);
    const audioPath = path.join("uploads", projectId, "audio", s.audio_file ?? `${num}.mp3`);

    if (!img || !fs.existsSync(audioPath)) {
      console.warn(`[clips] scene ${num}: missing files, skipping`);
      clipJobs[projectId].progress = Math.round(((i + 1) / sceneList.length) * 100);
      continue;
    }

    const dur = parseFloat(getAudioDuration(audioPath).toFixed(3));
    const frames = Math.round(FPS * dur);
    const clipPath = path.join(clipsDir, `${num}.mp4`);
    const veoPath = path.join("uploads", projectId, "videos", `${num}.mp4`);

    try {
      if (fs.existsSync(veoPath)) {
        console.log(`[clips] scene ${num}: using Veo video`);
        await buildVeoClip(veoPath, audioPath, dur, width, height, clipPath);
      } else {
        const effect = pickEffect(prevEffect);
        prevEffect = effect;
        const imgUrl   = `${SERVER_URL}/${img.replace(/\\/g, "/")}`;
        const audioUrl = `${SERVER_URL}/uploads/${projectId}/audio/${s.audio_file ?? `${num}.mp3`}`;
        console.log(`[clips] scene ${num}: calling render API (${KB_TO_API[effect]}, ${dur}s)`);

        const animRes = await callRenderApi("/animate", {
          media_url:  imgUrl,
          media_type: "image",
          animation:  KB_TO_API[effect],
          duration:   dur,
          fps:        FPS,
          resolution: `${width}x${height}`,
          folder:     projectId,
        });

        const mergeRes = await callRenderApi("/merge", {
          video_url: animRes.url,
          audio_url: audioUrl,
          strategy:  "trim_or_slow",
          folder:    projectId,
        });

        await downloadFile(mergeRes.url, clipPath);
      }

      done++;
      clipJobs[projectId].done = done;
      console.log(`[clips] ${projectId}: scene ${num} done (${done}/${sceneList.length})`);
    } catch (e: any) {
      console.error(`[clips] scene ${num} failed — skipping:`, e.message);
    }

    clipJobs[projectId].progress = Math.round(((i + 1) / sceneList.length) * 100);
  }

  clipJobs[projectId] = { ...clipJobs[projectId], status: "done", progress: 100 };
  console.log(`[clips] ${projectId}: all clips done → ${clipsDir}`);
}

/**
 * Phase 2: merge clips into output.mp4 with xfade transitions.
 * Reads from clips/ dir if pre-generated; otherwise generates clips inline.
 */
async function mergeVideo(projectId: string, sceneList: any[], width: number, height: number) {
  const FPS = 25;
  const T = 0.1; // transition duration in seconds
  const clipsDir = path.join("uploads", projectId, "clips");
  const renderDir = path.join("uploads", projectId, "render");
  fs.mkdirSync(renderDir, { recursive: true });

  const clips: string[] = [];
  const durations: number[] = [];
  const tempClips: string[] = []; // inline-generated, cleaned up after merge

  // Use pre-generated clips if available
  for (const s of sceneList) {
    const clip = path.join(clipsDir, `${s.scene_number}.mp4`);
    if (fs.existsSync(clip)) {
      clips.push(clip);
      durations.push(getAudioDuration(clip));
    }
  }

  // Fallback: generate clips inline (backward-compat when user skips Phase 1)
  if (clips.length === 0) {
    let prevEffect: KBEffect | undefined;
    for (let i = 0; i < sceneList.length; i++) {
      const s = sceneList[i];
      const num = s.scene_number;
      const img = findImageFile(projectId, num, s.image_file);
      const audioPath = path.join("uploads", projectId, "audio", s.audio_file ?? `${num}.mp3`);
      if (!img || !fs.existsSync(audioPath)) {
        mergeJobs[projectId].progress = Math.round(((i + 1) / sceneList.length) * 78);
        continue;
      }
      const dur = parseFloat(getAudioDuration(audioPath).toFixed(3));
      const effect = pickEffect(prevEffect);
      prevEffect = effect;
      const imgUrl   = `${SERVER_URL}/${img.replace(/\\/g, "/")}`;
      const audioUrl = `${SERVER_URL}/uploads/${projectId}/audio/${s.audio_file ?? `${num}.mp3`}`;
      const clip = path.join(renderDir, `tmp_${i}.mp4`);
      console.log(`[merge-inline] scene ${num}: calling render API (${KB_TO_API[effect]}, ${dur}s)`);

      const animRes = await callRenderApi("/animate", {
        media_url:  imgUrl,
        media_type: "image",
        animation:  KB_TO_API[effect],
        duration:   dur,
        fps:        FPS,
        resolution: `${width}x${height}`,
        folder:     projectId,
      });
      const mergeRes = await callRenderApi("/merge", {
        video_url: animRes.url,
        audio_url: audioUrl,
        strategy:  "trim_or_slow",
        folder:    projectId,
      });
      await downloadFile(mergeRes.url, clip);
      clips.push(clip);
      tempClips.push(clip);
      durations.push(getAudioDuration(clip));
      mergeJobs[projectId].progress = Math.round(((i + 1) / sceneList.length) * 78);
    }
  }

  if (clips.length === 0) throw new Error("No clips available — check scenes have image and audio.");

  const outPath = path.join(renderDir, "output.mp4");

  mergeJobs[projectId].progress = 90;

  if (clips.length === 1) {
    fs.copyFileSync(clips[0], outPath);
  } else {
    const clipUrls = clips.map(c => `${SERVER_URL}/${c.replace(/\\/g, "/")}`);
    console.log(`[merge] ${projectId}: concat-transitions (${clipUrls.length} clips)`);

    // Batch into groups of 50 so the render API isn't hit with hundreds of URLs at once
    const BATCH = 50;
    let batchUrls: string[] = [];
    if (clipUrls.length <= BATCH) {
      const res = await callRenderApi("/concat-transitions", {
        urls: clipUrls, transition: "fade", transition_duration: 0.5, folder: projectId,
      });
      batchUrls = [res.url];
    } else {
      for (let b = 0; b < clipUrls.length; b += BATCH) {
        const slice = clipUrls.slice(b, b + BATCH);
        console.log(`[merge] ${projectId}: batch ${Math.floor(b / BATCH) + 1} (${slice.length} clips)`);
        const res = await callRenderApi("/concat-transitions", {
          urls: slice, transition: "fade", transition_duration: 0.5, folder: projectId,
        });
        batchUrls.push(res.url);
      }
    }

    // Final concat of batch results (or single result if only one batch)
    if (batchUrls.length === 1) {
      await downloadFile(batchUrls[0], outPath);
    } else {
      console.log(`[merge] ${projectId}: joining ${batchUrls.length} batches`);
      const finalRes = await callRenderApi("/concat-transitions", {
        urls: batchUrls, transition: "fade", transition_duration: 0.5, folder: projectId,
      });
      await downloadFile(finalRes.url, outPath);
    }
  }

  // Clean up only inline temp clips (keep clips/ dir intact)
  tempClips.forEach(c => { try { fs.unlinkSync(c); } catch {} });

  mergeJobs[projectId] = { status: "done", progress: 100, total: sceneList.length, resolution: mergeJobs[projectId].resolution };
  console.log(`[merge] ${projectId}: done → ${outPath}`);
}

/**
 * Full auto-pipeline: poll until all assets ready → animate with Veo (if cookie provided)
 * → generate clips → merge. Runs entirely in-process; browser can be closed.
 */
async function runAutoPipeline(projectId: string, resKey: "480p" | "720p", whiskCookie?: string) {
  const [W, H] = RESOLUTIONS[resKey];
  autoJobs[projectId] = { status: "waiting_assets", resolution: resKey };
  console.log(`[auto] ${projectId}: waiting for assets (${resKey})`);

  // Poll up to 2 hours for all scenes to finish generating
  const MAX_POLLS = 2400;
  for (let i = 0; i < MAX_POLLS; i++) {
    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);
    if (allScenes.length > 0) {
      const pending = allScenes.filter(s =>
        s.image_status === "pending" || s.image_status === "generating" ||
        s.audio_status === "pending" || s.audio_status === "generating"
      );
      if (pending.length === 0) break;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  const allScenes = await db.select().from(scenes)
    .where(eq(scenes.project_id, projectId))
    .orderBy(scenes.scene_number);
  const ready = allScenes.filter(s => s.image_status === "completed" && s.audio_status === "completed");

  if (ready.length === 0) {
    autoJobs[projectId] = { ...autoJobs[projectId], status: "failed", error: "No scenes ready" };
    return;
  }

  // ── Veo animation (if Whisk cookie provided) ──────────────────────────────
  if (whiskCookie) {
    console.log(`[auto] ${projectId}: animating ${ready.length} scenes with Veo`);
    autoJobs[projectId] = { ...autoJobs[projectId], status: "animating" as any };
    animateJobs[projectId] = { status: "animating", progress: 0, done: 0, total: ready.length, sceneErrors: {} };
    const sceneNums = ready.map(s => s.scene_number);
    await animateScenes(projectId, sceneNums, ready, whiskCookie).catch(e => {
      console.warn(`[auto] ${projectId}: Veo animation failed (continuing with stills): ${e.message}`);
    });
  }

  console.log(`[auto] ${projectId}: ${ready.length} scenes ready → generating clips`);
  autoJobs[projectId].status = "generating_clips";
  clipJobs[projectId] = { status: "generating", progress: 0, done: 0, total: ready.length, resolution: resKey };
  await generateClips(projectId, ready, W, H);

  console.log(`[auto] ${projectId}: clips done → merging`);
  autoJobs[projectId].status = "merging";
  mergeJobs[projectId] = { status: "rendering", progress: 0, total: ready.length, resolution: resKey };
  await mergeVideo(projectId, ready, W, H);

  autoJobs[projectId].status = "done";
  console.log(`[auto] ${projectId}: pipeline complete`);
}

async function animateScenes(
  projectId: string,
  sceneNumbers: number[],
  sceneList: any[],
  cookie: string
) {
  const videosDir = path.join("uploads", projectId, "videos");
  fs.mkdirSync(videosDir, { recursive: true });

  let done = 0;
  for (const num of sceneNumbers) {
    const s = sceneList.find((sc: any) => sc.scene_number === num);
    if (!s) continue;
    const img = findImageFile(projectId, num, s.image_file);
    if (!img) {
      console.warn(`[animate] scene ${num}: no image, skipping`);
      continue;
    }
    const videoPath = path.join(videosDir, `${num}.mp4`);
    try {
      const buf = await animateWhiskImage(img, cookie, s.image_prompt || "");
      fs.writeFileSync(videoPath, buf);
      done++;
      animateJobs[projectId].done = done;
      animateJobs[projectId].progress = Math.round((done / sceneNumbers.length) * 100);
      console.log(`[animate] ${projectId}: scene ${num} done (${done}/${sceneNumbers.length})`);
    } catch (e: any) {
      console.error(`[animate] scene ${num} failed:`, e.message);
      animateJobs[projectId].sceneErrors[num] = e.message;
    }
  }
  animateJobs[projectId] = { ...animateJobs[projectId], status: "done", progress: 100 };
}

export default router;
