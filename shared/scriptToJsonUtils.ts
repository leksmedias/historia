// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface SplitScene {
  id: number;
  script: string;
  overlay_text: string | null;
}

export interface ScriptToJsonParams {
  title: string;
  script: string;
  secondsPerScene: number;
  style: "impasto" | "ww2";
  provider: "groq" | "nvidia" | "claude";
  groqApiKey?: string;
  nvidiaApiKey?: string;
  anthropicApiKey?: string;
  groqModel?: string;
  claudeModel?: string;
}

export interface GroqModelConfig {
  id: string;
  name: string;
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number | "No limit";
}

export const GROQ_MODELS: GroqModelConfig[] = [
  { id: "allam-2-7b", name: "Allam 2 7B", rpm: 30, rpd: 7000, tpm: 6000, tpd: 500000 },
  { id: "groq/compound", name: "Groq Compound", rpm: 30, rpd: 250, tpm: 70000, tpd: "No limit" },
  { id: "groq/compound-mini", name: "Groq Compound Mini", rpm: 30, rpd: 250, tpm: 70000, tpd: "No limit" },
  { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", rpm: 30, rpd: 14400, tpm: 6000, tpd: 500000 },
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", rpm: 30, rpd: 1000, tpm: 12000, tpd: 100000 },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B Instruct", rpm: 30, rpd: 1000, tpm: 30000, tpd: 500000 },
  { id: "meta-llama/llama-prompt-guard-2-22m", name: "Llama Prompt Guard 2 22M", rpm: 30, rpd: 14400, tpm: 15000, tpd: 500000 },
  { id: "meta-llama/llama-prompt-guard-2-86m", name: "Llama Prompt Guard 2 86M", rpm: 30, rpd: 14400, tpm: 15000, tpd: 500000 },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  { id: "openai/gpt-oss-safeguard-20b", name: "GPT OSS Safeguard 20B", rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  { id: "qwen/qwen3-32b", name: "Qwen 3 32B", rpm: 60, rpd: 1000, tpm: 6000, tpd: 500000 }
];

export function getGroqModelConfig(modelId: string): GroqModelConfig {
  return GROQ_MODELS.find(m => m.id === modelId) || GROQ_MODELS[4]; // Default to llama-3.3-70b-versatile
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const WORDS_PER_MINUTE = 117;
export const PASS1_CHUNK_MAX_WORDS = 2000;
export const GROQ_BATCH_SIZE = 8;
export const NVIDIA_BATCH_SIZE = 15;

// ── Utilities ─────────────────────────────────────────────────────────────────

export function estimateSceneCount(wordCount: number, secondsPerScene: number): number {
  const wordsPerScene = Math.floor((WORDS_PER_MINUTE * secondsPerScene) / 60);
  return Math.max(1, Math.round(wordCount / wordsPerScene));
}

export function chunkScript(text: string, maxWords: number): string[] {
  if (!text || !text.trim()) return [];
  const matched = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  const coveredLength = matched.reduce((sum, s) => sum + s.length, 0);
  const trailing = text.slice(coveredLength).trim();
  const sentences =
    matched.length > 0 ? (trailing ? [...matched, trailing] : matched) : [text];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;
    if (sentenceWords > maxWords) {
      if (current.length > 0) {
        chunks.push(current.join(" ").trim());
        current = [];
        currentWordCount = 0;
      }
      const words = sentence.split(/\s+/).filter(Boolean);
      for (let i = 0; i < words.length; i += maxWords) {
        chunks.push(words.slice(i, i + maxWords).join(" "));
      }
      continue;
    }
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

export function parseJsonResponse(text: string): any {
  // Try code fence first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  const rawText = fenceMatch ? fenceMatch[1].trim() : text;

  // Strip <thinking>...</thinking> blocks (NVIDIA reasoning output)
  const stripped = rawText.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

  // Extract first JSON object or array, ignoring preamble/postamble text
  const firstBrace = stripped.indexOf("{");
  const firstBracket = stripped.indexOf("[");
  let start = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
  } else if (firstBracket !== -1) {
    start = firstBracket;
  }
  if (start !== -1) {
    const closeChar = stripped[start] === "{" ? "}" : "]";
    const lastClose = stripped.lastIndexOf(closeChar);
    if (lastClose > start) {
      const sliced = stripped.slice(start, lastClose + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        // Try cleaning trailing commas
        try {
          const cleaned = sliced.replace(/,\s*([\]}])/g, '$1');
          return JSON.parse(cleaned);
        } catch (e) {
          throw e;
        }
      }
    }
  }

  try {
    return JSON.parse(stripped);
  } catch {
    const cleaned = stripped.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(cleaned);
  }
}

function parseLooseObject(text: string): any {
  try {
    return JSON.parse(text);
  } catch { }

  let cleaned = text.replace(/,\s*([\]}])/g, '$1');
  try {
    return JSON.parse(cleaned);
  } catch { }

  try {
    cleaned = cleaned.replace(/(^|[{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    cleaned = cleaned.replace(/(^|[{,]\s*)'([a-zA-Z0-9_]+)'\s*:/g, '$1"$2":');
    cleaned = cleaned.replace(/:\s*'((?:[^'\\]|\\.)*)'/g, (m, val) => {
      const escapedVal = val.replace(/\\'/g, "'").replace(/"/g, '\\"');
      return `: "${escapedVal}"`;
    });
    return JSON.parse(cleaned);
  } catch { }

  return null;
}

function extractLooseObjects(text: string): any[] {
  const objects: any[] = [];
  let braceDepth = 0;
  let inString = false;
  let stringChar = '';
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';

    if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        if (braceDepth === 0) {
          startIdx = i;
        }
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
        if (braceDepth === 0 && startIdx !== -1) {
          const candidate = text.slice(startIdx, i + 1);
          const parsed = parseLooseObject(candidate);
          if (parsed !== null) {
            objects.push(parsed);
          }
          startIdx = -1;
        }
        if (braceDepth < 0) {
          braceDepth = 0;
        }
      }
    }
  }

  if (braceDepth > 0 && startIdx !== -1) {
    let candidate = text.slice(startIdx);
    if (inString) {
      candidate += stringChar;
    }
    for (let d = 0; d < braceDepth; d++) {
      candidate += '}';
    }
    const parsed = parseLooseObject(candidate);
    if (parsed !== null) {
      objects.push(parsed);
    }
  }

  return objects;
}

function flattenObjects(val: any, list: any[]) {
  if (!val) return;
  if (Array.isArray(val)) {
    for (const item of val) {
      flattenObjects(item, list);
    }
  } else if (typeof val === 'object') {
    const hasId = val.id !== undefined || val.sceneId !== undefined || val.scene_id !== undefined || val.scene_Id !== undefined;
    const hasScriptOrPrompt = val.script !== undefined || val.text !== undefined || val.narration !== undefined || val.prompt !== undefined || val.image_prompt !== undefined || val.description !== undefined || val.imagePrompt !== undefined;

    if (hasId && hasScriptOrPrompt) {
      list.push(val);
    } else {
      for (const k of Object.keys(val)) {
        flattenObjects(val[k], list);
      }
    }
  }
}

export function recoverScenesRegex(text: string): SplitScene[] {
  if (typeof text !== 'string') return [];
  const scenes: SplitScene[] = [];
  try {
    const rawObjs = extractLooseObjects(text);
    const objs: any[] = [];
    for (const raw of rawObjs) {
      flattenObjects(raw, objs);
    }

    for (const obj of objs) {
      const idVal = obj.id ?? obj.scene_number ?? obj.sceneNumber ?? obj.sceneId ?? obj.scene_id ?? obj.scene_Id;
      if (idVal === undefined || idVal === null) continue;
      const id = typeof idVal === 'number' ? idVal : parseInt(idVal, 10);
      if (isNaN(id)) continue;

      const script = obj.script ?? obj.text ?? obj.narration ?? obj.narration_text;
      if (typeof script !== 'string') continue;

      let overlay_text = obj.overlay_text ?? obj.overlayText ?? obj.overlay ?? null;
      if (typeof overlay_text === 'string') {
        overlay_text = overlay_text.trim();
      } else {
        overlay_text = null;
      }

      scenes.push({ id, script: script.trim(), overlay_text });
    }
  } catch (e) {
    console.error("[recoverScenesRegex] failed:", e);
  }
  return scenes;
}

export function recoverPromptsRegex(text: string): Array<{ id: number; prompt: string }> {
  if (typeof text !== 'string') return [];
  const prompts: Array<{ id: number; prompt: string }> = [];
  try {
    const rawObjs = extractLooseObjects(text);
    const objs: any[] = [];
    for (const raw of rawObjs) {
      flattenObjects(raw, objs);
    }

    for (const obj of objs) {
      const idVal = obj.id ?? obj.scene_number ?? obj.sceneNumber ?? obj.sceneId ?? obj.scene_id ?? obj.scene_Id;
      if (idVal === undefined || idVal === null) continue;
      const id = typeof idVal === 'number' ? idVal : parseInt(idVal, 10);
      if (isNaN(id)) continue;

      const prompt = obj.prompt ?? obj.image_prompt ?? obj.description ?? obj.imagePrompt;
      if (typeof prompt !== 'string') continue;

      prompts.push({ id, prompt: prompt.trim() });
    }
  } catch (e) {
    console.error("[recoverPromptsRegex] failed:", e);
  }
  return prompts;
}

export function buildContinuityAnchor(
  completedScenes: Array<{ script: string; prompt: string }>
): string {
  if (completedScenes.length === 0) return "";
  const last2 = completedScenes.slice(-2);
  const lines = last2.map(
    (s) =>
      `"${s.script}" → "${s.prompt.substring(0, 80)}${s.prompt.length > 80 ? "..." : ""}"`
  );
  return `PREVIOUS SCENES FOR VISUAL CONTINUITY (maintain consistent style and atmosphere):\n${lines.join("\n")}`;
}

// ── System prompts ────────────────────────────────────────────────────────────

export function buildPass1SystemPrompt(
  wordsPerScene: number,
  secondsPerScene: number,
  startId: number
): string {
  return `You are a documentary scene director. Split the provided script excerpt into visual scenes.

SPLITTING RULES:
- Target ~${wordsPerScene} words per scene (${secondsPerScene}s at documentary pace)
- Split at: visual transitions, narrative beats, emotional shifts, location/time changes
- Each scene = one distinct visual idea. Never split mid-sentence.
- Continue scene numbering from id ${startId}

OVERLAY TEXT RULES:
- 3 words or fewer
- Plain letters, numbers, spaces, hyphens only — no colons, commas, or other punctuation
- K/M shorthand for large numbers (25000, 3M)
- Ranges use hyphen: 3M-5M
- Examples: "Rhine 1945", "Last Barrier", "Army of 25000"
- If nothing meaningful, set overlay_text to null

Output ONLY valid JSON, no markdown, no explanation:
{"scenes":[{"id":${startId},"script":"narration text","overlay_text":"Rhine 1945"},{"id":${startId + 1},"script":"narration text","overlay_text":null}]}`;
}

export const PASS2_IMPASTO_SYSTEM = `You are the Lead Creative Director for a high-end historical documentary series.

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
- 150–250 words per prompt`;

export const PASS2_WWII_SYSTEM = `You are the Lead Creative Director for a WWII/WWI historical documentary series.

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
- 150–250 words per prompt`;
