// ── Types ────────────────────────────────────────────────────────────────────

export interface OutputScene {
  image: string;
  script: string;
  prompt: string;
  overlay_text: string | null;
}

export interface ScriptToJsonResult {
  title: string;
  scenes: OutputScene[];
}

export type ProgressCallback = (
  phase: "pass1" | "pass2",
  done: number,
  total: number,
  partialScenes?: OutputScene[]
) => void;

export interface ScriptToJsonParams {
  title: string;
  script: string;
  secondsPerScene: number;
  style: "impasto" | "ww2";
  provider: "groq" | "nvidia";
  groqApiKey?: string;
  nvidiaApiKey?: string;
}

// Internal scene shape from Pass 1
interface SplitScene {
  id: number;
  script: string;
  overlay_text: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WORDS_PER_MINUTE = 117;
const PASS1_CHUNK_MAX_WORDS = 2000;
const GROQ_BATCH_SIZE = 8;
const NVIDIA_BATCH_SIZE = 20;

// ── Utilities ────────────────────────────────────────────────────────────────

/** Estimate how many scenes a script will produce at the given seconds-per-scene. */
export function estimateSceneCount(wordCount: number, secondsPerScene: number): number {
  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  return Math.max(1, Math.round(wordCount / wordsPerScene));
}

/**
 * Split script text into chunks of at most maxWords words, always breaking at
 * sentence boundaries (. ! ?) so the AI never receives a mid-sentence start.
 */
export function chunkScript(text: string, maxWords: number): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string
  const matched = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  // Collect any trailing text not captured by the sentence regex
  const coveredLength = matched.reduce((sum, s) => sum + s.length, 0);
  const trailing = text.slice(coveredLength).trim();
  const sentences = matched.length > 0
    ? (trailing ? [...matched, trailing] : matched)
    : [text];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
    if (currentWordCount + sentenceWords > maxWords && current.length > 0) {
      chunks.push(current.join(" ").trim());
      current = [];
      currentWordCount = 0;
    }
    current.push(sentence.trim());
    currentWordCount += sentenceWords;
  }
  if (current.length > 0) chunks.push(current.join(" ").trim());
  return chunks;
}

/**
 * Extract and parse the first JSON object or array from an AI response.
 * Handles markdown code fences and NVIDIA reasoning preamble.
 */
export function parseJsonResponse(text: string): any {
  // Try to extract from ```json ... ``` block first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : text.trim();
  // Strip any remaining ``` markers
  const clean = jsonText.replace(/```\w*\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(clean);
}

/**
 * Build the visual continuity anchor string injected at the top of each Pass 2 batch.
 * Takes the last 2 completed scenes and truncates prompts to 80 chars.
 */
export function buildContinuityAnchor(
  completedScenes: Array<{ script: string; prompt: string }>
): string {
  if (completedScenes.length === 0) return "";
  const last2 = completedScenes.slice(-2);
  const lines = last2.map(
    (s) => `"${s.script}" → "${s.prompt.substring(0, 80)}${s.prompt.length > 80 ? "..." : ""}"`
  );
  return `PREVIOUS SCENES FOR VISUAL CONTINUITY (maintain consistent style and atmosphere):\n${lines.join("\n")}`;
}

// ── System Prompts ────────────────────────────────────────────────────────────

function buildPass1SystemPrompt(wordsPerScene: number, secondsPerScene: number, startId: number): string {
  return `You are a documentary scene director. Split the provided script excerpt into visual scenes.

SPLITTING RULES:
- Target ~${wordsPerScene} words per scene (${secondsPerScene}s at documentary pace)
- Split at: visual transitions, narrative beats, emotional shifts, location/time changes
- Each scene = one distinct visual idea. Never split mid-sentence.
- Continue scene numbering from id ${startId}

OVERLAY TEXT RULES:
- 3 words or fewer
- Plain letters, numbers, spaces, hyphens only — no colons, commas, or other punctuation
- K/M shorthand for large numbers (25K, 3M)
- Ranges use hyphen: 3M-5M
- Examples: "Rhine 1945", "Last Barrier", "Army 25K"
- If nothing meaningful, set overlay_text to null

Output ONLY valid JSON, no markdown, no explanation:
{"scenes":[{"id":${startId},"script":"narration text","overlay_text":"Rhine 1945"},{"id":${startId + 1},"script":"narration text","overlay_text":null}]}`;
}

const PASS2_IMPASTO_SYSTEM = `You are the Lead Creative Director for a high-end historical documentary series.

GLOBAL STYLE BIBLE:
- Style: Digital oil painting, heavy Impasto texture
- Lighting: Dramatic Chiaroscuro — deep shadows, bright focal highlights on faces/armor/weapons
- Texture: Visible brushstrokes throughout smoke, water, sky
- Palette: Muted earth tones, cold desaturated blues, gray-green shadows, amber highlights
- Composition: Cinematic 16:9, wide-angle historical framing
- Atmosphere: Black powder smoke as a recurring visual element

IMAGE TYPE DISTRIBUTION: 70% narrative illustrations (action shots, character portraits, battlefield landscapes), 30% tactical maps and infographics.

For NARRATIVE scenes — begin with: "Digital oil painting, heavy impasto."
For MAP scenes — begin with: "Tactical Parchment map." Include: aged tea-stained vellum, hand-drawn cartographic style, blue protagonist arrows, red antagonist arrows, calligraphic place names.
For INFOGRAPHIC scenes — begin with: "Museum Gallery infographic." Include: heraldic iconography, flowchart logic, hybrid vintage-modern typography.

HARD CONSTRAINTS:
- Prompt must directly match the provided narration — never introduce events not yet narrated
- No photorealistic textures or clean CGI renders
- No flat 2D vector illustrations
- 120–250 words per prompt`;

const PASS2_WWII_SYSTEM = `You are the Lead Creative Director for a WWII/WWI historical documentary series.

GLOBAL STYLE BIBLE:
- Style: Cinematic WWII archival photorealism — black-and-white war photojournalism
- Film: Kodak Tri-X grain, imperfect exposure, shallow depth of field
- Lighting: Dramatic chiaroscuro, deep shadows, directional light cutting through smoke/dust/rain
- Characters: Exhausted, dirty, emotionally strained — realistic imperfections required
- Uniforms/vehicles: Worn, muddy, battle-damaged, historically accurate
- Composition: Asymmetrical, handheld feel, foreground obstruction, smoke framing

IMAGE TYPE DISTRIBUTION: 70% narrative imagery, 30% tactical maps and infographics.

For NARRATIVE scenes — begin with: "Cinematic WWII archival photograph, black-and-white war photojournalism style."
For MAP scenes — begin with: "WWII tactical parchment map." Include: aged paper, grease-pencil markings, muted blue Allied arrows, muted red Axis arrows, typewriter labels.
For INFOGRAPHIC scenes — begin with: "Museum archive infographic." Include: old dossier paper, faded diagrams, archival stamps, wartime stencil fonts.

HARD CONSTRAINTS:
- Prompt must directly match the provided narration — never introduce events not yet narrated
- No CGI, no modern gear, no bright colors, no clean battlefields
- 120–250 words per prompt`;

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
          max_tokens: 16000,
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
    if (result.status === 429 && retryOnRateLimit) {
      console.log(`[${provider}] Pass1 rate limited — waiting 15s...`);
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
    // Retry once with explicit no-markdown instruction
    if (retryOnParseFailure) {
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying with strict instruction`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, retryOnRateLimit, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting`);
  }
}
