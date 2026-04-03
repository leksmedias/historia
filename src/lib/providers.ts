// Frontend provider utilities — all API calls happen client-side

// ========================
// Settings helpers
// ========================

export interface CustomVoice {
  id: string;
  name: string;
}

export interface ProviderSettings {
  imageProvider: string;
  ttsProvider: string;
  voiceId: string;
  modelId: string;
  imageConcurrency: number;
  audioConcurrency: number;
  groqApiKey: string;
  anthropicApiKey: string;
  claudeModel: string;
  whiskCookie: string;
  inworldApiKey: string;
  customVoices: CustomVoice[];
}

export interface InworldVoice {
  id: string;
  name: string;
  description: string;
}

export const INWORLD_VOICES: InworldVoice[] = [
  { id: "Dennis", name: "Dennis", description: "Male, warm baritone narrator" },
  { id: "James", name: "James", description: "Male, authoritative and deep" },
  { id: "Brian", name: "Brian", description: "Male, calm and neutral" },
  { id: "Marcus", name: "Marcus", description: "Male, strong and commanding" },
  { id: "Oliver", name: "Oliver", description: "Male, clear and professional" },
  { id: "Patrick", name: "Patrick", description: "Male, rich and dramatic" },
  { id: "Daniel", name: "Daniel", description: "Male, smooth and measured" },
  { id: "Morgan", name: "Morgan", description: "Neutral, steady documentary tone" },
  { id: "Eleanor", name: "Eleanor", description: "Female, elegant and composed" },
  { id: "Linda", name: "Linda", description: "Female, friendly and clear" },
  { id: "Amy", name: "Amy", description: "Female, youthful and energetic" },
  { id: "Sophia", name: "Sophia", description: "Female, warm and expressive" },
  { id: "Hannah", name: "Hannah", description: "Female, gentle and refined" },
  { id: "Rachel", name: "Rachel", description: "Female, confident and articulate" },
  { id: "Victoria", name: "Victoria", description: "Female, regal and authoritative" },
  { id: "Emma", name: "Emma", description: "Female, bright and engaging" },
];

export function getAvailableVoices(settings: ProviderSettings): InworldVoice[] {
  const custom: InworldVoice[] = (settings.customVoices || []).map(v => ({
    id: v.id,
    name: v.name,
    description: "Custom voice",
  }));
  return [...INWORLD_VOICES, ...custom];
}

const DEFAULTS: ProviderSettings = {
  imageProvider: "ai",
  ttsProvider: "inworld",
  voiceId: "Dennis",
  modelId: "inworld-tts-1.5-max",
  imageConcurrency: 2,
  audioConcurrency: 2,
  groqApiKey: "",
  anthropicApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  whiskCookie: "",
  inworldApiKey: "",
  customVoices: [],
};

export function loadProviderSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem("historia-settings");
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveProviderSettings(settings: ProviderSettings) {
  localStorage.setItem("historia-settings", JSON.stringify(settings));
}

// ========================
// Groq — Scene manifest generation
// ========================

// ── Style-prompt mode constants ────────────────────────────────────────────

export const COMPACT_STYLE_SUFFIX =
  `in a Digital oil painting, heavy impasto style, 19th-century academic military realism, cinematic oil painting, thick impasto brushstrokes, visible canvas texture, muted earth tones, dramatic chiaroscuro lighting, smoky atmosphere, historical accuracy, aged parchment cartography, vintage textured infographics, hand-inked military schematics, premium documentary look, desaturated palette, immersive cinematic composition, 16:9, highly detailed`;

/** System prompt used when project has a stylePrompt — Groq generates ONLY the [Subject] part. */
const STYLE_PROMPT_BATCH_IMAGE_PROMPT = `You are a visual content director for a historical epic documentary.

For each numbered scene below, generate ONE short subject description and THREE fallback descriptions.

PURPOSE: These will be combined with a style suffix later. Generate ONLY the [Subject] part.
Do NOT include any style, mood, aesthetic, or quality words — those are added automatically.

SUBJECT DESCRIPTION RULES:
- Describe: WHO or WHAT is present, WHAT action is happening, WHERE it takes place, and one camera framing
- One concise phrase or short sentence (10–20 words)
- Use the correct scene type:
  * Battle/action: "Russian infantry advancing through artillery smoke toward a trench line, ground-level wide shot"
  * Portrait/figure: "A stern general in 1905 uniform studying a map by candlelight, over-the-shoulder framing"
  * Map/geography: "Topographical military map of Manchuria showing troop movements during the Battle of Mukden"
  * Diagram/schematic: "Diagram explaining indirect artillery fire over a mountain ridge, cross-section view"
  * Chart/data: "Comparative bar chart showing the scale of major land engagements"
  * Landscape/terrain: "Frozen Manchurian plains stretching to the horizon under an overcast sky, wide establishing shot"

HISTORICAL ACCURACY: Match uniforms, weapons, terrain, and props to the historical period in the video title.
PEOPLE: Anonymous figures only — no identifiable faces. Silhouettes, backs turned, obscured by helmets/smoke/shadow.

Return ONLY valid JSON matching this exact schema:
{
  "scenes": [
    {
      "scene_number": 1,
      "scene_type": "character|location|crowd|battle_light|artifact|transition|map|diagram|chart",
      "historical_period": "derived from title and scene context",
      "visual_priority": "character|environment|object",
      "image_prompt": "Short subject description only, no style words.",
      "fallback_prompts": [
        "Alternative subject angle or framing.",
        "Different focal point or camera distance.",
        "Symbolic or aftermath perspective."
      ]
    }
  ]
}`;

const BATCH_IMAGE_PROMPT = `You are the Lead Creative Director and Historical Consultant for a high-end educational documentary series. You produce 5-to-10-minute historical videos — script and visual storyboard — exploring 17th-century warfare through a human-centered tactical lens.


For each numbered scene below, generate ONE cinematic image prompt and THREE fallback prompts.

Use period-specific vocabulary throughout: Jacobite, Williamite, Stadtholder, Musket, Pike, Justacorps, Chiaroscuro, Impasto.
each image prompt must follow the script not just random , it must follow the story

2. VISUAL AESTHETIC
All imagery must be rendered as Contemporary Digital Oil Painting with heavy Impasto texture. Brushstrokes must be visible throughout, especially in smoke, water, and sky. Apply Chiaroscuro lighting with dramatic contrast between deep shadow and focal highlights on faces, armor, and weapons. Black powder smoke must appear as a recurring visual element, framing scenes and creating atmospheric depth. All historical figures must be modeled after authenticated contemporary portraits but rendered with modern cinematic expressiveness.

Follow a strict 70/30 visual distribution: 70% narrative illustrations including action shots, character portraits, and battlefield landscapes; 30% maps, infographics, and diagrams for strategic and historical data.

4. INFORMATIONAL ASSET DESIGN
All maps must use a Tactical Parchment style: aged tea-stained background with visible creases, 17th-century hand-drawn cartographic coastlines, decorative compass roses, calligraphic place names, and modern high-contrast tactical arrows in blue for Williamite forces and red for Jacobite forces. All infographics must follow a Museum Gallery aesthetic with heraldic iconography including the Williamite Lion, the Jacobite Harp, and the French Fleur-de-lis placed as corner devices or header elements. All typography must use a Hybrid Vintage-Modern approach: elegant high-contrast serif fonts for titles and clean legible sans-serif fonts for data labels and annotations. Diagrams must use flowchart logic for causality chains such as: Smoke Confusion → Friendly Fire → Catastrophic Loss. Use distinct icons for infantry, cavalry, and artillery units alongside national flags and crests for army composition breakdowns.

5. TACTICAL SPECIFICS
When depicting the Battle of the Boyne or any conflict involving field identification challenges, the green sprig marker for Williamite forces and the white paper marker for Jacobite forces must appear prominently in all relevant close-up scenes and be specifically labeled in infographics. All multinational army compositions must be explicitly visualized through varying uniform colors, national flags, and unit crests representing Dutch, Danish, Huguenot, English, and Irish contingents.

6. HARD CONSTRAINTS
No photorealistic textures or clean CGI renders. No modern sans-serif fonts used in isolation without antique pairing elements. No flat 2D vector-style illustrations. No bright neon or digital-native gradient colors. No rapid cutting below the 9-second average image interval.


OPERATIONAL TRIGGER:
When given a historical event, output the full script with word count, a scene-by-scene visual storyboard specifying image type (narrative or infographic

PROMPT STRUCTURE — each prompt must be exactly 2 to 3 sentence:
[Who is present] + [what they are doing] + [where they are] + [camera angle/framing] + [lighting and mood]

Every prompt MUST contain a CLEAR VISIBLE ACTION — never a static description.

CAMERA VARIETY — use a different angle for each scene, rotate through:
close-up of hands/weapons/eyes, medium shot of individual, wide shot of formations/terrain, over-the-shoulder, ground-level looking up, high angle, silhouette against sky, doorway/tent-entrance framing

HISTORICAL PERIOD ACCURACY — match weapons/armor/environment to the period in the video title:
- Early Islamic warfare: chainmail, curved swords, Arabian horses, desert terrain, turbans over armor
- Ancient Greek: bronze Corinthian helmets, hoplon shields, spear formations, open hillsides
- Mongol: composite bows on horseback, lamellar armor, open steppe
- Medieval Crusades: iron chainmail, kite shields, siege towers, walled city backgrounds
- Roman: lorica segmentata, scutum shields, formation marching, stone roads and fortifications
- THE MAP
- Infographics


RESTRICTIONS: No text overlays, no identifiable faces, no fantasy/sci-fi/modern brands

Return ONLY valid JSON matching this exact schema:
{
  "scenes": [
    {
      "scene_number": 1,
      "scene_type": "character|location|crowd|battle_light|artifact|transition",
      "historical_period": "derived from title and scene context",
      "visual_priority": "character|environment|object",
      "image_prompt": "One complete cinematic sentence ending with a period.",
      "fallback_prompts": [
        "Fallback with different camera angle, one sentence.",
        "Fallback focusing on environment, one sentence.",
        "Fallback symbolic/aftermath angle, one sentence."
      ]
    }
  ]
}`;

export interface SceneSettings {
  sceneDuration: number; // seconds per scene at 2.5 words/sec speaking rate
}

export interface SceneManifest {
  scene_number: number;
  scene_type: string;
  historical_period: string;
  visual_priority: string;
  script_text: string;
  tts_text: string;
  image_prompt: string;
  fallback_prompts: string[];
  image_file: string;
  audio_file: string;
}

function extractSentences(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/[^.!?\n]+(?:[.!?]+["')\]]*)?|\n+/g) || [];
  const sentences = matches.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [text];
}

/** Split script into scenes — smart (2-3 sent.), two (exactly 2), or exact (1 sentence) */
export function splitScriptIntoScenes(
  script: string,
  splitMode: "smart" | "exact" | "two" = "smart"
): Array<{ scene_number: number; script_text: string }> {
  const sentences = extractSentences(script);
  const scenes: Array<{ scene_number: number; script_text: string }> = [];
  let sceneNum = 1;

  let i = 0;
  while (i < sentences.length) {
    const sentencesPerScene = splitMode === "exact" ? 1
      : splitMode === "two" ? 2
        : Math.floor(Math.random() * 2) + 2; // smart: 2 or 3 sentences
    const group = sentences.slice(i, i + sentencesPerScene).join(" ").trim();
    if (group) scenes.push({ scene_number: sceneNum++, script_text: group });
    i += sentencesPerScene;
  }
  return scenes.length > 0 ? scenes : [{ scene_number: 1, script_text: script }];
}

/** Duration-based scene splitter — groups sentences until speaking time target is reached */
export function splitScriptByDuration(
  script: string,
  sceneDuration: number = 6
): Array<{ scene_number: number; script_text: string }> {
  const WORDS_PER_SECOND = 2.5;
  const targetWords = sceneDuration * WORDS_PER_SECOND;
  const maxWords = Math.max(targetWords * 1.5, targetWords + 20);

  const sentences = extractSentences(script);
  const scenes: Array<{ scene_number: number; script_text: string }> = [];
  let sceneNum = 1;
  let currentSentences: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const wordCount = sentence.trim().split(/\s+/).length;
    if (currentWords > 0 && currentWords + wordCount > maxWords) {
      scenes.push({ scene_number: sceneNum++, script_text: currentSentences.join("").trim() });
      currentSentences = [sentence];
      currentWords = wordCount;
    } else {
      currentSentences.push(sentence);
      currentWords += wordCount;
      if (currentWords >= targetWords) {
        scenes.push({ scene_number: sceneNum++, script_text: currentSentences.join("").trim() });
        currentSentences = [];
        currentWords = 0;
      }
    }
  }
  if (currentSentences.length > 0) {
    const text = currentSentences.join("").trim();
    if (text) scenes.push({ scene_number: sceneNum++, script_text: text });
  }
  return scenes.length > 0 ? scenes : [{ scene_number: 1, script_text: script }];
}

/** Legacy chunk splitter — kept for backward compatibility */
export function splitScriptIntoChunks(script: string, maxWords = 800): string[] {
  const sentences = extractSentences(script);
  const chunks: string[] = [];
  let current = "";
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    if (wordCount > 0 && wordCount + words > maxWords) {
      chunks.push(current.trim());
      current = sentence;
      wordCount = words;
    } else {
      current += sentence;
      wordCount += words;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [script];
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BatchPromptResult {
  scene_number: number;
  scene_type: string;
  historical_period: string;
  visual_priority: string;
  image_prompt: string;
  fallback_prompts: string[];
}

async function callGroqForBatch(
  title: string,
  scenes: Array<{ scene_number: number; script_text: string }>,
  groqApiKey: string,
  retryOnRateLimit = true,
  stylePrompt?: string
): Promise<BatchPromptResult[]> {
  const systemPrompt = stylePrompt
    ? `${BATCH_IMAGE_PROMPT}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : BATCH_IMAGE_PROMPT;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await whiskProxy({
    action: "groq-chat",
    apiKey: groqApiKey,
    payload: {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 32000,
      response_format: { type: "json_object" },
    },
  });

  if (result.status && result.status >= 400) {
    const errText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {}).substring(0, 500);
    if (result.status === 429) {
      if (retryOnRateLimit) {
        console.log("[groq] Rate limited — waiting 15s before retry...");
        await delay(15000);
        return callGroqForBatch(title, scenes, groqApiKey, false, stylePrompt);
      }
      throw new Error("Groq rate limited — try again in a moment.");
    }
    if (result.status === 401) throw new Error("Groq API key is invalid. Update it in Settings.");
    throw new Error(`Groq API error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const data = result.data;
  let content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from Groq");
  content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  
  try {
    const parsed = JSON.parse(content);
    return parsed.scenes || [];
  } catch (err: any) {
    const recovered = recoverPartialScenes(content);
    if (recovered.length > 0) return recovered;
    throw new Error(`Groq returned malformed JSON (${content.length} chars): ${err.message}. Try reducing batch size.`);
  }
}

/** Extract complete scene objects from a truncated JSON string */
function recoverPartialScenes(raw: string): BatchPromptResult[] {
  const results: BatchPromptResult[] = [];
  const sceneRegex = /\{\s*"scene_number"\s*:\s*(\d+)[\s\S]*?"fallback_prompts"\s*:\s*\[[^\]]*\]\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = sceneRegex.exec(raw)) !== null) {
    try { results.push(JSON.parse(m[0]) as BatchPromptResult); } catch { /* skip malformed */ }
  }
  return results;
}

async function callClaudeForBatch(
  title: string,
  scenes: Array<{ scene_number: number; script_text: string }>,
  anthropicApiKey: string,
  retryOnRateLimit = true,
  stylePrompt?: string,
  claudeModel = "claude-sonnet-4-6"
): Promise<BatchPromptResult[]> {
  const systemPrompt = stylePrompt
    ? `${BATCH_IMAGE_PROMPT}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : BATCH_IMAGE_PROMPT;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await whiskProxy({
    action: "claude-chat",
    apiKey: anthropicApiKey,
    payload: {
      model: claudeModel,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
  });

  if (result.status && result.status >= 400) {
    const errText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {}).substring(0, 500);
    if (result.status === 429) {
      if (retryOnRateLimit) {
        console.log("[claude] Rate limited — waiting 15s before retry...");
        await delay(15000);
        return callClaudeForBatch(title, scenes, anthropicApiKey, false, stylePrompt, claudeModel);
      }
      throw new Error("Claude rate limited — try again in a moment.");
    }
    if (result.status === 401) throw new Error("Anthropic API key is invalid. Update it in Settings.");
    throw new Error(`Claude API error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const content = result.data?.content?.[0]?.text;
  if (!content) throw new Error("No content from Claude");
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude did not return valid JSON. Response: ${cleaned.substring(0, 300)}`);
  try {
    const parsed = JSON.parse(match[0]);
    return parsed.scenes || [];
  } catch {
    // JSON truncated — recover all complete scene objects
    const recovered = recoverPartialScenes(match[0]);
    if (recovered.length > 0) return recovered;
    throw new Error(`Claude returned malformed JSON (${match[0].length} chars). Try reducing batch size.`);
  }
}

export async function generateScenesForChunk(
  title: string,
  chunk: string,
  _chunkIdx: number,
  _totalChunks: number,
  startSceneNumber: number,
  groqApiKey: string,
  splitMode: "smart" | "exact" | "duration" | "two" = "smart",
  stylePrompt?: string,
  anthropicApiKey?: string,
  claudeModel?: string
): Promise<SceneManifest[]> {
  const sceneChunks = (splitMode === "duration"
    ? splitScriptByDuration(chunk)
    : splitScriptIntoScenes(chunk, splitMode === "exact" ? "exact" : splitMode === "two" ? "two" : "smart")
  ).map((s, idx) => ({ ...s, scene_number: startSceneNumber + idx }));

  const prompts = anthropicApiKey
    ? await callClaudeForBatch(title, sceneChunks, anthropicApiKey, true, stylePrompt, claudeModel)
    : await callGroqForBatch(title, sceneChunks, groqApiKey, true, stylePrompt);

  return sceneChunks.map((sc, idx) => {
    const p = prompts[idx] || {} as BatchPromptResult;
    return {
      scene_number: sc.scene_number,
      scene_type: p.scene_type || "location",
      historical_period: p.historical_period || "",
      visual_priority: p.visual_priority || "environment",
      script_text: sc.script_text,
      tts_text: sc.script_text,
      image_prompt: p.image_prompt || "",
      fallback_prompts: p.fallback_prompts || [],
      image_file: `${sc.scene_number}.png`,
      audio_file: `${sc.scene_number}.mp3`,
    };
  });
}

export async function generateSceneManifest(
  title: string,
  script: string,
  _styleSummary: any,
  groqApiKey: string,
  splitMode: "smart" | "exact" | "duration" | "two" = "smart",
  onChunkProgress?: (current: number, total: number) => void,
  stylePrompt?: string,
  anthropicApiKey?: string,
  claudeModel?: string
): Promise<SceneManifest[]> {
  const sceneChunks = splitMode === "duration"
    ? splitScriptByDuration(script)
    : splitScriptIntoScenes(script, splitMode === "exact" ? "exact" : splitMode === "two" ? "two" : "smart");

  const BATCH_SIZE = anthropicApiKey ? 5 : 10;
  const totalBatches = Math.ceil(sceneChunks.length / BATCH_SIZE);
  const allScenes: SceneManifest[] = [];

  for (let i = 0; i < sceneChunks.length; i += BATCH_SIZE) {
    if (i > 0) await delay(2000);

    const batch = sceneChunks.slice(i, i + BATCH_SIZE);
    const batchIdx = Math.floor(i / BATCH_SIZE);
    const prompts = anthropicApiKey
      ? await callClaudeForBatch(title, batch, anthropicApiKey, true, stylePrompt, claudeModel)
      : await callGroqForBatch(title, batch, groqApiKey, true, stylePrompt);

    const merged: SceneManifest[] = batch.map((sc, idx) => {
      const p = prompts[idx] || {} as BatchPromptResult;
      return {
        scene_number: sc.scene_number,
        scene_type: p.scene_type || "location",
        historical_period: p.historical_period || "",
        visual_priority: p.visual_priority || "environment",
        script_text: sc.script_text,
        tts_text: sc.script_text,
        image_prompt: p.image_prompt || "",
        fallback_prompts: p.fallback_prompts || [],
        image_file: `${sc.scene_number}.png`,
        audio_file: `${sc.scene_number}.mp3`,
      };
    });

    allScenes.push(...merged);
    onChunkProgress?.(batchIdx + 1, totalBatches);
  }

  return allScenes;
}

// ========================
// Whisk — Image generation
// ========================

async function whiskProxy(body: any): Promise<any> {
  const res = await fetch(`/api/whisk-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisk proxy error (HTTP ${res.status}): ${errText.substring(0, 200)}`);
  }
  return res.json();
}

// Create a Whisk project/workflow and return the workflowId
async function createWhiskProject(cookie: string): Promise<string> {
  const result = await whiskProxy({
    action: "create-project",
    cookie,
    payload: { name: "Historia-" + Date.now() },
  });
  if (result.status && result.status >= 400) {
    throw new Error(`Whisk create-project failed (${result.status}): ${JSON.stringify(result.data).substring(0, 300)}`);
  }
  const workflowId = result.data?.workflowId;
  if (!workflowId) throw new Error(`No workflowId from Whisk. Response: ${JSON.stringify(result.data).substring(0, 300)}`);
  return workflowId;
}

// Caption an image via Whisk's backbone.captionImage
async function captionWhiskImage(
  rawBytes: string,
  mediaCategory: string,
  workflowId: string,
  cookie: string
): Promise<string> {
  const result = await whiskProxy({
    action: "caption-image",
    cookie,
    payload: { rawBytes, mediaCategory, workflowId },
  });
  if (result.status && result.status >= 400) {
    console.warn(`Whisk caption failed (${result.status}), using empty caption`);
    return "";
  }
  const caption = result.data?.candidates?.[0]?.output || "";
  return caption;
}

// Upload an image to Whisk and get a media generation ID for use as a reference
async function uploadToWhisk(
  rawBytes: string,
  caption: string,
  mediaCategory: string,
  workflowId: string,
  cookie: string
): Promise<string> {
  const result = await whiskProxy({
    action: "upload",
    cookie,
    payload: { rawBytes, caption, mediaCategory, workflowId },
  });
  if (result.status && result.status >= 400) {
    throw new Error(`Whisk upload failed (${result.status}): ${JSON.stringify(result.data).substring(0, 300)}`);
  }
  const mediaId = result.data?.uploadMediaGenerationId;
  if (!mediaId) throw new Error(`No uploadMediaGenerationId from Whisk. Response: ${JSON.stringify(result.data).substring(0, 300)}`);
  return mediaId;
}




export async function generateWhiskImage(
  prompt: string,
  cookie: string,
  styleImageUrls?: string[],
  projectId?: string
): Promise<Blob> {
  const genResult = await whiskProxy({
    action: "generate",
    cookie,
    projectId,
    payload: {
      userInput: { candidatesCount: 1, prompts: [prompt] },
      aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE",
    },
  });

  if (genResult.status && genResult.status >= 400) {
    const detail = JSON.stringify(genResult.data || genResult).substring(0, 300);
    console.error(`Whisk generate error ${genResult.status}:`, detail);
    if (genResult.status === 429) throw new Error("Whisk rate limited — wait a minute and try again.");
    if (genResult.status === 401 || genResult.status === 403) throw new Error("Whisk auth expired. Update your Whisk Cookie in Settings.");
    throw new Error(`Whisk failed (${genResult.status}): ${detail}`);
  }

  const encodedImage = genResult.data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
  if (!encodedImage) throw new Error("No image in Whisk response");

  return base64ToBlob(encodedImage);
}

// Convert blob to data URL (data:image/...;base64,...) for Whisk API
async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const mimeType = blob.type || "image/png";
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function base64ToBlob(encodedImage: string): Blob {
  const binary = atob(encodedImage);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

// ========================
// Inworld — TTS audio
// ========================

export async function generateInworldAudio(
  text: string,
  inworldApiKey: string,
  voiceId = "Dennis",
  modelId = "inworld-tts-1.5-max"
): Promise<Blob> {
  const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${inworldApiKey}`,
    },
    body: JSON.stringify({
      text: text.substring(0, 2000),
      voiceId,
      modelId,
      audioConfig: { audioEncoding: "MP3", sampleRateHertz: 22050 },
      temperature: 1.0,
      applyTextNormalization: "ON",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) throw new Error("Inworld rate limited — wait and retry.");
    if (response.status === 401 || response.status === 403) throw new Error("Inworld API key is invalid. Update it in Settings.");
    throw new Error(`Inworld TTS failed (HTTP ${response.status}): ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const audioContent = data.audioContent;
  if (!audioContent) throw new Error("No audioContent in Inworld response");

  const binary = atob(audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "audio/mpeg" });
}

// ========================
// Groq — Regenerate image prompt
// ========================

export async function regenerateImagePrompt(
  scriptText: string,
  groqApiKey: string,
  _styleSummary?: any,
  anthropicApiKey?: string,
  claudeModel?: string
): Promise<string> {
  const systemPrompt = `You are a visual content director generating a single image prompt for a YouTube history documentary scene.

PROMPT STRUCTURE (exactly one sentence):
[Who is present] + [what they are doing] + [where they are] + [camera angle/framing] + [lighting and mood]

STYLE RULES:
- Cinematic historical realism, photographic documentary, Caravaggio-level contrast
- All figures anonymous: silhouettes, backs turned, faces obscured by helmets/hoods/shadow/dust
- Clear visible action — never a static description
- Camera options: close-up of hands/weapons, medium shot, wide battlefield, over-the-shoulder, ground-level, high angle, silhouette shot
- Lighting: harsh midday sun, pre-dawn blue, torch/fire glow, dust-filtered gold, sunset silhouette
- Color: desaturated earth tones, bronze, ochre, dust brown, deep reds

RESTRICTIONS: No text overlays, no identifiable faces, no fantasy/sci-fi/modern elements.

Return ONLY the prompt text — one sentence ending with a period. No JSON, no markdown, no explanation.`;

  const userPrompt = `Script text to visualize:\n${scriptText}\n\nGenerate one cinematic image prompt for this scene.`;

  if (anthropicApiKey) {
    const result = await whiskProxy({
      action: "claude-chat",
      apiKey: anthropicApiKey,
      payload: {
        model: claudeModel || "claude-sonnet-4-6",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
    });

    if (result.status && result.status >= 400) {
      const errText = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
      throw new Error(`Claude error: ${result.status} - ${errText}`);
    }

    const content = result.data?.content?.[0]?.text;
    if (!content) throw new Error("No content from Claude");
    return content.trim();
  }

  const result = await whiskProxy({
    action: "groq-chat",
    apiKey: groqApiKey,
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      },
    });

  if (result.status && result.status >= 400) {
    const errText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {}).substring(0, 500);
    throw new Error(`Groq error: ${result.status} - ${errText}`);
  }

  const data = result.data;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from Groq");
  return content.trim();
}

