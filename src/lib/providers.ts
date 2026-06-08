// Frontend provider utilities — all API calls happen client-side

// ========================
// Settings helpers
// ========================

export interface CustomVoice {
  id: string;
  name: string;
}

export type OverlayPosition =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export const OVERLAY_POSITIONS: { value: OverlayPosition; label: string; row: number; col: number }[] = [
  { value: "top-left", label: "Top Left", row: 0, col: 0 },
  { value: "top-center", label: "Top Center", row: 0, col: 1 },
  { value: "top-right", label: "Top Right", row: 0, col: 2 },
  { value: "center-left", label: "Mid Left", row: 1, col: 0 },
  { value: "center", label: "Center", row: 1, col: 1 },
  { value: "center-right", label: "Mid Right", row: 1, col: 2 },
  { value: "bottom-left", label: "Bot Left", row: 2, col: 0 },
  { value: "bottom-center", label: "Bot Center", row: 2, col: 1 },
  { value: "bottom-right", label: "Bot Right", row: 2, col: 2 },
];

export const OVERLAY_FONTS = [
  { value: "Tox Typewriter", label: "Tox Typewriter (default)" },
  { value: "DejaVu Sans Mono", label: "DejaVu Sans Mono" },
  { value: "Liberation Mono", label: "Liberation Mono" },
  { value: "Courier New", label: "Courier New" },
  { value: "Ubuntu Mono", label: "Ubuntu Mono" },
  { value: "FreeMono", label: "FreeMono" },
];

export interface ProviderSettings {
  imageProvider: string;
  imageModel: string;
  aspectRatio: "16:9" | "1:1" | "9:16";
  ttsProvider: string;
  voiceId: string;
  modelId: string;
  imageConcurrency: number;
  audioConcurrency: number;
  groqApiKeys: string[];
  googleCloudApiKey: string;
  claudeModel: string;
  geminiModel: string;
  groqModel: string;
  textProvider: "groq" | "claude" | "inworld" | "gemini";
  inworldApiKey: string;
  customVoices: CustomVoice[];
  skipImageGeneration: boolean;
  subtitleDelay?: number;
  overlayPosition?: OverlayPosition;
  overlayFont?: string;
}

export const IMAGE_MODELS = [
  { id: "imagen-4.0-fast-generate-001", label: "Imagen 4 Fast" },
  { id: "imagen-4.0-generate-001", label: "Imagen 4" },
  { id: "imagen-4.0-ultra-generate-001", label: "Imagen 4 Ultra" },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash" },
  { id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image" },
] as const;

export const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 Landscape" },
  { value: "1:1", label: "1:1 Square" },
  { value: "9:16", label: "9:16 Portrait" },
] as const;

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
  imageProvider: "gemini",
  imageModel: "imagen-4.0-fast-generate-001",
  aspectRatio: "16:9",
  ttsProvider: "inworld",
  voiceId: "Dennis",
  modelId: "inworld-tts-1.5-max",
  imageConcurrency: 2,
  audioConcurrency: 2,
  groqApiKeys: [""],
  googleCloudApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  geminiModel: "gemini-3.1-pro-preview",
  groqModel: "llama-3.3-70b-versatile",
  textProvider: "groq",
  inworldApiKey: "",
  customVoices: [],
  skipImageGeneration: false,
  subtitleDelay: 0.8,
  overlayPosition: "bottom-left",
  overlayFont: "Tox Typewriter",
};

export function loadProviderSettings(): ProviderSettings {
  try {
    const raw = localStorage.getItem("historia-settings");
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Migrate old single groqApiKey to array
    if (typeof parsed.groqApiKey === "string" && !parsed.groqApiKeys) {
      parsed.groqApiKeys = parsed.groqApiKey ? [parsed.groqApiKey] : [""];
      delete parsed.groqApiKey;
    }
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function saveProviderSettings(settings: ProviderSettings) {
  localStorage.setItem("historia-settings", JSON.stringify(settings));
}

// ========================
// Shared — API proxy helper
// ========================

async function apiProxy(body: any): Promise<any> {
  const res = await fetch(`/api/gemini-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API proxy error (HTTP ${res.status}): ${errText.substring(0, 200)}`);
  }
  return res.json();
}

// ========================
// Groq — Scene manifest generation
// ========================

// ── Style-prompt mode constants ────────────────────────────────────────────

export const COMPACT_STYLE_SUFFIX =
  `in a Digital oil painting, heavy impasto style, 17th-century academic military realism, cinematic oil painting, thick impasto brushstrokes, visible canvas texture, muted earth tones, dramatic chiaroscuro lighting, smoky atmosphere, historical accuracy, aged parchment cartography, vintage textured infographics, hand-inked military schematics, premium documentary look, desaturated palette, immersive cinematic composition, 16:9, highly detailed`;

export const COMPACT_WWII_STYLE_SUFFIX =
  `in an ultra-realistic WWII archival photograph, cinematic black-and-white war photojournalism, dramatic chiaroscuro lighting, deep shadows, authentic wool military uniforms, shallow depth of field, captured on vintage 35mm Kodak Tri-X film, subtle film grain, documentary realism, historically accurate, cinematic composition, masterpiece quality, 16:9`;

/** System prompt used when project has a stylePrompt — Groq generates ONLY the [Subject] part. */
const STYLE_PROMPT_BATCH_IMAGE_PROMPT = `You are a visual content director for a historical epic documentary.

For each numbered scene below, generate ONE short subject description and THREE fallback descriptions.

PURPOSE: These will be combined with a style suffix later. Generate ONLY the [Subject] part.
Do NOT include any style, mood, aesthetic, or quality words — those are added automatically.
sample .


Digital oil painting, heavy impasto. Black void frame, ancient Near Eastern landscape emerging from total darkness. A river surface occupies the lower third, catching gold late-afternoon light in broken, textured brushstrokes. The far bank is a steep dark mass, barely visible, with the silhouettes of Persian horsemen massed on the ridge like a wall. Deep chiaroscuro. No faces visible yet. Atmospheric, ominous. Title treatment: "GRANICUS" in high-contrast serif over the composition.
 
Tactical Parchment map. Tea-stained aged vellum with visible creases. The Aegean coast of Asia Minor rendered in 17th-century cartographic hand with decorative compass rose lower right. The Hellespont crossing marked with a bold arrow in Williamite blue. Alexander's march route traced in blue from the crossing south to the Granicus River, marked with a crossed-lance icon. Hand-calligraphic place names: "Hellespont," "Granicus River," "Zelia," "Troy." Decorative border with Macedonian star motif. Clean sans-serif annotation: "Alexander's advance, Spring 334 BCE."
 
Digital oil painting, visible brushwork throughout. Mid-shot of Alexander of Macedon standing at the river's edge, back three-quarters to the viewer, surveying the far bank. He wears a Hellenistic bronze breastplate with detailed impasto highlighting, a white-plumed Boeotian helmet. His posture is still, deliberate, charged with suppressed energy. The Granicus River fills the middle ground, swirling current rendered in thick fluid brushstrokes of gray-green and gold. The far bank is a dark, chaotic mass of Persian cavalry silhouettes. Late afternoon light from the upper left. Heavy shadow across the lower composition.
 

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

4. INFORMATIONAL ASSET DESIGN.
All maps must use a Tactical Parchment style: aged tea-stained background with visible creases, 17th-century hand-drawn cartographic coastlines, decorative compass roses, calligraphic place names 
All infographics must follow a Museum Gallery aesthetic with heraldic iconography including the Williamite Lion, the Jacobite Harp, and the French Fleur-de-lis placed as corner devices or header elements. All typography must use a Hybrid Vintage-Modern approach: elegant high-contrast serif fonts for titles and clean legible sans-serif fonts for data labels and annotations. 
Diagrams must use flowchart logic for causality chains such as: Smoke Confusion → Friendly Fire → Catastrophic Loss. Use distinct icons for infantry, cavalry, and artillery units alongside national flags and crests for army composition breakdowns.

5. TACTICAL SPECIFICS
When depicting the Battle of the Boyne or any conflict involving field identification challenges, the green sprig marker for Williamite forces and the white paper marker for Jacobite forces must appear prominently in all relevant close-up scenes and be specifically labeled in infographics. All multinational army compositions must be explicitly visualized through varying uniform colors, national flags, and unit crests representing Dutch, Danish, Huguenot, English, and Irish contingents.

6. HARD CONSTRAINTS
No photorealistic textures or clean CGI renders. No modern sans-serif fonts used in isolation without antique pairing elements. No flat 2D vector-style illustrations. No bright neon or digital-native gradient colors. No rapid cutting below the 9-second average image interval.


OPERATIONAL TRIGGER:
When given a historical event, output the full script with word count, a scene-by-scene visual storyboard specifying image type (narrative or infographic

PROMPT STRUCTURE — each prompt must be exactly 5 to 7 sentence:
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
- THE Detailed real historical MAPs with animated routes.
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

const BATCH_WWII_IMAGE_PROMPT = `You are the Lead Creative Director and Historical Consultant for a high-end educational documentary series. You produce historical videos exploring World War II warfare through a human-centered tactical lens.

For each numbered scene below, generate ONE cinematic image prompt and THREE fallback prompts.
Each image prompt must follow the script — not random — it must follow the story.

1. VISUAL AESTHETIC
All imagery must be rendered as WWII Archival Photorealism — ultra-realistic, cinematic black-and-white war photojournalism. Every image must feel like an authentic recovered wartime photograph: emotionally raw, historically accurate, and documentary in nature. Apply dramatic chiaroscuro lighting with deep shadows and sharp focal highlights on faces, uniforms, weapons, and machinery. All images must simulate 35mm film grain using textures consistent with Kodak Tri-X film stock. Apply shallow depth of field where the foreground subject is razor-sharp and the background dissolves into grain and smoke. Smoke, mud, rain, fire, and atmospheric battlefield haze must appear as recurring visual elements creating depth and tension. All figures must feature hyper-detailed period-accurate textures: authentic wool military uniforms, wet leather, rusted steel, canvas webbing, and weathered skin with visible emotional expression. The overall aesthetic must feel like a masterpiece-quality wartime press photograph — grave, cinematic, historically immersive.

2. INFORMATIONAL ASSET DESIGN
All maps must use an Aged Wartime Document style: yellowed or tea-stained paper with visible fold creases, water damage, and foxing spots. Terrain rendered in hand-drafted 1940s military cartographic style with contour lines, river crossings, and village names in vintage serif type.  Stamps such as "CLASSIFIED," "TOP SECRET," or operation names in faded block type. Typewritten annotations for dates and unit labels. All infographics must follow an Aged Military Intelligence aesthetic: yellowed paper background, period hand-drafted line art, OSS or War Office document styling, faded stamps, and foxing. Unit icons use period military silhouettes for infantry, armor, artillery, and air assets alongside national insignia such as the Allied star, Wehrmacht eagle, Soviet hammer, and Rising Sun as header or corner devices. All typography must use a Hybrid Vintage-Modern approach: high-contrast vintage serif fonts for titles and clean legible sans-serif for data labels. Diagrams must use flowchart logic for causality chains such as: Air Superiority → Supply Disruption → Front Collapse. Scanned archival document aesthetic throughout — everything must feel declassified and reproduced from microfilm.
3. TACTICAL SPECIFICS
When depicting any WWII engagement, all multinational force compositions must be explicitly visualized through varying uniform textures, national insignia, and unit markings representing American, British, Soviet, German, French, Italian, and Japanese forces where relevant. Field identification markers, unit patches, rank insignia, and vehicle markings must appear prominently in close-up scenes and be labeled in infographics.

4. HARD CONSTRAINTS
No color imagery. No oil painting or painterly textures. No visible brushstrokes. No CGI renders or digital illustration aesthetics. No bright or tonal gradients inconsistent with monochrome film. No flat 2D vector-style illustrations. No rapid cutting below the 9-second average image interval.

Return ONLY valid JSON matching this exact schema:
{
  "scenes": [
    {
      "scene_number": 1,
      "scene_type": "character|location|crowd|battle_light|artifact|transition",
      "historical_period": "WWII",
      "visual_priority": "character|environment|object",
      "image_prompt": "One complete cinematic WWII archival black-and-white photo prompt.",
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

function mergeShortSentences(sentences: string[], minWords: number): string[] {
  const result: string[] = [];
  for (const s of sentences) {
    const wc = s.trim().split(/\s+/).filter(Boolean).length;
    if (wc < minWords && result.length > 0) {
      result[result.length - 1] += " " + s;
    } else {
      result.push(s);
    }
  }
  // If the first sentence is still short, merge it into the second
  if (result.length >= 2 && result[0].trim().split(/\s+/).filter(Boolean).length < minWords) {
    result[1] = result[0] + " " + result[1];
    result.shift();
  }
  return result;
}

/** Split script into scenes — smart (2-3 sent.), two (exactly 2), or exact (1 sentence) */
export function splitScriptIntoScenes(
  script: string,
  splitMode: "smart" | "exact" | "two" = "smart"
): Array<{ scene_number: number; script_text: string }> {
  const rawSentences = extractSentences(script);
  // In exact mode, merge any sentence under 7 words into its neighbor
  const sentences = splitMode === "exact" ? mergeShortSentences(rawSentences, 7) : rawSentences;
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
      scenes.push({ scene_number: sceneNum++, script_text: currentSentences.join(" ").trim() });
      currentSentences = [sentence];
      currentWords = wordCount;
    } else {
      currentSentences.push(sentence);
      currentWords += wordCount;
      if (currentWords >= targetWords) {
        scenes.push({ scene_number: sceneNum++, script_text: currentSentences.join(" ").trim() });
        currentSentences = [];
        currentWords = 0;
      }
    }
  }
  if (currentSentences.length > 0) {
    const text = currentSentences.join(" ").trim();
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
  groqApiKeys: string[],
  stylePrompt?: string,
  visualTheme?: "impasto" | "ww2",
  keyIndex = 0
): Promise<BatchPromptResult[]> {
  const activeKeys = groqApiKeys.filter(k => k?.trim());
  const apiKey = activeKeys[keyIndex] || activeKeys[0] || "";

  const basePrompt = visualTheme === "ww2" ? BATCH_WWII_IMAGE_PROMPT : BATCH_IMAGE_PROMPT;
  const systemPrompt = stylePrompt
    ? `${basePrompt}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : basePrompt;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await apiProxy({
    action: "groq-chat",
    apiKey,
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
    if (result.status === 429 || result.status === 401) {
      const nextIndex = keyIndex + 1;
      if (nextIndex < activeKeys.length) {
        console.log(`[groq] Key ${keyIndex + 1} failed (${result.status}) — trying key ${nextIndex + 1} of ${activeKeys.length}...`);
        return callGroqForBatch(title, scenes, groqApiKeys, stylePrompt, visualTheme, nextIndex);
      }
      if (result.status === 429) throw new Error("All Groq API keys are rate limited — try again in a moment.");
      throw new Error("Groq API key is invalid. Update it in Settings.");
    }
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
  googleCloudApiKey: string,
  retryOnRateLimit = true,
  stylePrompt?: string,
  claudeModel = "claude-sonnet-4-6",
  visualTheme?: "impasto" | "ww2"
): Promise<BatchPromptResult[]> {
  const basePrompt = visualTheme === "ww2" ? BATCH_WWII_IMAGE_PROMPT : BATCH_IMAGE_PROMPT;
  const systemPrompt = stylePrompt
    ? `${basePrompt}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : basePrompt;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await apiProxy({
    action: "claude-chat",
    apiKey: googleCloudApiKey,
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
        return callClaudeForBatch(title, scenes, googleCloudApiKey, false, stylePrompt, claudeModel, visualTheme);
      }
      throw new Error("Claude rate limited — try again in a moment.");
    }
    if (result.status === 401) throw new Error("Google Cloud credentials or project configuration is invalid.");
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

async function callInworldForBatch(
  title: string,
  scenes: Array<{ scene_number: number; script_text: string }>,
  inworldApiKey: string,
  retryOnRateLimit = true,
  stylePrompt?: string,
  visualTheme?: "impasto" | "ww2"
): Promise<BatchPromptResult[]> {
  const basePrompt = visualTheme === "ww2" ? BATCH_WWII_IMAGE_PROMPT : BATCH_IMAGE_PROMPT;
  const systemPrompt = stylePrompt
    ? `${basePrompt}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : basePrompt;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await apiProxy({
    action: "inworld-chat",
    apiKey: inworldApiKey,
    payload: {
      model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 1000,
      response_format: {
        type: "json_object"
      }
    },
  });

  if (result.status && result.status >= 400) {
    const errText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {}).substring(0, 500);
    if (result.status === 429) {
      if (retryOnRateLimit) {
        console.log("[inworld] Rate limited — waiting 15s before retry...");
        await delay(15000);
        return callInworldForBatch(title, scenes, inworldApiKey, false, stylePrompt, visualTheme);
      }
      throw new Error("Inworld rate limited — try again in a moment.");
    }
    if (result.status === 401) throw new Error("Inworld API key is invalid. Update it in Settings.");
    throw new Error(`Inworld API error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const data = result.data;
  let content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("No content from Inworld");

  content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(content);
    return parsed.scenes || [];
  } catch (err: any) {
    const recovered = recoverPartialScenes(content);
    if (recovered.length > 0) return recovered;
    throw new Error(`Inworld returned malformed JSON (${content.length} chars): ${err.message}.`);
  }
}

async function callGeminiForBatch(
  title: string,
  scenes: Array<{ scene_number: number; script_text: string }>,
  googleCloudApiKey: string,
  retryOnRateLimit = true,
  stylePrompt?: string,
  geminiModel?: string,
  visualTheme?: "impasto" | "ww2"
): Promise<BatchPromptResult[]> {
  const basePrompt = visualTheme === "ww2" ? BATCH_WWII_IMAGE_PROMPT : BATCH_IMAGE_PROMPT;
  const systemPrompt = stylePrompt
    ? `${basePrompt}\n\n---\nADDITIONAL STYLE DIRECTION (follow these instructions for all image prompts):\n${stylePrompt}`
    : basePrompt;
  const scenesText = scenes
    .map(s => `Scene ${s.scene_number}: "${s.script_text}"`)
    .join("\n");

  const userPrompt = `Video Title: ${title}\n\nGenerate image prompts for these ${scenes.length} scenes:\n\n${scenesText}\n\nReturn ONLY the JSON object.`;

  const result = await apiProxy({
    action: "gemini-chat",
    apiKey: googleCloudApiKey,
    payload: {
      model: geminiModel || "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 8192,
        topP: 0.95,
        responseMimeType: "application/json",
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" }
      ]
    },
  });

  if (result.status && result.status >= 400) {
    const errText = typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {}).substring(0, 500);
    if (result.status === 429) {
      if (retryOnRateLimit) {
        console.log("[gemini-text] Rate limited — waiting 15s before retry...");
        await delay(15000);
        return callGeminiForBatch(title, scenes, googleCloudApiKey, false, stylePrompt, geminiModel, visualTheme);
      }
      throw new Error("Gemini rate limited — try again in a moment.");
    }
    if (result.status === 401) throw new Error("Google Cloud API Key is invalid. Update it in Settings.");
    throw new Error(`Gemini API error (HTTP ${result.status}): ${errText.substring(0, 200)}`);
  }

  const data = result.data;
  let content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    content = data?.choices?.[0]?.message?.content;
  }
  if (!content) throw new Error("No content from Gemini");
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Gemini did not return valid JSON. Response: ${cleaned.substring(0, 300)}`);
  try {
    const parsed = JSON.parse(match[0]);
    return parsed.scenes || [];
  } catch {
    const recovered = recoverPartialScenes(match[0]);
    if (recovered.length > 0) return recovered;
    throw new Error(`Gemini returned malformed JSON (${match[0].length} chars). Try reducing batch size.`);
  }
}

export async function generateScenesForChunk(
  title: string,
  chunk: string,
  _chunkIdx: number,
  _totalChunks: number,
  startSceneNumber: number,
  groqApiKeys: string[],
  splitMode: "smart" | "exact" | "duration" | "two" = "smart",
  stylePrompt?: string,
  googleCloudApiKey?: string,
  claudeModel?: string,
  inworldApiKey?: string,
  textProvider?: "groq" | "claude" | "inworld" | "gemini",
  visualTheme?: "impasto" | "ww2",
  geminiModel?: string
): Promise<SceneManifest[]> {
  const sceneChunks = (splitMode === "duration"
    ? splitScriptByDuration(chunk)
    : splitScriptIntoScenes(chunk, splitMode === "exact" ? "exact" : splitMode === "two" ? "two" : "smart")
  ).map((s, idx) => ({ ...s, scene_number: startSceneNumber + idx }));

  const useProvider = textProvider || (googleCloudApiKey ? "claude" : (inworldApiKey ? "inworld" : "groq"));

  const prompts = useProvider === "inworld"
    ? await callInworldForBatch(title, sceneChunks, inworldApiKey || "", true, stylePrompt, visualTheme)
    : useProvider === "claude"
      ? await callClaudeForBatch(title, sceneChunks, googleCloudApiKey || "", true, stylePrompt, claudeModel, visualTheme)
      : useProvider === "gemini"
        ? await callGeminiForBatch(title, sceneChunks, googleCloudApiKey || "", true, stylePrompt, geminiModel, visualTheme)
        : await callGroqForBatch(title, sceneChunks, groqApiKeys, stylePrompt, visualTheme);

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
  groqApiKeys: string[],
  splitMode: "smart" | "exact" | "duration" | "two" = "smart",
  onChunkProgress?: (current: number, total: number) => void,
  stylePrompt?: string,
  googleCloudApiKey?: string,
  claudeModel?: string,
  inworldApiKey?: string,
  textProvider?: "groq" | "claude" | "inworld" | "gemini",
  visualTheme?: "impasto" | "ww2",
  geminiModel?: string
): Promise<SceneManifest[]> {
  const sceneChunks = splitMode === "duration"
    ? splitScriptByDuration(script)
    : splitScriptIntoScenes(script, splitMode === "exact" ? "exact" : splitMode === "two" ? "two" : "smart");

  const useProvider = textProvider || (googleCloudApiKey ? "claude" : (inworldApiKey ? "inworld" : "groq"));
  const BATCH_SIZE = useProvider === "inworld" ? 15 : (useProvider === "claude" ? 5 : 10);
  const totalBatches = Math.ceil(sceneChunks.length / BATCH_SIZE);
  const allScenes: SceneManifest[] = [];

  for (let i = 0; i < sceneChunks.length; i += BATCH_SIZE) {
    if (i > 0) await delay(2000);

    const batch = sceneChunks.slice(i, i + BATCH_SIZE);
    const batchIdx = Math.floor(i / BATCH_SIZE);

    const prompts = useProvider === "inworld"
      ? await callInworldForBatch(title, batch, inworldApiKey || "", true, stylePrompt, visualTheme)
      : useProvider === "claude"
        ? await callClaudeForBatch(title, batch, googleCloudApiKey || "", true, stylePrompt, claudeModel, visualTheme)
        : useProvider === "gemini"
          ? await callGeminiForBatch(title, batch, googleCloudApiKey || "", true, stylePrompt, geminiModel, visualTheme)
          : await callGroqForBatch(title, batch, groqApiKeys, stylePrompt, visualTheme);

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
// Gemini — Image generation
// ========================

export async function generateGeminiImage(prompt: string, imageModel?: string, aspectRatio?: string): Promise<Blob> {
  const genResult = await apiProxy({
    action: "generate",
    payload: {
      userInput: { candidatesCount: 1, prompts: [prompt] },
      modelId: imageModel,
      aspectRatio: aspectRatio || "16:9",
    },
  });

  if (genResult.status && genResult.status >= 400) {
    const detail = JSON.stringify(genResult.data || genResult).substring(0, 300);
    console.error(`Gemini generate error ${genResult.status}:`, detail);
    if (genResult.status === 429) throw new Error("Imagen rate limited — wait a minute and try again.");
    throw new Error(`Imagen failed (${genResult.status}): ${detail}`);
  }

  const encodedImage = genResult.data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
  if (!encodedImage) throw new Error("No image in Gemini response");

  return base64ToBlob(encodedImage);
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
  groqApiKeys: string[],
  _styleSummary?: any,
  googleCloudApiKey?: string,
  claudeModel?: string,
  inworldApiKey?: string,
  textProvider?: "groq" | "claude" | "inworld" | "gemini",
  visualTheme?: "impasto" | "ww2",
  geminiModel?: string
): Promise<string> {
  const systemPrompt = visualTheme === "ww2"
    ? `You are a visual content director generating a single image prompt for a WWII documentary scene.

PROMPT STRUCTURE (exactly one sentence):
[Who is present] + [what they are doing] + [where they are] + [camera angle/framing] + [lighting and mood]

STYLE RULES:
- WWII Archival Photorealism, ultra-realistic black-and-white photojournalism, Kodak Tri-X film stock simulation
- Dramatic chiaroscuro lighting, deep shadows, atmospheric haze, smoke, mud, rain
- Figures splattered in mud, wool uniforms, helmets, emotional expressions
- Clear visible action — never a static description
- Camera options: close-up of hands/weapons/eyes, medium shot, wide battlefield, over-the-shoulder, ground-level, high angle

RESTRICTIONS: No color, no painterly textures, no text overlays, no identifiable faces, no CGI/digital illustration aesthetics.

Return ONLY the prompt text — one sentence ending with a period. No JSON, no markdown, no explanation.`
    : `You are a visual content director generating a single image prompt for a YouTube history documentary scene.

PROMPT STRUCTURE (exactly 3 to 5 sentences):
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

  const useProvider = textProvider || (googleCloudApiKey ? "claude" : (inworldApiKey ? "inworld" : "groq"));

  if (useProvider === "inworld") {
    const result = await apiProxy({
      action: "inworld-chat",
      apiKey: inworldApiKey || "",
      payload: {
        model: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: 1000,
      },
    });

    if (result.status && result.status >= 400) {
      const errText = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
      throw new Error(`Inworld error: ${result.status} - ${errText}`);
    }

    const content = result.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content from Inworld");
    return content.trim();
  }

  if (useProvider === "claude") {
    const result = await apiProxy({
      action: "claude-chat",
      apiKey: googleCloudApiKey || "",
      payload: {
        model: claudeModel || "claude-sonnet-4-6",
        max_tokens: 1000,
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

  if (useProvider === "gemini") {
    const result = await apiProxy({
      action: "gemini-chat",
      apiKey: googleCloudApiKey || "",
      payload: {
        model: geminiModel || "gemini-3.1-pro-preview",
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          temperature: 1,
          maxOutputTokens: 2048,
          topP: 0.95,
          thinkingConfig: {
            thinkingLevel: "MEDIUM"
          }
        },
      },
    });

    if (result.status && result.status >= 400) {
      const errText = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
      throw new Error(`Gemini error: ${result.status} - ${errText}`);
    }

    let content = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      content = result.data?.choices?.[0]?.message?.content;
    }
    if (!content) throw new Error("No content from Gemini");
    return content.trim();
  }

  const activeKeys = groqApiKeys.filter(k => k?.trim());
  let lastError: Error = new Error("No Groq API keys configured.");
  for (let i = 0; i < activeKeys.length; i++) {
    const result = await apiProxy({
      action: "groq-chat",
      apiKey: activeKeys[i],
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
      },
    });

    if (result.status === 429 || result.status === 401) {
      console.log(`[groq] Key ${i + 1} failed (${result.status})${i + 1 < activeKeys.length ? " — trying next key..." : ""}`);
      lastError = new Error(result.status === 429 ? "Groq rate limited" : "Groq API key invalid");
      continue;
    }

    if (result.status && result.status >= 400) {
      const errText = typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data || {}).substring(0, 500);
      throw new Error(`Groq error: ${result.status} - ${errText}`);
    }

    const content = result.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content from Groq");
    return content.trim();
  }
  throw lastError;
}

