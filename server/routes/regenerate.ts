import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, scenes } from "../../shared/schema";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { generateGeminiImage } from "../lib/gemini.js";

const router = Router();

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


router.post("/", async (req: Request, res: Response) => {
  try {
    const { projectId, sceneNumber, type, voiceOverride } = req.body;

    const [scene] = await db.select().from(scenes)
      .where(eq(scenes.project_id, projectId))
      .where(eq(scenes.scene_number, sceneNumber));
    if (!scene) return res.status(404).json({ error: "Scene not found" });

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    const settings = (project?.settings as any) || {};
    const ttsProvider = settings.ttsProvider || "inworld";
    const voiceId = voiceOverride || scene.voice_id || settings.voiceId || "Dennis";
    const modelId = settings.modelId || "inworld-tts-1.5-max";

    if (type === "image") {
      const imgDir = path.join("uploads", projectId, "images");
      fs.mkdirSync(imgDir, { recursive: true });

      const regenStylePrompt: string | undefined = settings.stylePrompt;

      try {
        const rawPrompts = [scene.image_prompt, ...(scene.fallback_prompts as string[] || [])];
        const prompt = regenStylePrompt
          ? `${rawPrompts[0]}, ${regenStylePrompt}`
          : rawPrompts[0];
        const base64 = await generateGeminiImage(prompt);
        const bytes = Buffer.from(base64, "base64");
        fs.writeFileSync(path.join(imgDir, `${sceneNumber}.png`), bytes);
        await db.update(scenes).set({
          image_status: "completed",
          image_attempts: (scene.image_attempts || 0) + 1,
          image_error: null,
          needs_review: false,
        }).where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, sceneNumber));
      } catch (e: any) {
        await db.update(scenes).set({
          image_status: "failed",
          image_attempts: (scene.image_attempts || 0) + 1,
          image_error: e.message,
          needs_review: true,
        }).where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, sceneNumber));
        throw e;
      }
    } else if (type === "audio") {
      const audioDir = path.join("uploads", projectId, "audio");
      fs.mkdirSync(audioDir, { recursive: true });

      try {
        const inworldKey = process.env.INWORLD_API_KEY;
        let bytes: Buffer;
        if (ttsProvider === "inworld" && inworldKey) {
          bytes = await generateInworldAudio(scene.tts_text || scene.script_text || "", inworldKey, voiceId, modelId);
        } else {
          throw new Error("No TTS provider configured. Set ttsProvider to 'inworld' in project settings.");
        }
        fs.writeFileSync(path.join(audioDir, `${sceneNumber}.mp3`), bytes);
        await db.update(scenes).set({
          audio_status: "completed",
          audio_attempts: (scene.audio_attempts || 0) + 1,
          audio_error: null,
          needs_review: false,
        }).where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, sceneNumber));
      } catch (e: any) {
        await db.update(scenes).set({
          audio_status: "failed",
          audio_attempts: (scene.audio_attempts || 0) + 1,
          audio_error: e.message,
          needs_review: true,
        }).where(eq(scenes.project_id, projectId)).where(eq(scenes.scene_number, sceneNumber));
        throw e;
      }
    }

    const allScenes = await db.select().from(scenes).where(eq(scenes.project_id, projectId));
    const stats = {
      sceneCount: allScenes.length,
      imagesCompleted: allScenes.filter((s: any) => s.image_status === "completed").length,
      audioCompleted: allScenes.filter((s: any) => s.audio_status === "completed").length,
      imagesFailed: allScenes.filter((s: any) => s.image_status === "failed").length,
      audioFailed: allScenes.filter((s: any) => s.audio_status === "failed").length,
      needsReviewCount: allScenes.filter((s: any) => s.needs_review).length,
    };
    const status = (stats.imagesFailed > 0 || stats.audioFailed > 0) ? "partial" : "completed";
    await db.update(projects).set({ stats, status }).where(eq(projects.id, projectId));

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
