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
