// Re-export shared utilities so existing imports and tests continue to work
export {
  estimateSceneCount,
  chunkScript,
  parseJsonResponse,
  buildContinuityAnchor,
  type OutputScene,
  type ScriptToJsonResult,
  type ScriptToJsonParams,
} from "../../shared/scriptToJsonUtils";

import {
  type OutputScene,
  type ScriptToJsonResult,
  type ScriptToJsonParams,
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

export type ProgressCallback = (
  phase: "pass1" | "pass2",
  done: number,
  total: number,
  partialScenes?: OutputScene[]
) => void;

// ── API proxy helper ──────────────────────────────────────────────────────────

async function apiProxy(body: Record<string, unknown>): Promise<any> {
  const res = await fetch("/api/gemini-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API proxy error (HTTP ${res.status}): ${errText.substring(0, 200)}`);
  }
  return res.json();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Pass 1 — Scene splitting ──────────────────────────────────────────────────

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
  const result = await apiProxy({
    action: isGroq ? "groq-chat" : "nvidia-chat",
    apiKey,
    payload: isGroq
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
        },
  });

  if (result.status && result.status >= 400) {
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
      throw new Error(`${provider === "groq" ? "Groq" : "NVIDIA"} API key is invalid. Update it in Settings.`);
    throw new Error(`${provider} Pass 1 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const content: string = result.data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`No content from ${provider} during scene splitting`);

  try {
    const parsed = parseJsonResponse(content);
    return (parsed.scenes ?? []) as SplitScene[];
  } catch {
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying with strict instruction`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, retryOnRateLimit, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting`);
  }
}

// ── Pass 2 — Prompt generation ────────────────────────────────────────────────

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
  const result = await apiProxy({
    action: isGroq ? "groq-chat" : "nvidia-chat",
    apiKey,
    payload: isGroq
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
        },
  });

  if (result.status && result.status >= 400) {
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
      throw new Error(`${provider === "groq" ? "Groq" : "NVIDIA"} API key is invalid. Update it in Settings.`);
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

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runScriptToJson(
  params: ScriptToJsonParams,
  onProgress: ProgressCallback
): Promise<ScriptToJsonResult> {
  const { title, script, secondsPerScene, style, provider } = params;
  const apiKey = (provider === "groq" ? params.groqApiKey : params.nvidiaApiKey) ?? "";
  if (!apiKey) throw new Error(`No API key provided for ${provider}`);

  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  const batchSize = provider === "groq" ? GROQ_BATCH_SIZE : NVIDIA_BATCH_SIZE;

  // ── Pass 1: scene splitting ─────────────────────────────────────────────────
  const chunks = chunkScript(script, PASS1_CHUNK_MAX_WORDS);
  onProgress("pass1", 0, chunks.length);

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
    if (scenes.length === 0) {
      console.warn(`[${provider}] Pass1 chunk ${i + 1}/${chunks.length} returned 0 scenes`);
    }
    allSplitScenes.push(...scenes);
    nextId += scenes.length;
    onProgress("pass1", i + 1, chunks.length);
  }

  if (allSplitScenes.length === 0) throw new Error("No scenes were generated from the script");

  // ── Pass 2: prompt generation ───────────────────────────────────────────────
  const totalBatches = Math.ceil(allSplitScenes.length / batchSize);
  onProgress("pass2", 0, allSplitScenes.length);

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
    onProgress("pass2", doneSoFar, allSplitScenes.length, partialScenes);
  }

  const scenes: OutputScene[] = allSplitScenes.map((s) => ({
    image: `${s.id}.png`,
    script: s.script,
    prompt: promptMap.get(s.id) ?? "[generation failed]",
    overlay_text: s.overlay_text,
  }));

  return { title, scenes };
}
