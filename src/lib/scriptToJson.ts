// Re-export shared utilities so existing imports and tests continue to work
export {
  estimateSceneCount,
  chunkScript,
  parseJsonResponse,
  buildContinuityAnchor,
  recoverScenesRegex,
  recoverPromptsRegex,
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
  recoverScenesRegex,
  recoverPromptsRegex,
  buildContinuityAnchor,
  buildPass1SystemPrompt,
  PASS2_IMPASTO_SYSTEM,
  PASS2_WWII_SYSTEM,
  getGroqModelConfig,
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
    throw new Error(`API proxy error (HTTP ${res.status}): ${errText}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from API proxy: ${text.substring(0, 200)}`);
  }
}

async function callPass1(
  chunk: string,
  startId: number,
  wordsPerScene: number,
  secondsPerScene: number,
  provider: "groq" | "nvidia" | "claude",
  apiKey: string,
  groqModel?: string,
  claudeModel?: string,
  rateLimitRetries = 3,
  retryOnParseFailure = true
): Promise<SplitScene[]> {
  const systemPrompt = buildPass1SystemPrompt(wordsPerScene, secondsPerScene, startId);
  const userPrompt = `Split this script excerpt into scenes:\n\n${chunk}\n\nReturn ONLY the JSON object.`;

  const isGroq = provider === "groq";
  const isClaude = provider === "claude";
  const groqConfig = getGroqModelConfig(groqModel || "llama-3.3-70b-versatile");
  const result = await apiProxy({
    action: isGroq ? "groq-chat" : isClaude ? "claude-chat" : "nvidia-chat",
    apiKey,
    payload: isGroq
      ? {
        model: groqConfig.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: Math.min(10096, groqConfig.tpm),
        response_format: { type: "json_object" },
      }
      : isClaude
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
        max_tokens: 60768,
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
    if ((result.status === 429 || result.status === 413) && rateLimitRetries > 0) {
      const waitTime = (4 - rateLimitRetries) * 15000;
      console.log(`[${provider}] Pass1 rate limited (${result.status}) — waiting ${waitTime / 1000}s (attempts left: ${rateLimitRetries})...`);
      await delay(waitTime);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, groqModel, claudeModel, rateLimitRetries - 1, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : provider === "claude" ? "Claude" : "NVIDIA"} API key is invalid. Update it in Settings.`);
    throw new Error(`${provider} Pass 1 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  let content = "";
  if (isClaude) {
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
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying with strict instruction`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, groqModel, claudeModel, rateLimitRetries, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting: ${err.message}`);
  }
}

// ── Pass 2 — Prompt generation ────────────────────────────────────────────────

async function callPass2Batch(
  title: string,
  scenes: SplitScene[],
  style: "impasto" | "ww2",
  provider: "groq" | "nvidia" | "claude",
  apiKey: string,
  continuityAnchor: string,
  groqModel?: string,
  claudeModel?: string,
  rateLimitRetries = 3,
  retryOnParseFailure = true
): Promise<Array<{ id: number; prompt: string }>> {
  const baseSystem = style === "ww2" ? PASS2_WWII_SYSTEM : PASS2_IMPASTO_SYSTEM;
  const systemPrompt = continuityAnchor ? `${baseSystem}\n\n${continuityAnchor}` : baseSystem;

  const scenesText = scenes.map((s) => `Scene ${s.id}: "${s.script}"`).join("\n");
  const firstId = scenes[0].id;
  const secondId = scenes.length > 1 ? scenes[1].id : firstId + 1;
  const userPrompt = `Documentary title: "${title}"\n\nGenerate ONE image prompt for each scene below. Return ONLY a JSON object with a "scenes" array:\n\n${scenesText}\n\nReturn format: {"scenes":[{"id":${firstId},"prompt":"..."},{"id":${secondId},"prompt":"..."}]}`;

  const isGroq = provider === "groq";
  const isClaude = provider === "claude";
  const groqConfig = getGroqModelConfig(groqModel || "llama-3.3-70b-versatile");
  const result = await apiProxy({
    action: isGroq ? "groq-chat" : isClaude ? "claude-chat" : "nvidia-chat",
    apiKey,
    payload: isGroq
      ? {
        model: groqConfig.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: Math.min(10096, groqConfig.tpm),
        response_format: { type: "json_object" },
      }
      : isClaude
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
        max_tokens: 50536,
        extra_body: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_budget: 10384,
        },
      },
  });

  if (result.status && result.status >= 400) {
    const errText =
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
    if ((result.status === 429 || result.status === 413) && rateLimitRetries > 0) {
      const waitTime = (4 - rateLimitRetries) * 15000;
      console.log(`[${provider}] Pass2 rate limited (${result.status}) — waiting ${waitTime / 1000}s (attempts left: ${rateLimitRetries})...`);
      await delay(waitTime);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, groqModel, claudeModel, rateLimitRetries - 1, retryOnParseFailure);
    }
    if (result.status === 401)
      throw new Error(`${provider === "groq" ? "Groq" : provider === "claude" ? "Claude" : "NVIDIA"} API key is invalid.`);
    throw new Error(`${provider} Pass 2 error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  let content = "";
  if (isClaude) {
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
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, groqModel, claudeModel, rateLimitRetries, false);
    }
    console.error(`[${provider}] Pass2 JSON parse failed twice — using placeholders. Error: ${err.message}`);
    return scenes.map((s) => ({ id: s.id, prompt: "[generation failed]" }));
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runScriptToJson(
  params: ScriptToJsonParams,
  onProgress: ProgressCallback
): Promise<ScriptToJsonResult> {
  const { title, script, secondsPerScene, style, provider, claudeModel, groqModel } = params;
  const apiKey = (
    provider === "groq"
      ? params.groqApiKey
      : provider === "claude"
      ? params.anthropicApiKey
      : params.nvidiaApiKey
  ) ?? "";

  // Vertex AI Claude predictions do not require a client-side API key
  const isVertex = provider === "claude" && (
    claudeModel?.startsWith("publishers/") ||
    claudeModel?.includes("@") ||
    claudeModel === "claude-haiku-4-5" ||
    claudeModel === "claude-sonnet-4-6"
  );
  if (!apiKey && !isVertex) throw new Error(`No API key provided for ${provider}`);

  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  const batchSize = provider === "groq" ? GROQ_BATCH_SIZE : provider === "claude" ? 5 : NVIDIA_BATCH_SIZE;

  // ── Pass 1: scene splitting ─────────────────────────────────────────────────
  const chunks = chunkScript(script, PASS1_CHUNK_MAX_WORDS);
  onProgress("pass1", 0, chunks.length);

  const allSplitScenes: SplitScene[] = [];
  let nextId = 1;
  const groqConfig = getGroqModelConfig(params.groqModel || "llama-3.3-70b-versatile");

  // Calculate dynamic delays for Groq based on rate limits to prevent TPM 429s
  let delayPass1 = Math.ceil(60000 / groqConfig.rpm);
  if (groqConfig.tpm <= 15000) {
    delayPass1 = Math.max(delayPass1, Math.ceil(90000 / groqConfig.tpm * 1000));
  }
  let delayPass2 = Math.ceil(60000 / groqConfig.rpm);
  if (groqConfig.tpm <= 15000) {
    delayPass2 = Math.max(delayPass2, Math.ceil(90000 / groqConfig.tpm * 1000));
  }

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      // Space out requests to avoid hitting TPM rate limits
      let waitMs = 2000;
      if (provider === "groq") waitMs = delayPass1;
      else if (provider === "claude") waitMs = 12000;
      else if (provider === "nvidia") waitMs = 3000;
      await delay(waitMs);
    }
    const scenes = await callPass1(
      chunks[i],
      nextId,
      wordsPerScene,
      secondsPerScene,
      provider,
      apiKey,
      params.groqModel,
      params.claudeModel
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
    if (b > 0) {
      // Space out requests to avoid hitting TPM rate limits
      let waitMs = 1000;
      if (provider === "groq") waitMs = delayPass2;
      else if (provider === "claude") waitMs = 6000;
      else if (provider === "nvidia") waitMs = 2000;
      await delay(waitMs);
    }
    const batch = allSplitScenes.slice(b * batchSize, (b + 1) * batchSize);
    const anchor = buildContinuityAnchor(completedForAnchor);

    const results = await callPass2Batch(title, batch, style, provider, apiKey, anchor, params.groqModel, params.claudeModel);

    for (const r of results) {
      const idVal = r.id ?? r.scene_number ?? r.sceneNumber ?? r.scene_id ?? r.scene_Id;
      const promptVal = r.prompt ?? r.image_prompt ?? r.description ?? r.imagePrompt;
      if (idVal !== undefined && promptVal !== undefined) {
        let numericId: number | undefined;
        if (typeof idVal === "number") {
          numericId = idVal;
        } else {
          const match = String(idVal).match(/\d+/);
          if (match) numericId = parseInt(match[0], 10);
        }
        if (numericId !== undefined) {
          promptMap.set(numericId, promptVal);
        }
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
