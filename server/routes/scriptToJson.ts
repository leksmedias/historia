import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import {
  type OutputScene,
  type ScriptToJsonResult,
  type SplitScene,
  WORDS_PER_MINUTE,
  PASS1_CHUNK_MAX_WORDS,
  GROQ_BATCH_SIZE,
  NVIDIA_BATCH_SIZE,
  chunkScript,
  parseJsonResponse,
  recoverScenesRegex,
  recoverPromptsRegex,
  buildContinuityAnchor,
  buildPass1SystemPrompt,
  PASS2_IMPASTO_SYSTEM,
  PASS2_WWII_SYSTEM,
  getGroqModelConfig,
} from "../../shared/scriptToJsonUtils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface JobProgress {
  phase: "pass1" | "pass2";
  done: number;
  total: number;
  partialScenes?: OutputScene[];
}

interface Job {
  id: string;
  status: "running" | "completed" | "failed";
  progress: JobProgress;
  result: ScriptToJsonResult | null;
  error: string | null;
  createdAt: number;
  params?: Omit<JobParams, "apiKey">;
}

interface JobParams {
  title: string;
  script: string;
  secondsPerScene: number;
  style: "impasto" | "ww2";
  provider: "groq" | "nvidia" | "claude";
  apiKey: string;
  claudeModel?: string;
  groqModel?: string;
}

// ── Job store ─────────────────────────────────────────────────────────────────

const jobs = new Map<string, Job>();
const JOBS_FILE_PATH = path.join(process.cwd(), "uploads", "script_to_json_jobs.json");

function saveJobsToDisk() {
  try {
    const dir = path.dirname(JOBS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = Array.from(jobs.entries());
    fs.writeFileSync(JOBS_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (e: any) {
    console.error("[scriptToJson] Failed to save jobs to disk:", e.message);
  }
}

function loadJobsFromDisk() {
  try {
    if (fs.existsSync(JOBS_FILE_PATH)) {
      const text = fs.readFileSync(JOBS_FILE_PATH, "utf-8");
      const data = JSON.parse(text) as Array<[string, Job]>;
      let updated = false;
      for (const [id, job] of data) {
        if (job.status === "running") {
          job.status = "failed";
          job.error = "Job interrupted by server restart";
          updated = true;
        }
        jobs.set(id, job);
      }
      console.log(`[scriptToJson] Loaded ${jobs.size} jobs from history.`);
      if (updated) {
        saveJobsToDisk();
      }
    }
  } catch (e: any) {
    console.error("[scriptToJson] Failed to load jobs from disk:", e.message);
  }
}

// Load jobs on startup
loadJobsFromDisk();

const FALLBACK_NVIDIA_KEY =
  "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";

// ── Direct API call ───────────────────────────────────────────────────────────

import { PROJECT_ID, getAccessToken } from "../lib/gemini.js";

async function callApi(
  provider: "groq" | "nvidia" | "claude",
  apiKey: string,
  payload: any
): Promise<{ status: number; data: any }> {
  if (provider === "claude") {
    const modelName = payload?.model || "";
    const isVertexClaude = modelName.startsWith("publishers/") || modelName.includes("@") || modelName === "claude-haiku-4-5" || modelName === "claude-sonnet-4-6";

    if (isVertexClaude) {
      try {
        const modelPath = modelName.startsWith("publishers/") 
          ? modelName 
          : `publishers/anthropic/models/${modelName}`;
        
        const region = "global";
        const host = "aiplatform.googleapis.com";
        const url = `https://${host}/v1/projects/${PROJECT_ID}/locations/${region}/${modelPath}:rawPredict`;
        const accessToken = getAccessToken();

        const { model, ...bodyWithoutModel } = payload;
        const vertexPayload = {
          ...bodyWithoutModel,
          anthropic_version: "vertex-2023-10-16"
        };

        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify(vertexPayload)
        });

        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
        return { status: r.status, data };
      } catch (e: any) {
        console.error("[scriptToJson] Vertex Claude call failed:", e.message);
        return { status: 500, data: { error: e.message } };
      }
    }

    // Fallback to Anthropic API
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return { status: 500, data: { error: "ANTHROPIC_API_KEY not configured" } };
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
    return { status: r.status, data };
  }

  const key =
    apiKey ||
    (provider === "groq"
      ? process.env.GROQ_API_KEY
      : process.env.NVIDIA_API_KEY || FALLBACK_NVIDIA_KEY) ||
    "";
  const url =
    provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://integrate.api.nvidia.com/v1/chat/completions";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.substring(0, 1000) };
  }
  return { status: r.status, data };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Pass 1 ────────────────────────────────────────────────────────────────────

async function callPass1(
  chunk: string,
  startId: number,
  wordsPerScene: number,
  secondsPerScene: number,
  provider: "groq" | "nvidia" | "claude",
  apiKey: string,
  claudeModel?: string,
  groqModel?: string,
  rateLimitRetries = 3,
  retryOnParseFailure = true
): Promise<SplitScene[]> {
  const systemPrompt = buildPass1SystemPrompt(wordsPerScene, secondsPerScene, startId);
  const userPrompt = `Split this script excerpt into scenes:\n\n${chunk}\n\nReturn ONLY the JSON object.`;

  const groqConfig = getGroqModelConfig(groqModel || "llama-3.3-70b-versatile");
  const promptTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3.8);
  const maxTokens = Math.max(1024, Math.min(4096, groqConfig.tpm - promptTokens - 200));
  const payload =
    provider === "groq"
      ? {
          model: groqConfig.id,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }
      : provider === "claude"
      ? {
          model: claudeModel || "claude-haiku-4-5-20251001",
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 4096,
        }
      : {
          model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          top_p: 0.95,
          max_tokens: 32768,
          extra_body: {
            chat_template_kwargs: { enable_thinking: true },
            reasoning_budget: 8192,
          },
        };

  const result = await callApi(provider, apiKey, payload);

  if (result.status >= 400) {
    const errText =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
    if ((result.status === 429 || result.status === 413) && rateLimitRetries > 0) {
      const waitTime = (4 - rateLimitRetries) * 15000;
      console.log(`[${provider}] Pass1 rate limited (${result.status}) — waiting ${waitTime / 1000}s (attempts left: ${rateLimitRetries})...`);
      await delay(waitTime);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, claudeModel, groqModel, rateLimitRetries - 1, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : provider === "claude" ? "Claude" : "NVIDIA"} API key is invalid.`);
    throw new Error(`${provider} Pass 1 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  let content = "";
  if (provider === "claude") {
    content = result.data?.content?.[0]?.text ?? "";
  } else {
    content = result.data?.choices?.[0]?.message?.content ?? "";
    if (!content && result.data?.choices?.[0]?.message?.reasoning_content) {
      content = result.data.choices[0].message.reasoning_content;
    }
    if (!content && result.data?.choices?.[0]?.message?.reasoning) {
      content = result.data.choices[0].message.reasoning;
    }
  }

  if (!content) {
    console.error(`[${provider}] Pass1 result data:`, JSON.stringify(result.data));
    throw new Error(`No content from ${provider} during scene splitting`);
  }

  try {
    const parsed = parseJsonResponse(content);
    return (parsed.scenes ?? []) as SplitScene[];
  } catch (err: any) {
    const recovered = recoverScenesRegex(content);
    if (recovered.length > 0) {
      console.log(`[${provider}] Pass1: Recovered ${recovered.length} scenes via regex from malformed/truncated output.`);
      return recovered;
    }
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, claudeModel, groqModel, rateLimitRetries, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting: ${err.message}`);
  }
}

// ── Pass 2 ────────────────────────────────────────────────────────────────────

async function callPass2Batch(
  title: string,
  scenes: SplitScene[],
  style: "impasto" | "ww2",
  provider: "groq" | "nvidia" | "claude",
  apiKey: string,
  continuityAnchor: string,
  claudeModel?: string,
  groqModel?: string,
  rateLimitRetries = 3,
  retryOnParseFailure = true
): Promise<Array<{ id: number; prompt: string }>> {
  const baseSystem = style === "ww2" ? PASS2_WWII_SYSTEM : PASS2_IMPASTO_SYSTEM;
  const systemPrompt = continuityAnchor ? `${baseSystem}\n\n${continuityAnchor}` : baseSystem;

  const scenesText = scenes.map((s) => `Scene ${s.id}: "${s.script}"`).join("\n");
  const firstId = scenes[0].id;
  const secondId = scenes.length > 1 ? scenes[1].id : firstId + 1;
  const userPrompt = `Documentary title: "${title}"\n\nGenerate ONE image prompt for each scene below. Return ONLY a JSON object with a "scenes" array:\n\n${scenesText}\n\nReturn format: {"scenes":[{"id":${firstId},"prompt":"..."},{"id":${secondId},"prompt":"..."}]}`;

  const groqConfig = getGroqModelConfig(groqModel || "llama-3.3-70b-versatile");
  const promptTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 3.8);
  const maxTokens = Math.max(1024, Math.min(4096, groqConfig.tpm - promptTokens - 200));
  const payload =
    provider === "groq"
      ? {
          model: groqConfig.id,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }
      : provider === "claude"
      ? {
          model: claudeModel || "claude-haiku-4-5-20251001",
          system: systemPrompt,
          messages: [
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 4096,
        }
      : {
          model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.6,
          top_p: 0.95,
          max_tokens: 65536,
          extra_body: {
            chat_template_kwargs: { enable_thinking: true },
            reasoning_budget: 16384,
          },
        };

  const result = await callApi(provider, apiKey, payload);

  if (result.status >= 400) {
    const errText =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
    if ((result.status === 429 || result.status === 413) && rateLimitRetries > 0) {
      const waitTime = (4 - rateLimitRetries) * 15000;
      console.log(`[${provider}] Pass2 rate limited (${result.status}) — waiting ${waitTime / 1000}s (attempts left: ${rateLimitRetries})...`);
      await delay(waitTime);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, claudeModel, groqModel, rateLimitRetries - 1, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : provider === "claude" ? "Claude" : "NVIDIA"} API key is invalid.`);
    throw new Error(`${provider} Pass 2 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  let content = "";
  if (provider === "claude") {
    content = result.data?.content?.[0]?.text ?? "";
  } else {
    content = result.data?.choices?.[0]?.message?.content ?? "";
    if (!content && result.data?.choices?.[0]?.message?.reasoning_content) {
      content = result.data.choices[0].message.reasoning_content;
    }
    if (!content && result.data?.choices?.[0]?.message?.reasoning) {
      content = result.data.choices[0].message.reasoning;
    }
  }

  if (!content) {
    console.error(`[${provider}] Pass2 result data:`, JSON.stringify(result.data));
    throw new Error(`No content from ${provider} during prompt generation`);
  }

  try {
    const parsed = parseJsonResponse(content);
    return parsed.scenes ?? [];
  } catch (err: any) {
    const recovered = recoverPromptsRegex(content);
    if (recovered.length > 0) {
      console.log(`[${provider}] Pass2: Recovered ${recovered.length} prompts via regex from malformed/truncated output.`);
      return recovered;
    }
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass2 JSON parse failed — retrying`);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, claudeModel, groqModel, rateLimitRetries, false);
    }
    console.error(`[${provider}] Pass2 JSON parse failed twice — using placeholders. Error: ${err.message}`);
    return scenes.map((s) => ({ id: s.id, prompt: "[generation failed]" }));
  }
}

// ── Pipeline runner ───────────────────────────────────────────────────────────

async function runJob(job: Job, params: JobParams): Promise<void> {
  const { title, script, secondsPerScene, style, provider, apiKey, claudeModel, groqModel } = params;
  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  const batchSize = provider === "groq" 
    ? GROQ_BATCH_SIZE 
    : provider === "claude" 
    ? 5 
    : NVIDIA_BATCH_SIZE;

  const groqConfig = getGroqModelConfig(groqModel || "llama-3.3-70b-versatile");
  
  // Calculate dynamic delays for Groq based on rate limits to prevent TPM 429s
  let delayPass1 = Math.ceil(60000 / groqConfig.rpm);
  if (groqConfig.tpm <= 15000) {
    delayPass1 = Math.max(delayPass1, Math.ceil(90000 / groqConfig.tpm * 1000));
  }
  let delayPass2 = Math.ceil(60000 / groqConfig.rpm);
  if (groqConfig.tpm <= 15000) {
    delayPass2 = Math.max(delayPass2, Math.ceil(90000 / groqConfig.tpm * 1000));
  }

  try {
    // Pass 1
    const chunks = chunkScript(script, PASS1_CHUNK_MAX_WORDS);
    job.progress = { phase: "pass1", done: 0, total: chunks.length };
    saveJobsToDisk();

    const allSplitScenes: SplitScene[] = [];
    let nextId = 1;

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        // Space out requests to avoid hitting TPM rate limits
        await delay(provider === "groq" ? delayPass1 : 2000);
      }
      const scenes = await callPass1(
        chunks[i],
        nextId,
        wordsPerScene,
        secondsPerScene,
        provider,
        apiKey,
        claudeModel,
        groqModel
      );
      scenes.forEach((s, idx) => { s.id = nextId + idx; });
      allSplitScenes.push(...scenes);
      nextId += scenes.length;
      job.progress = { phase: "pass1", done: i + 1, total: chunks.length };
      saveJobsToDisk();
    }

    if (allSplitScenes.length === 0) throw new Error("No scenes were generated from the script");

    // Pass 2
    const totalBatches = Math.ceil(allSplitScenes.length / batchSize);
    job.progress = { phase: "pass2", done: 0, total: allSplitScenes.length };
    saveJobsToDisk();

    const promptMap = new Map<number, string>();
    const completedForAnchor: Array<{ script: string; prompt: string }> = [];

    for (let b = 0; b < totalBatches; b++) {
      if (b > 0) {
        // Space out requests to avoid hitting TPM rate limits
        await delay(provider === "groq" ? delayPass2 : 2000);
      }
      const batch = allSplitScenes.slice(b * batchSize, (b + 1) * batchSize);
      const anchor = buildContinuityAnchor(completedForAnchor);
      const results = await callPass2Batch(title, batch, style, provider, apiKey, anchor, claudeModel, groqModel);

      for (const r of results) {
        const idVal = r.id ?? r.scene_number ?? r.sceneNumber ?? r.scene_id ?? r.scene_Id;
        const promptVal = r.prompt ?? r.image_prompt ?? r.description ?? r.imagePrompt;
        if (idVal !== undefined && promptVal !== undefined) {
          promptMap.set(Number(idVal), promptVal);
        }
      }
      for (const scene of batch) {
        const prompt = promptMap.get(scene.id) ?? "[generation failed]";
        completedForAnchor.push({ script: scene.script, prompt });
      }

      const doneSoFar = Math.min((b + 1) * batchSize, allSplitScenes.length);
      const partialScenes: OutputScene[] = allSplitScenes
        .filter((s) => promptMap.has(s.id))
        .map((s) => ({
          image: `${s.id}.png`,
          script: s.script,
          prompt: promptMap.get(s.id)!,
          overlay_text: s.overlay_text,
        }));
      job.progress = { phase: "pass2", done: doneSoFar, total: allSplitScenes.length, partialScenes };
      saveJobsToDisk();
    }

    const scenes: OutputScene[] = allSplitScenes.map((s) => ({
      image: `${s.id}.png`,
      script: s.script,
      prompt: promptMap.get(s.id) ?? "[generation failed]",
      overlay_text: s.overlay_text,
    }));

    job.status = "completed";
    job.result = { title, scenes };
    saveJobsToDisk();
  } catch (e: any) {
    job.status = "failed";
    job.error = e.message ?? "Unknown error";
    console.error(`[scriptToJson] Job ${job.id} failed:`, e.message);
    saveJobsToDisk();
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = Router();

// GET all jobs (history)
router.get("/", (_req: Request, res: Response) => {
  const jobList = Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  res.json(jobList);
});

router.post("/", (req: Request, res: Response) => {
  const { title, script, secondsPerScene, style, provider, apiKey, claudeModel, groqModel } = req.body as JobParams;

  if (!title || !script || !provider) {
    return res.status(400).json({ error: "title, script, and provider are required" });
  }
  if (!["groq", "nvidia", "claude"].includes(provider)) {
    return res.status(400).json({ error: "provider must be groq, nvidia, or claude" });
  }
  if (!apiKey && !process.env.GROQ_API_KEY && provider === "groq") {
    return res.status(400).json({ error: "No Groq API key. Set one in Settings." });
  }
  if (provider === "claude") {
    const isVertex = claudeModel?.startsWith("publishers/") || claudeModel?.includes("@") || claudeModel === "claude-haiku-4-5";
    if (!isVertex && !apiKey && !process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: "No Anthropic API key. Set one in Settings." });
    }
  }

  const jobId = crypto.randomUUID();
  const job: Job = {
    id: jobId,
    status: "running",
    progress: { phase: "pass1", done: 0, total: 1 },
    result: { title, scenes: [] },
    error: null,
    createdAt: Date.now(),
    params: {
      title: title.trim(),
      script: script.trim(),
      secondsPerScene: secondsPerScene ?? 15,
      style: style ?? "impasto",
      provider,
      claudeModel,
      groqModel,
    }
  };
  jobs.set(jobId, job);
  saveJobsToDisk();

  // Fire and forget — runs in background
  runJob(job, { title, script, secondsPerScene: secondsPerScene ?? 15, style: style ?? "impasto", provider, apiKey: apiKey ?? "", claudeModel, groqModel });

  res.json({ jobId });
});

router.get("/:jobId", (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
  });
});

// DELETE a specific job from history
router.delete("/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (jobs.has(jobId)) {
    jobs.delete(jobId);
    saveJobsToDisk();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Job not found" });
  }
});

export default router;
