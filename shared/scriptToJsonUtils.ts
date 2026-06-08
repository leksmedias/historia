// ── Types ─────────────────────────────────────────────────────────────────────

export interface OverlayItem {
  text: string;    // max 3 words shown on screen
  trigger: string; // single word from narration that fires this overlay
}

export interface OutputScene {
  image: string;
  script: string;
  prompt: string;
  overlay_text: string | OverlayItem[] | null;
}

export interface ScriptToJsonResult {
  title: string;
  scenes: OutputScene[];
}

export interface SplitScene {
  id: number;
  script: string;
  overlay_text: string | OverlayItem[] | null;
}

export interface ScriptToJsonParams {
  title: string;
  script: string;
  secondsPerScene: number;
  style: "impasto" | "ww2";
  provider: "groq" | "inworld" | "claude" | "gemini";
  groqApiKey?: string;
  groqApiKeys?: string[];
  inworldApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  groqModel?: string;
  claudeModel?: string;
  geminiModel?: string;
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
export const INWORLD_BATCH_SIZE = 15;

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

export function tryParseTruncatedJson(text: string): any {
  let inString = false;
  let stringChar = '';
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (inString) {
      if (char === stringChar) {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        stack.push('{');
      } else if (char === '[') {
        stack.push('[');
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
        }
      }
    }
  }

  let completed = text.trim();
  if (inString) {
    completed += stringChar;
  }
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === '{') completed += '}';
    else if (top === '[') completed += ']';
  }

  try {
    return JSON.parse(completed);
  } catch {
    const cleaned = completed.replace(/,\s*([\]}])/g, '$1');
    return JSON.parse(cleaned);
  }
}

function _cleanOverlay(raw: any): string | OverlayItem[] | null {
  if (raw === null || raw === undefined) return null;

  if (Array.isArray(raw)) {
    const cleaned = raw
      .filter((item: any) => item && typeof item.text === 'string' && typeof item.trigger === 'string')
      .map((item: any) => ({
        text: item.text.replace(/[*_~`#>]+/g, '').replace(/\s+/g, ' ').trim(),
        trigger: item.trigger.replace(/[*_~`#>]+/g, '').trim().split(/\s+/)[0].toLowerCase(),
      }))
      .filter((item: any) => item.text && item.trigger);
    return cleaned.length > 0 ? cleaned : null;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') return null;
    if (trimmed.startsWith('[')) {
      try { return _cleanOverlay(JSON.parse(trimmed)); } catch { }
    }
    const cleaned = trimmed.replace(/[*_~`#>]+/g, '').replace(/["""'']+/g, '').replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  return null;
}

export function parseJsonResponse(text: string): any {
  let rawText = text;

  // Handle unclosed or closed json code fences
  const openFenceIdx = text.indexOf("```json");
  if (openFenceIdx !== -1) {
    const contentAfterFence = text.slice(openFenceIdx + 7);
    const closeFenceIdx = contentAfterFence.indexOf("```");
    if (closeFenceIdx !== -1) {
      rawText = contentAfterFence.slice(0, closeFenceIdx).trim();
    } else {
      rawText = contentAfterFence.trim();
    }
  } else {
    // Try generic markdown block
    const genericFenceIdx = text.indexOf("```");
    if (genericFenceIdx !== -1) {
      const contentAfterGeneric = text.slice(genericFenceIdx + 3);
      const closeGenericIdx = contentAfterGeneric.indexOf("```");
      if (closeGenericIdx !== -1) {
        rawText = contentAfterGeneric.slice(0, closeGenericIdx).trim();
      } else {
        rawText = contentAfterGeneric.trim();
      }
    }
  }

  // Strip <thinking> blocks — both closed and unclosed (truncated NVIDIA output)
  const stripped = rawText
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking>[\s\S]*$/gi, "")
    .trim();

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
        } catch {
          try {
            return tryParseTruncatedJson(sliced);
          } catch (e) {
            throw e;
          }
        }
      }
    }
  }

  try {
    return JSON.parse(stripped);
  } catch {
    try {
      const cleaned = stripped.replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(cleaned);
    } catch {
      try {
        return tryParseTruncatedJson(stripped);
      } catch (e) {
        throw e;
      }
    }
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

  try {
    return tryParseTruncatedJson(text);
  } catch { }

  return null;
}

function tryExtractAndParseObject(text: string, startIdx: number): { parsed: any; endIdx: number } | null {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;

  for (let j = startIdx; j < text.length; j++) {
    const char = text[j];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (inString) {
      if (char === stringChar) {
        inString = false;
      }
    } else {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(startIdx, j + 1);
          const parsed = parseLooseObject(candidate);
          if (parsed !== null) {
            return { parsed, endIdx: j };
          }
        }
      }
    }
  }

  // If we reached the end of the string but it wasn't closed, try autocompletion!
  if (depth > 0) {
    let candidate = text.slice(startIdx);
    if (inString) {
      candidate += stringChar;
    }
    for (let d = 0; d < depth; d++) {
      candidate += '}';
    }
    const parsed = parseLooseObject(candidate);
    if (parsed !== null) {
      return { parsed, endIdx: text.length - 1 };
    }
  }

  return null;
}

function extractLooseObjects(text: string): any[] {
  const objects: any[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const result = tryExtractAndParseObject(text, i);
      if (result !== null) {
        objects.push(result.parsed);
        i = result.endIdx + 1;
        continue;
      }
    }
    i++;
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

      const overlay_text = _cleanOverlay(obj.overlay_text ?? obj.overlayText ?? obj.overlay ?? null);

      scenes.push({ id, script: script.trim(), overlay_text });
    }

    // Resilient fallback: parse plain-text lists if no JSON objects were recovered
    if (scenes.length === 0) {
      // Strips <thinking> blocks first — both closed and unclosed (truncated output)
      const strippedText = text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/<thinking>[\s\S]*$/gi, "");

      // Try Pattern A: list with standard separators: . , : , ) , -
      const patternA = /(?:[-*•\s]*(?:Scene|id|scene)?\s*(\d+)\s*[:.)-]\s*)([^]*?)(?=(?:[-*•\s]*(?:Scene|id|scene)?\s*\d+\s*[:.)-])|$)/gi;
      let match;
      while ((match = patternA.exec(strippedText)) !== null) {
        const id = parseInt(match[1], 10);
        let script = match[2].trim();
        script = script.replace(/overlay(?:_text)?:\s*.*$/i, "").trim();
        script = script.replace(/[-*•\s]+$/, "").trim(); // Clean trailing hyphens/bullets/newlines
        if (script && !isNaN(id)) {
          scenes.push({ id, script, overlay_text: null });
        }
      }

      // Try Pattern B (Scene/id labels followed by newline/spaces without delimiters) if still empty
      if (scenes.length === 0) {
        const patternB = /(?:[-*•\s]*(?:Scene|id|scene)\s*(\d+)\s*\n+)([^]*?)(?=(?:[-*•\s]*(?:Scene|id|scene)\s*\d+\s*\n+)|$)/gi;
        while ((match = patternB.exec(strippedText)) !== null) {
          const id = parseInt(match[1], 10);
          let script = match[2].trim();
          script = script.replace(/[-*•\s]+$/, "").trim();
          if (script && !isNaN(id)) {
            scenes.push({ id, script, overlay_text: null });
          }
        }
      }
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

    // Resilient fallback: parse plain-text lists if no JSON objects were recovered
    if (prompts.length === 0) {
      const strippedText = text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/<thinking>[\s\S]*$/gi, "");

      // Try Pattern A: list with standard separators: . , : , ) , -
      const patternA = /(?:[-*•\s]*(?:Scene|id|scene)?\s*(\d+)\s*[:.)-]\s*)([^]*?)(?=(?:[-*•\s]*(?:Scene|id|scene)?\s*\d+\s*[:.)-])|$)/gi;
      let match;
      while ((match = patternA.exec(strippedText)) !== null) {
        const id = parseInt(match[1], 10);
        let prompt = match[2].trim();
        prompt = prompt.replace(/[-*•\s]+$/, "").trim();
        if (prompt && !isNaN(id)) {
          prompts.push({ id, prompt });
        }
      }

      // Try Pattern B (Scene/id labels followed by newline/spaces without delimiters) if still empty
      if (prompts.length === 0) {
        const patternB = /(?:[-*•\s]*(?:Scene|id|scene)\s*(\d+)\s*\n+)([^]*?)(?=(?:[-*•\s]*(?:Scene|id|scene)\s*\d+\s*\n+)|$)/gi;
        while ((match = patternB.exec(strippedText)) !== null) {
          const id = parseInt(match[1], 10);
          let prompt = match[2].trim();
          prompt = prompt.replace(/[-*•\s]+$/, "").trim();
          if (prompt && !isNaN(id)) {
            prompts.push({ id, prompt });
          }
        }
      }
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
Overlays increase understanding and emotion — must NOT repeat narration.
STRICT MAX 3 WORDS per label. Plain text only — no markdown, no asterisks, no hashtags, no symbols.

TWO FORMATS — choose based on the scene:

1. SIMPLE (one key fact) → plain string:
   "June 1944"

2. COMPLEX (scene narrates a list of units/forces/names/numbers) → array of objects:
   Each object: {"text": "label max 3 words", "trigger": "oneword"}
   - "trigger" = the EXACT single word spoken in the narration that fires this overlay
   - trigger must appear verbatim in the script field
   - Max 6 items per array

Example for "the Seventeenth, Eighteenth, and Nineteenth Legions, six auxiliary cohorts, three squadrons of cavalry":
[{"text":"XVII Legion","trigger":"Seventeenth"},{"text":"XVIII Legion","trigger":"Eighteenth"},{"text":"XIX Legion","trigger":"Nineteenth"},{"text":"6 Cohorts","trigger":"six"},{"text":"3 Cavalry","trigger":"three"}]

Overlay types (pick most impactful):
DATE "476 AD" | LOCATION "Normandy" | FORCE SIZE "39 Australians" | CASUALTIES "8000 Killed"
COMMANDER "Erwin Rommel" | STRATEGIC FACT "Outnumbered 50:1" | STATUS "Final Assault" | OUTCOME "Allied Victory"

Use plain digits — no commas: 25000 not 25,000. Set null if nothing meaningful.

Output ONLY valid JSON, no markdown, no explanation:
{"scenes":[{"id":${startId},"script":"narration text","overlay_text":"June 1944"},{"id":${startId + 1},"script":"the Seventeenth, Eighteenth, Nineteenth Legions","overlay_text":[{"text":"XVII Legion","trigger":"Seventeenth"},{"text":"XVIII Legion","trigger":"Eighteenth"},{"text":"XIX Legion","trigger":"Nineteenth"}]},{"id":${startId + 2},"script":"narration text","overlay_text":null}]}`;
}

export const PASS2_IMPASTO_SYSTEM = `You are the Lead Creative Director and Historical Consultant for a high-end educational documentary series. You produce historical videos exploring warfare through a human-centered tactical lens.

Each image prompt must follow the narration — not random — it must follow the story.

1. VISUAL AESTHETIC
All imagery must be rendered as Contemporary Digital Oil Painting with heavy Impasto texture. Brushstrokes must be visible throughout, especially in smoke, water, and sky. Apply Chiaroscuro lighting with dramatic contrast between deep shadow and focal highlights on faces, armor, and weapons. Black powder smoke must appear as a recurring visual element, framing scenes and creating atmospheric depth. All historical figures must be modeled after authenticated contemporary portraits but rendered with modern cinematic expressiveness.

Follow a strict 70/30 visual distribution: 70% narrative illustrations including action shots, character portraits, and battlefield landscapes; 30% maps, infographics, and diagrams for strategic and historical data.

2. INFORMATIONAL ASSET DESIGN
All maps must use a Tactical Parchment style: aged tea-stained background with visible creases, hand-drawn cartographic coastlines, decorative compass roses, calligraphic place names. No arrows and no text labels on maps.
All infographics must follow a Museum Gallery aesthetic with heraldic iconography placed as corner devices or header elements. All typography must use a Hybrid Vintage-Modern approach: elegant high-contrast serif fonts for titles and clean legible sans-serif fonts for data labels and annotations. Diagrams must use flowchart logic for causality chains such as: Smoke Confusion → Friendly Fire → Catastrophic Loss. Use distinct icons for infantry, cavalry, and artillery units alongside national flags and crests for army composition breakdowns.

3. PROMPT STRUCTURE — each prompt must be exactly 5 to 7 sentences:
[Who is present] + [what they are doing] + [where they are] + [camera angle/framing] + [lighting and mood]

Every prompt MUST contain a CLEAR VISIBLE ACTION — never a static description.

4. CAMERA VARIETY — use a different angle for each scene, rotate through:
close-up of hands/weapons/eyes, medium shot of individual, wide shot of formations/terrain, over-the-shoulder, ground-level looking up, high angle, silhouette against sky, doorway/tent-entrance framing

5. HISTORICAL PERIOD ACCURACY — match weapons/armor/environment to the period in the video title:
- Early Islamic warfare: chainmail, curved swords, Arabian horses, desert terrain, turbans over armor
- Ancient Greek: bronze Corinthian helmets, hoplon shields, spear formations, open hillsides
- Mongol: composite bows on horseback, lamellar armor, open steppe
- Medieval Crusades: iron chainmail, kite shields, siege towers, walled city backgrounds
- Roman: lorica segmentata, scutum shields, formation marching, stone roads and fortifications
- Maps with detailed routes. Infographics.

6. HARD CONSTRAINTS
No photorealistic textures or clean CGI renders. No modern sans-serif fonts used in isolation. No flat 2D vector-style illustrations. No bright neon or digital-native gradient colors.
RESTRICTIONS: No text overlays, no identifiable faces, no fantasy/sci-fi/modern brands.

Return ONLY valid JSON:
{"scenes":[{"id":1,"prompt":"..."},{"id":2,"prompt":"..."}]}`;

export const PASS2_WWII_SYSTEM = `You are the Lead Creative Director and Historical Consultant for a high-end educational documentary series. You produce historical videos exploring World War II warfare through a human-centered tactical lens.

Each image prompt must follow the narration — not random — it must follow the story.

1. VISUAL AESTHETIC
All imagery must be rendered as WWII Archival Photorealism — ultra-realistic, cinematic black-and-white war photojournalism. Every image must feel like an authentic recovered wartime photograph: emotionally raw, historically accurate, and documentary in nature. Apply dramatic chiaroscuro lighting with deep shadows and sharp focal highlights on faces, uniforms, weapons, and machinery. All images must simulate 35mm film grain using textures consistent with Kodak Tri-X film stock. Apply shallow depth of field where the foreground subject is razor-sharp and the background dissolves into grain and smoke. Smoke, mud, rain, fire, and atmospheric battlefield haze must appear as recurring visual elements creating depth and tension. All figures must feature hyper-detailed period-accurate textures: authentic wool military uniforms, wet leather, rusted steel, canvas webbing, and weathered skin with visible emotional expression. The overall aesthetic must feel like a masterpiece-quality wartime press photograph — grave, cinematic, historically immersive.

2. INFORMATIONAL ASSET DESIGN
All maps must use an Aged Wartime Document style: yellowed or tea-stained paper with visible fold creases, water damage, and foxing spots. Terrain rendered in hand-drafted 1940s military cartographic style with contour lines, river crossings, and village names in vintage serif type. Stamps such as "CLASSIFIED," "TOP SECRET," or operation names in faded block type. Typewritten annotations for dates and unit labels. No arrows and no text labels on maps.
All infographics must follow an Aged Military Intelligence aesthetic: yellowed paper background, period hand-drafted line art, OSS or War Office document styling, faded stamps, and foxing. Unit icons use period military silhouettes for infantry, armor, artillery, and air assets alongside national insignia such as the Allied star, Wehrmacht eagle, Soviet hammer, and Rising Sun as header or corner devices. All typography must use a Hybrid Vintage-Modern approach: high-contrast vintage serif fonts for titles and clean legible sans-serif for data labels. Diagrams must use flowchart logic for causality chains such as: Air Superiority → Supply Disruption → Front Collapse. Scanned archival document aesthetic throughout — everything must feel declassified and reproduced from microfilm.

3. PROMPT STRUCTURE — each prompt must be exactly 5 to 7 sentences:
[Who is present] + [what they are doing] + [where they are] + [camera angle/framing] + [lighting and mood]

Every prompt MUST contain a CLEAR VISIBLE ACTION — never a static description.

4. CAMERA VARIETY — use a different angle for each scene, rotate through:
close-up of hands/weapons/eyes, medium shot of individual, wide shot of formations/terrain, over-the-shoulder, ground-level looking up, high angle, silhouette against smoke/sky

5. TACTICAL SPECIFICS
When depicting any WWII engagement, all multinational force compositions must be explicitly visualized through varying uniform textures, national insignia, and unit markings representing American, British, Soviet, German, French, Italian, and Japanese forces where relevant. Field identification markers, unit patches, rank insignia, and vehicle markings must appear prominently in close-up scenes and be labeled in infographics.

6. HARD CONSTRAINTS
No color imagery. No oil painting or painterly textures. No visible brushstrokes. No CGI renders or digital illustration aesthetics. No bright or tonal gradients inconsistent with monochrome film. No flat 2D vector-style illustrations.
Avoid plastic AI faces, overly clean uniforms, glossy modern CGI look, modern gear mistakes, perfectly balanced compositions.
Enforce smoke, dirt, fatigue, asymmetry, grain, emotional realism.
RESTRICTIONS: No text overlays, no identifiable faces, no fantasy/sci-fi/modern brands.

Return ONLY valid JSON:
{"scenes":[{"id":1,"prompt":"..."},{"id":2,"prompt":"..."}]}`;

