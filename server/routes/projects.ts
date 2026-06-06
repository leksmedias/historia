import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, scenes } from "../../shared/schema";
import { eq, desc, or, gt } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const projectId = req.body.projectId || "temp";
    const dir = path.join("uploads", projectId, "style");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, file.fieldname + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

const DEFAULT_STYLE_SUMMARY = {
  palette: "desaturated, muted, slightly dark, historical documentary tone",
  lighting: "natural window light, candlelight, torchlight, overcast daylight, dim interiors",
  framing: "wide establishing shots, over-the-shoulder views, close details, behind-the-back framing",
  people: "anonymous figures, obscured faces, silhouettes, backs turned",
  mood: "tense, reflective, investigative, cinematic",
  historicalLook: "realistic period atmosphere, grounded environments, era-appropriate architecture, clothing, and objects",
};

const WW2_STYLE_SUMMARY = {
  palette: "monochrome, black and white, high-contrast, vintage archival film tones",
  lighting: "harsh side lighting, pre-dawn blue-gray shadows, fire glow, dramatic chiaroscuro",
  framing: "action combat photojournalism, wide battlefield debris, low-angle tank grinds, close exhausted portraits",
  people: "anonymous soldiers in wool uniforms, helmets, mud-splattered faces, raw expressions",
  mood: "grave, intense, historically immersive, documentary realism",
  historicalLook: "period-accurate WWII equipment, authentic weapons, canvas webbing, destroyed trenches, bombed-out villages",
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateProjectId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "proj_";
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(projects).orderBy(desc(projects.created_at));
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, req.params.id));
    if (!project) return res.status(404).json({ error: "Project not found" });
    const projectScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, req.params.id))
      .orderBy(scenes.scene_number);

    // Dynamically calculate accurate stats to ensure UI is perfectly in sync
    const imagesCompleted = projectScenes.filter(s => s.image_status === "completed").length;
    const audioCompleted = projectScenes.filter(s => s.audio_status === "completed").length;
    const imagesFailed = projectScenes.filter(s => s.image_status === "failed").length;
    const audioFailed = projectScenes.filter(s => s.audio_status === "failed").length;
    const needsReviewCount = projectScenes.filter(s => s.needs_review).length;

    const actualStats = {
      ...((project.stats as any) || {}),
      sceneCount: projectScenes.length,
      imagesCompleted,
      audioCompleted,
      imagesFailed,
      audioFailed,
      needsReviewCount,
    };
    
    // Only update the database if the stats have actually drifted
    if (JSON.stringify(project.stats) !== JSON.stringify(actualStats)) {
      await db.update(projects).set({ stats: actualStats }).where(eq(projects.id, req.params.id));
    }
    
    project.stats = actualStats;

    res.json({ project, scenes: projectScenes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", upload.fields([{ name: "style1", maxCount: 1 }, { name: "style2", maxCount: 1 }]), async (req: Request, res: Response) => {
  try {
    const { title, script, imageProvider, ttsProvider, voiceId, modelId, splitMode, stylePrompt, visualTheme, aspectRatio } = req.body;
    if (!title || !script) return res.status(400).json({ error: "Title and script are required" });

    const projectId = generateProjectId();

    const dir = path.join("uploads", projectId, "style");
    fs.mkdirSync(dir, { recursive: true });

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (files?.style1?.[0]) {
      const dest = path.join("uploads", projectId, "style", "style1.png");
      fs.renameSync(files.style1[0].path, dest);
    }
    if (files?.style2?.[0]) {
      const dest = path.join("uploads", projectId, "style", "style2.png");
      fs.renameSync(files.style2[0].path, dest);
    }

    const theme = visualTheme || "impasto";
    const styleSummary = theme === "ww2" ? WW2_STYLE_SUMMARY : DEFAULT_STYLE_SUMMARY;

    await db.insert(projects).values({
      id: projectId,
      title,
      mode: "history",
      status: "processing",
      settings: {
        imageProvider: imageProvider || "mock",
        ttsProvider: ttsProvider || "mock",
        voiceId: voiceId || "Dennis",
        modelId: modelId || "inworld-tts-1.5-max",
        imageConcurrency: 2,
        audioConcurrency: 2,
        historyMode: true,
        splitMode: splitMode || "smart",
        visualTheme: theme,
        aspectRatio: aspectRatio || "16:9",
        ...(stylePrompt ? { stylePrompt } : {}),
      },
      style_summary: styleSummary,
      stats: { sceneCount: 0, imagesCompleted: 0, audioCompleted: 0, imagesFailed: 0, audioFailed: 0, needsReviewCount: 0 },
    });

    res.json({ projectId });
  } catch (e: any) {
    console.error("create-project error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id/stop", async (req: Request, res: Response) => {
  try {
    await db.update(projects).set({ status: "stopped" }).where(eq(projects.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(scenes).where(eq(scenes.project_id, req.params.id));
    await db.delete(projects).where(eq(projects.id, req.params.id));
    const dir = path.join("uploads", req.params.id);
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/split-scene", async (req: Request, res: Response) => {
  try {
    const { sceneNumber, splitAfterSentence } = req.body;
    const projectId = req.params.id;

    const [scene] = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .where(eq(scenes.scene_number, sceneNumber));
    if (!scene) return res.status(404).json({ error: "Scene not found" });

    const sentences = scene.script_text.match(/[^.!?]+[.!?]+/g)?.map((s: string) => s.trim()) || [scene.script_text];
    const ttsSentences = scene.tts_text.match(/[^.!?]+[.!?]+/g)?.map((s: string) => s.trim()) || [scene.tts_text];

    const firstScript = sentences.slice(0, splitAfterSentence).join(" ");
    const secondScript = sentences.slice(splitAfterSentence).join(" ");
    const firstTts = ttsSentences.slice(0, splitAfterSentence).join(" ");
    const secondTts = ttsSentences.slice(splitAfterSentence).join(" ");

    await db.update(scenes).set({ script_text: firstScript, tts_text: firstTts })
      .where(eq(scenes.project_id, projectId))
      .where(eq(scenes.scene_number, sceneNumber));

    const laterScenes = await db.select({ id: scenes.id, scene_number: scenes.scene_number })
      .from(scenes)
      .where(eq(scenes.project_id, projectId))
      .where(gt(scenes.scene_number, sceneNumber))
      .orderBy(desc(scenes.scene_number));

    for (const s of laterScenes) {
      await db.update(scenes).set({ scene_number: s.scene_number + 1 }).where(eq(scenes.id, s.id));
    }

    const newNum = sceneNumber + 1;
    await db.insert(scenes).values({
      project_id: projectId,
      scene_number: newNum,
      scene_type: scene.scene_type,
      historical_period: scene.historical_period,
      visual_priority: scene.visual_priority,
      script_text: secondScript,
      tts_text: secondTts,
      image_prompt: scene.image_prompt,
      fallback_prompts: scene.fallback_prompts,
      image_file: `${newNum}.png`,
      audio_file: `${newNum}.mp3`,
      image_status: "pending",
      audio_status: "pending",
    });

    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    await db.update(projects).set({
      stats: {
        sceneCount: allScenes.length,
        imagesCompleted: allScenes.filter((s: any) => s.image_status === "completed").length,
        audioCompleted: allScenes.filter((s: any) => s.audio_status === "completed").length,
        imagesFailed: allScenes.filter((s: any) => s.image_status === "failed").length,
        audioFailed: allScenes.filter((s: any) => s.audio_status === "failed").length,
        needsReviewCount: allScenes.filter((s: any) => s.needs_review).length,
      },
    }).where(eq(projects.id, projectId));

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

async function runAssetPipeline(projectId: string) {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return;

    const settings = (project.settings as any) || {};
    const ttsProvider: string = settings.ttsProvider || "mock";
    const voiceId: string = settings.voiceId || "Dennis";
    const modelId: string = settings.modelId || "inworld-tts-1.5-max";

    const sceneList = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    if (sceneList.length === 0) {
      console.log(`${projectId}: No scenes to process`);
      return;
    }

    console.log(`${projectId}: Starting asset pipeline for ${sceneList.length} scenes (tts=${ttsProvider})`);

    let imagesCompleted = 0, audioCompleted = 0, imagesFailed = 0, audioFailed = 0;
    let stopped = false;

    const updateStats = () => db.update(projects).set({
      stats: { sceneCount: sceneList.length, imagesCompleted, audioCompleted, imagesFailed, audioFailed, needsReviewCount: imagesFailed + audioFailed },
    }).where(eq(projects.id, projectId));

    const checkStopped = async (): Promise<boolean> => {
      if (stopped) return true;
      const [projCheck] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
      if (projCheck?.status === "stopped") {
        stopped = true;
        console.log(`${projectId}: Pipeline stopped by user`);
        return true;
      }
      return false;
    };

    // Phase 1: Images are generated client-side via Gemini sidecar; skip here
    const imgDir = path.join("uploads", projectId, "images");
    fs.mkdirSync(imgDir, { recursive: true });

    if (stopped) return;

    // Phase 2: Generate audio — sequential (Inworld 100 RPS, no need to parallelize)
    const audioDir = path.join("uploads", projectId, "audio");
    fs.mkdirSync(audioDir, { recursive: true });

    for (const scene of sceneList) {
      if (await checkStopped()) return;
      const num = scene.scene_number;
      try {
        const inworldKey = process.env.INWORLD_API_KEY;
        if (ttsProvider === "inworld" && inworldKey) {
          const text = scene.tts_text || scene.script_text || "";
          let bytes: Buffer | null = null;
          let lastAudioError = "";
          const MAX_AUDIO_ATTEMPTS = 3;
          for (let attempt = 1; attempt <= MAX_AUDIO_ATTEMPTS; attempt++) {
            try {
              bytes = await generateInworldAudio(text, inworldKey, voiceId, modelId);
              break;
            } catch (e: any) {
              lastAudioError = e.message;
              const isAuthError = e.message?.includes("401") || e.message?.includes("403") || e.message?.includes("invalid");
              if (isAuthError || attempt === MAX_AUDIO_ATTEMPTS) break;
              const waitMs = 2000 * attempt; // Inworld is 100 RPS — rate limits clear quickly
              console.log(`${projectId} scene ${num}: Audio attempt ${attempt} failed, retrying in ${waitMs}ms...`);
              await delay(waitMs);
            }
          }
          if (!bytes) throw new Error(lastAudioError);
          fs.writeFileSync(path.join(audioDir, `${num}.mp3`), bytes);
        } else {
          throw new Error("No TTS provider configured. Set ttsProvider to 'inworld' in project settings.");
        }
        await db.update(scenes).set({ audio_status: "completed", audio_attempts: 1 })
          .where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, num));
        audioCompleted++;
      } catch (e: any) {
        console.error(`${projectId} scene ${num}: Audio failed: ${e.message}`);
        await db.update(scenes).set({ audio_status: "failed", audio_attempts: 1, audio_error: e.message, needs_review: true })
          .where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, num));
        audioFailed++;
      }
      await updateStats();
    }

    const allImagesAccountedFor = (imagesCompleted + imagesFailed) === sceneList.length;
    const allAudioAccountedFor = (audioCompleted + audioFailed) === sceneList.length;
    const hasFailures = imagesFailed > 0 || audioFailed > 0;
    const finalStatus = (allImagesAccountedFor && allAudioAccountedFor && !hasFailures) ? "completed" : "partial";
    await db.update(projects).set({ status: finalStatus }).where(eq(projects.id, projectId));
    console.log(`${projectId}: Asset pipeline complete. Status: ${finalStatus} (img ok=${imagesCompleted} fail=${imagesFailed}, aud ok=${audioCompleted} fail=${audioFailed})`);
  } catch (e: any) {
    console.error(`${projectId}: Asset pipeline error:`, e.message);
    await db.update(projects).set({ status: "failed" }).where(eq(projects.id, projectId));
  }
}

async function generateInworldAudio(text: string, apiKey: string, voiceId: string, modelId: string): Promise<Buffer> {
  const res = await fetch("https://api.inworld.ai/tts/v1/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${apiKey}` },
    body: JSON.stringify({
      text: text.substring(0, 2000),
      voiceId: voiceId || "Dennis",
      modelId: modelId || "inworld-tts-1.5-max",
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 22050 },
      temperature: 1.0,
      applyTextNormalization: "ON",
    }),
  });
  if (!res.ok) throw new Error(`Inworld TTS failed: ${res.status}`);
  const data = await res.json();
  if (!data.audioContent) throw new Error("No audioContent in Inworld response");
  return Buffer.from(data.audioContent, "base64");
}


async function runMissingImageGeneration(projectId: string) {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return;

    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    const targets = allScenes.filter(s => s.image_status !== "completed");
    if (targets.length === 0) {
      const imagesCompleted = allScenes.filter(s => s.image_status === "completed").length;
      const imagesFailed = allScenes.filter(s => s.image_status === "failed").length;
      const audioCompleted = allScenes.filter(s => s.audio_status === "completed").length;
      const audioFailed = allScenes.filter(s => s.audio_status === "failed").length;
      const allDone = (imagesCompleted + imagesFailed) === allScenes.length && (audioCompleted + audioFailed) === allScenes.length;
      const finalStatus = (allDone && imagesFailed === 0 && audioFailed === 0) ? "completed" : "partial";
      await db.update(projects).set({ status: finalStatus }).where(eq(projects.id, projectId));
      return;
    }

    const imgDir = path.join("uploads", projectId, "images");
    fs.mkdirSync(imgDir, { recursive: true });

    let stopped = false;
    const checkStopped = async (): Promise<boolean> => {
      if (stopped) return true;
      const [projCheck] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
      if (projCheck?.status === "stopped") { stopped = true; return true; }
      return false;
    };

    const queue = [...targets];
    const workers = Array(Math.min(3, targets.length)).fill(null).map(async () => {
      while (queue.length > 0) {
        if (await checkStopped()) return;
        const scene = queue.shift()!;
        const num = scene.scene_number;
        try {
          throw new Error("Server-side image generation not supported. Use the project page to regenerate images via Gemini.");
          console.log(`${projectId}: generate-missing scene ${num} image done`);
        } catch (e: any) {
          console.error(`${projectId} scene ${num}: generate-missing failed: ${e.message}`);
          await db.update(scenes)
            .set({ image_status: "failed", image_attempts: (scene.image_attempts || 0) + 1, image_error: e.message, needs_review: true })
            .where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, num));
        }

        const updated = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
        await db.update(projects).set({ stats: {
          sceneCount: updated.length,
          imagesCompleted: updated.filter(s => s.image_status === "completed").length,
          audioCompleted: updated.filter(s => s.audio_status === "completed").length,
          imagesFailed: updated.filter(s => s.image_status === "failed").length,
          audioFailed: updated.filter(s => s.audio_status === "failed").length,
          needsReviewCount: updated.filter(s => s.needs_review).length,
          serverPipeline: true,
        }}).where(eq(projects.id, projectId));
      }
    });
    await Promise.all(workers);

    if (stopped) {
      console.log(`${projectId}: generate-missing stopped by user`);
      return;
    }

    const final = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    const ic = final.filter(s => s.image_status === "completed").length;
    const iF = final.filter(s => s.image_status === "failed").length;
    const ac = final.filter(s => s.audio_status === "completed").length;
    const aF = final.filter(s => s.audio_status === "failed").length;
    const allAccounted = (ic + iF) === final.length && (ac + aF) === final.length;
    const finalStatus = (allAccounted && iF === 0 && aF === 0) ? "completed" : "partial";
    await db.update(projects).set({
      status: finalStatus,
      stats: { sceneCount: final.length, imagesCompleted: ic, audioCompleted: ac, imagesFailed: iF, audioFailed: aF, needsReviewCount: final.filter(s => s.needs_review).length, serverPipeline: true },
    }).where(eq(projects.id, projectId));
    console.log(`${projectId}: generate-missing complete. Status: ${finalStatus} (${ic}/${final.length} images ok)`);
  } catch (e: any) {
    console.error(`${projectId}: generate-missing error:`, e.message);
    await db.update(projects).set({ status: "partial" }).where(eq(projects.id, projectId));
  }
}

router.post("/:id/generate-missing", async (req: Request, res: Response) => {
  const projectId = req.params.id;
  try {
    await db.update(projects).set({ status: "processing" }).where(eq(projects.id, projectId));
    res.status(202).json({ success: true });
    runMissingImageGeneration(projectId).catch(e =>
      console.error(`${projectId}: generate-missing crashed:`, e.message)
    );
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/scenes/append", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { scenes: sceneList } = req.body;
    if (!sceneList || !Array.isArray(sceneList)) return res.status(400).json({ error: "scenes array required" });

    const sceneRows = sceneList.map((s: any, i: number) => ({
      project_id: projectId,
      scene_number: s.scene_number || i + 1,
      scene_type: s.scene_type || "location",
      historical_period: s.historical_period || "generic historical",
      visual_priority: s.visual_priority || "environment",
      script_text: s.script_text || "",
      tts_text: s.tts_text || s.script_text || "",
      image_prompt: s.image_prompt || "",
      overlay_text: s.overlay_text ?? null,
      motion_prompt: s.motion_prompt || null,
      fallback_prompts: s.fallback_prompts || [],
      image_file: s.image_file || `${s.scene_number || i + 1}.png`,
      audio_file: s.audio_file || `${s.scene_number || i + 1}.mp3`,
      image_status: "pending",
      audio_status: "pending",
    }));

    await db.insert(scenes).values(sceneRows);

    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    await db.update(projects).set({
      stats: {
        sceneCount: allScenes.length,
        imagesCompleted: allScenes.filter((s: any) => s.image_status === "completed").length,
        audioCompleted: allScenes.filter((s: any) => s.audio_status === "completed").length,
        imagesFailed: allScenes.filter((s: any) => s.image_status === "failed").length,
        audioFailed: allScenes.filter((s: any) => s.audio_status === "failed").length,
        needsReviewCount: allScenes.filter((s: any) => s.needs_review).length,
      },
    }).where(eq(projects.id, projectId));

    res.json({ success: true, appended: sceneList.length, total: allScenes.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/scenes", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { scenes: sceneList } = req.body;
    if (!sceneList || !Array.isArray(sceneList)) return res.status(400).json({ error: "scenes array required" });

    const sceneRows = sceneList.map((s: any, i: number) => ({
      project_id: projectId,
      scene_number: s.scene_number || i + 1,
      scene_type: s.scene_type || "location",
      historical_period: s.historical_period || "generic historical",
      visual_priority: s.visual_priority || "environment",
      script_text: s.script_text || "",
      tts_text: s.tts_text || s.script_text || "",
      image_prompt: s.image_prompt || "",
      overlay_text: s.overlay_text ?? null,
      motion_prompt: s.motion_prompt || null,
      fallback_prompts: s.fallback_prompts || [],
      image_file: s.image_file || `${s.scene_number || i + 1}.png`,
      audio_file: s.audio_file || `${s.scene_number || i + 1}.mp3`,
      image_status: "pending",
      audio_status: "pending",
    }));

    await db.insert(scenes).values(sceneRows);

    const hasInworldKey = !!process.env.INWORLD_API_KEY;
    const projectSettings = (await db.select({ settings: projects.settings }).from(projects).where(eq(projects.id, projectId)))[0]?.settings as any;
    const ttsProvider = projectSettings?.ttsProvider || "inworld";

    const serverCanHandleImages = false; // Images are generated client-side via Gemini
    const serverCanHandleAudio = ttsProvider === "inworld" && hasInworldKey;
    const serverPipeline = serverCanHandleImages && serverCanHandleAudio;

    await db.update(projects).set({
      status: "processing",
      stats: { sceneCount: sceneList.length, imagesCompleted: 0, audioCompleted: 0, imagesFailed: 0, audioFailed: 0, needsReviewCount: 0, serverPipeline },
    }).where(eq(projects.id, projectId));

    res.json({ success: true, serverPipeline });

    if (serverPipeline) {
      runAssetPipeline(projectId).catch(console.error);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id/scenes/:sceneNumber", async (req: Request, res: Response) => {
  try {
    const { id: projectId, sceneNumber } = req.params;
    const num = Number(sceneNumber);

    await db.delete(scenes)
      .where(eq(scenes.project_id, projectId))
      .where(eq(scenes.scene_number, num));

    const imgDir = path.join("uploads", projectId, "images");
    const audioDir = path.join("uploads", projectId, "audio");
    for (const ext of ["png", "svg"]) {
      const p = path.join(imgDir, `${num}.${ext}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const audioPath = path.join(audioDir, `${num}.mp3`);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    const stats = {
      sceneCount: allScenes.length,
      imagesCompleted: allScenes.filter((s: any) => s.image_status === "completed").length,
      audioCompleted: allScenes.filter((s: any) => s.audio_status === "completed").length,
      imagesFailed: allScenes.filter((s: any) => s.image_status === "failed").length,
      audioFailed: allScenes.filter((s: any) => s.audio_status === "failed").length,
      needsReviewCount: allScenes.filter((s: any) => s.needs_review).length,
    };
    await db.update(projects).set({ stats }).where(eq(projects.id, projectId));

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id/scenes/:sceneNumber", async (req: Request, res: Response) => {
  try {
    const { id: projectId, sceneNumber } = req.params;
    const updates = req.body;
    await db.update(scenes).set(updates)
      .where(eq(scenes.project_id, projectId))
      .where(eq(scenes.scene_number, Number(sceneNumber)));

    // Recalculate and update project stats to stay in sync
    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    const stats = {
      sceneCount: allScenes.length,
      imagesCompleted: allScenes.filter((s: any) => s.image_status === "completed").length,
      audioCompleted: allScenes.filter((s: any) => s.audio_status === "completed").length,
      imagesFailed: allScenes.filter((s: any) => s.image_status === "failed").length,
      audioFailed: allScenes.filter((s: any) => s.audio_status === "failed").length,
      needsReviewCount: allScenes.filter((s: any) => s.needs_review).length,
    };
    
    // Preserve any existing serverPipeline flag if present
    const [existingProject] = await db.select({ stats: projects.stats }).from(projects).where(eq(projects.id, projectId));
    const currentStats = (existingProject?.stats as any) || {};
    if (currentStats.serverPipeline) {
      (stats as any).serverPipeline = currentStats.serverPipeline;
    }

    await db.update(projects).set({ stats }).where(eq(projects.id, projectId));

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    await db.update(projects).set(updates).where(eq(projects.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/projects/:id/fix-mocks
 * Scans scenes with .svg image_file (mock placeholders) and resets them to failed
 * so the user can regenerate them with a real provider.
 */
router.post("/:id/fix-mocks", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    let fixed = 0;
    for (const scene of allScenes) {
      const isMock =
        (scene.image_file && scene.image_file.endsWith(".svg")) ||
        (() => {
          const svgPath = path.join("uploads", projectId, "images", `${scene.scene_number}.svg`);
          const pngPath = path.join("uploads", projectId, "images", `${scene.scene_number}.png`);
          return fs.existsSync(svgPath) && !fs.existsSync(pngPath);
        })();
      if (isMock) {
        // Delete the svg file so it doesn't get served
        const svgPath = path.join("uploads", projectId, "images", `${scene.scene_number}.svg`);
        if (fs.existsSync(svgPath)) fs.unlinkSync(svgPath);
        await db.update(scenes)
          .set({ image_status: "failed", image_file: null, image_error: "Mock placeholder — click Regen Image to generate a real image.", needs_review: true })
          .where(eq(scenes.project_id, projectId))
          .where(eq(scenes.scene_number, scene.scene_number));
        fixed++;
      }
    }
    
    if (fixed > 0) {
      const finalScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
      const stats = {
        sceneCount: finalScenes.length,
        imagesCompleted: finalScenes.filter(s => s.image_status === "completed").length,
        audioCompleted: finalScenes.filter(s => s.audio_status === "completed").length,
        imagesFailed: finalScenes.filter(s => s.image_status === "failed").length,
        audioFailed: finalScenes.filter(s => s.audio_status === "failed").length,
        needsReviewCount: finalScenes.filter(s => s.needs_review).length,
      };
      
      const [existingProject] = await db.select({ stats: projects.stats }).from(projects).where(eq(projects.id, projectId));
      const currentStats = (existingProject?.stats as any) || {};
      if (currentStats.serverPipeline) {
        (stats as any).serverPipeline = currentStats.serverPipeline;
      }
      
      await db.update(projects).set({ stats }).where(eq(projects.id, projectId));
    }

    res.json({ success: true, fixed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/sync-audio-status", async (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return res.status(404).json({ error: "Project not found" });

    const allScenes = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .orderBy(scenes.scene_number);

    const pending = allScenes.filter(s => s.audio_status !== "completed");
    let synced = 0;

    for (const scene of pending) {
      const audioPath = path.join("uploads", projectId, "audio", `${scene.scene_number}.mp3`);
      if (fs.existsSync(audioPath)) {
        await db.update(scenes)
          .set({ audio_status: "completed", audio_file: `${scene.scene_number}.mp3`, audio_attempts: 1 })
          .where(eq(scenes.project_id, projectId))
          .where(eq(scenes.scene_number, scene.scene_number));
        synced++;
      }
    }

    const finalScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    const audioCompleted = finalScenes.filter(s => s.audio_status === "completed").length;
    const imageCompleted = finalScenes.filter(s => s.image_status === "completed").length;
    const hasFailures = finalScenes.some(s => s.audio_status === "failed" || s.image_status === "failed");
    const newStatus = (audioCompleted === finalScenes.length && imageCompleted === finalScenes.length && !hasFailures)
      ? "completed" : "partial";
    await db.update(projects)
      .set({
        status: newStatus,
        stats: {
          totalScenes: finalScenes.length,
          imagesCompleted: imageCompleted,
          audioCompleted,
          imagesFailed: finalScenes.filter(s => s.image_status === "failed").length,
          audioFailed: finalScenes.filter(s => s.audio_status === "failed").length,
        },
      })
      .where(eq(projects.id, projectId));

    res.json({ synced, total: pending.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { runAssetPipeline, generateInworldAudio };
export default router;
