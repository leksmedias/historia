import { Router, Request, Response } from "express";
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
  buildContinuityAnchor,
  buildPass1SystemPrompt,
  PASS2_IMPASTO_SYSTEM,
  PASS2_WWII_SYSTEM,
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
}

interface JobParams {
  title: string;
  script: string;
  secondsPerScene: number;
  style: "impasto" | "ww2";
  provider: "groq" | "nvidia";
  apiKey: string;
}

// ── Job store ─────────────────────────────────────────────────────────────────

const jobs = new Map<string, Job>();

// Clean up jobs older than 2 hours
const cleanup = setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 60 * 60 * 1000);
// Allow process to exit cleanly (don't block shutdown)
if (cleanup.unref) cleanup.unref();

const FALLBACK_NVIDIA_KEY =
  "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";

// ── Direct API call ───────────────────────────────────────────────────────────

async function callApi(
  provider: "groq" | "nvidia",
  apiKey: string,
  payload: object
): Promise<{ status: number; data: any }> {
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
  provider: "groq" | "nvidia",
  apiKey: string,
  retryOnRateLimit = true,
  retryOnParseFailure = true
): Promise<SplitScene[]> {
  const systemPrompt = buildPass1SystemPrompt(wordsPerScene, secondsPerScene, startId);
  const userPrompt = `Split this script excerpt into scenes:\n\n${chunk}\n\nReturn ONLY the JSON object.`;

  const isGroq = provider === "groq";
  const result = await callApi(
    provider,
    apiKey,
    isGroq
      ? {
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 4096,
          response_format: { type: "json_object" },
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
        }
  );

  if (result.status >= 400) {
    const errText =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
    if ((result.status === 429 || result.status === 413) && retryOnRateLimit) {
      console.log(`[${provider}] Pass1 rate limited (${result.status}) — waiting 15s...`);
      await delay(15000);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, false, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : "NVIDIA"} API key is invalid.`);
    throw new Error(`${provider} Pass 1 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const content: string = result.data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`No content from ${provider} during scene splitting`);

  try {
    const parsed = parseJsonResponse(content);
    return (parsed.scenes ?? []) as SplitScene[];
  } catch {
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, retryOnRateLimit, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting`);
  }
}

// ── Pass 2 ────────────────────────────────────────────────────────────────────

async function callPass2Batch(
  title: string,
  scenes: SplitScene[],
  style: "impasto" | "ww2",
  provider: "groq" | "nvidia",
  apiKey: string,
  continuityAnchor: string,
  retryOnRateLimit = true,
  retryOnParseFailure = true
): Promise<Array<{ id: number; prompt: string }>> {
  const baseSystem = style === "ww2" ? PASS2_WWII_SYSTEM : PASS2_IMPASTO_SYSTEM;
  const systemPrompt = continuityAnchor ? `${baseSystem}\n\n${continuityAnchor}` : baseSystem;

  const scenesText = scenes.map((s) => `Scene ${s.id}: "${s.script}"`).join("\n");
  const firstId = scenes[0].id;
  const secondId = scenes.length > 1 ? scenes[1].id : firstId + 1;
  const userPrompt = `Documentary title: "${title}"\n\nGenerate ONE image prompt for each scene below. Return ONLY a JSON object with a "scenes" array:\n\n${scenesText}\n\nReturn format: {"scenes":[{"id":${firstId},"prompt":"..."},{"id":${secondId},"prompt":"..."}]}`;

  const isGroq = provider === "groq";
  const result = await callApi(
    provider,
    apiKey,
    isGroq
      ? {
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 4096,
          response_format: { type: "json_object" },
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
        }
  );

  if (result.status >= 400) {
    const errText =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
    if ((result.status === 429 || result.status === 413) && retryOnRateLimit) {
      console.log(`[${provider}] Pass2 rate limited (${result.status}) — waiting 15s...`);
      await delay(15000);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, false, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : "NVIDIA"} API key is invalid.`);
    throw new Error(`${provider} Pass 2 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const content: string = result.data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`No content from ${provider} during prompt generation`);

  try {
    const parsed = parseJsonResponse(content);
    return parsed.scenes ?? [];
  } catch {
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass2 JSON parse failed — retrying`);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, retryOnRateLimit, false);
    }
    console.error(`[${provider}] Pass2 JSON parse failed twice — using placeholders`);
    return scenes.map((s) => ({ id: s.id, prompt: "[generation failed]" }));
  }
}

// ── Pipeline runner ───────────────────────────────────────────────────────────

async function runJob(job: Job, params: JobParams): Promise<void> {
  const { title, script, secondsPerScene, style, provider, apiKey } = params;
  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  const batchSize = provider === "groq" ? GROQ_BATCH_SIZE : NVIDIA_BATCH_SIZE;

  try {
    // Pass 1
    const chunks = chunkScript(script, PASS1_CHUNK_MAX_WORDS);
    job.progress = { phase: "pass1", done: 0, total: chunks.length };

    const allSplitScenes: SplitScene[] = [];
    let nextId = 1;

    for (let i = 0; i < chunks.length; i++) {
      const scenes = await callPass1(
        chunks[i],
        nextId,
        wordsPerScene,
        secondsPerScene,
        provider,
        apiKey
      );
      scenes.forEach((s, idx) => { s.id = nextId + idx; });
      allSplitScenes.push(...scenes);
      nextId += scenes.length;
      job.progress = { phase: "pass1", done: i + 1, total: chunks.length };
    }

    if (allSplitScenes.length === 0) throw new Error("No scenes were generated from the script");

    // Pass 2
    const totalBatches = Math.ceil(allSplitScenes.length / batchSize);
    job.progress = { phase: "pass2", done: 0, total: allSplitScenes.length };

    const promptMap = new Map<number, string>();
    const completedForAnchor: Array<{ script: string; prompt: string }> = [];

    for (let b = 0; b < totalBatches; b++) {
      const batch = allSplitScenes.slice(b * batchSize, (b + 1) * batchSize);
      const anchor = buildContinuityAnchor(completedForAnchor);
      const results = await callPass2Batch(title, batch, style, provider, apiKey, anchor);

      for (const r of results) {
        promptMap.set(r.id, r.prompt);
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
    }

    const scenes: OutputScene[] = allSplitScenes.map((s) => ({
      image: `${s.id}.png`,
      script: s.script,
      prompt: promptMap.get(s.id) ?? "[generation failed]",
      overlay_text: s.overlay_text,
    }));

    job.status = "completed";
    job.result = { title, scenes };
  } catch (e: any) {
    job.status = "failed";
    job.error = e.message ?? "Unknown error";
    console.error(`[scriptToJson] Job ${job.id} failed:`, e.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = Router();

router.post("/", (req: Request, res: Response) => {
  const { title, script, secondsPerScene, style, provider, apiKey } = req.body as JobParams;

  if (!title || !script || !provider) {
    return res.status(400).json({ error: "title, script, and provider are required" });
  }
  if (!["groq", "nvidia"].includes(provider)) {
    return res.status(400).json({ error: "provider must be groq or nvidia" });
  }
  if (!apiKey && !process.env.GROQ_API_KEY && provider === "groq") {
    return res.status(400).json({ error: "No Groq API key. Set one in Settings." });
  }

  const jobId = crypto.randomUUID();
  const job: Job = {
    id: jobId,
    status: "running",
    progress: { phase: "pass1", done: 0, total: 1 },
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  // Fire and forget — runs in background
  runJob(job, { title, script, secondsPerScene: secondsPerScene ?? 15, style: style ?? "impasto", provider, apiKey: apiKey ?? "" });

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

export default router;
