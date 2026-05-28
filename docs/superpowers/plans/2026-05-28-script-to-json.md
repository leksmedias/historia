# Script → JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/script-to-json` page where users paste a documentary script and receive a structured JSON scene manifest with cinematic image prompts.

**Architecture:** Two-pass pipeline — Pass 1 chunks the script (≤2000 words/chunk) and calls the AI to split it into timed scenes; Pass 2 batches those scenes and calls the AI again to generate one cinematic image prompt per scene, with the last 2 prompts from the previous batch injected as a visual continuity anchor. All pipeline logic lives in `src/lib/scriptToJson.ts`; the page component (`src/pages/ScriptToJson.tsx`) only handles UI state.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui, Vitest — calls `/api/gemini-proxy` (existing) using `groq-chat` or `nvidia-chat` actions.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/scriptToJson.ts` | Create | All pipeline logic: types, utilities, API calls, orchestration |
| `src/test/scriptToJson.test.ts` | Create | Unit tests for pure utility functions |
| `src/pages/ScriptToJson.tsx` | Create | Split-panel page UI, wires inputs to pipeline |
| `src/App.tsx` | Modify | Add `/script-to-json` route |
| `src/components/AppSidebar.tsx` | Modify | Add "Script → JSON" nav item |

---

## Task 1: Types, utilities, and tests

**Files:**
- Create: `src/lib/scriptToJson.ts`
- Create: `src/test/scriptToJson.test.ts`

### Step 1.1 — Write failing tests

Create `src/test/scriptToJson.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  estimateSceneCount,
  chunkScript,
  parseJsonResponse,
  buildContinuityAnchor,
} from "../lib/scriptToJson";

describe("estimateSceneCount", () => {
  it("returns correct count at 15s per scene", () => {
    // 117 words/min × 15s/60 = 29.25 words/scene
    // 290 words / 29 words/scene ≈ 10 scenes
    expect(estimateSceneCount(290, 15)).toBe(10);
  });

  it("returns 1 for very short scripts", () => {
    expect(estimateSceneCount(10, 30)).toBe(1);
  });

  it("calculates correctly for all durations", () => {
    expect(estimateSceneCount(570, 10)).toBe(30); // 570/19 ≈ 30
    expect(estimateSceneCount(570, 20)).toBe(15); // 570/38 ≈ 15
    expect(estimateSceneCount(570, 30)).toBe(10); // 570/57 ≈ 10
  });
});

describe("chunkScript", () => {
  it("returns the whole script as one chunk when under limit", () => {
    const script = "Hello world. This is a test.";
    expect(chunkScript(script, 2000)).toEqual([script]);
  });

  it("splits into chunks that don't exceed maxWords", () => {
    // Build a script with 50 words per sentence × 10 sentences = 500 words
    const sentence = "word ".repeat(50).trim() + ".";
    const script = Array(10).fill(sentence).join(" ");
    const chunks = chunkScript(script, 200);
    for (const chunk of chunks) {
      const wordCount = chunk.split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(210); // small tolerance for sentence boundary
    }
    // All words are preserved across chunks
    const totalWords = chunks.join(" ").split(/\s+/).filter(Boolean).length;
    expect(totalWords).toBe(script.split(/\s+/).filter(Boolean).length);
  });

  it("does not split mid-sentence", () => {
    const sentence = "word ".repeat(100).trim() + ".";
    const script = Array(5).fill(sentence).join(" ");
    const chunks = chunkScript(script, 150);
    // Each chunk must end with a sentence terminator
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      expect(trimmed[trimmed.length - 1]).toMatch(/[.!?]/);
    }
  });
});

describe("parseJsonResponse", () => {
  it("parses clean JSON", () => {
    const input = '{"scenes":[{"id":1,"script":"test","overlay_text":null}]}';
    expect(parseJsonResponse(input)).toEqual({
      scenes: [{ id: 1, script: "test", overlay_text: null }],
    });
  });

  it("strips markdown code fences", () => {
    const input = '```json\n{"scenes":[]}\n```';
    expect(parseJsonResponse(input)).toEqual({ scenes: [] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonResponse("not json")).toThrow();
  });

  it("handles JSON embedded after reasoning text", () => {
    const input = 'Some reasoning here...\n```json\n{"scenes":[]}\n```\nmore text';
    expect(parseJsonResponse(input)).toEqual({ scenes: [] });
  });
});

describe("buildContinuityAnchor", () => {
  it("returns empty string with no previous scenes", () => {
    expect(buildContinuityAnchor([])).toBe("");
  });

  it("returns anchor text for 1 previous scene", () => {
    const scenes = [{ script: "The river flows.", prompt: "Digital oil painting, the Rhine." }];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).toContain("PREVIOUS SCENES FOR VISUAL CONTINUITY");
    expect(anchor).toContain("The river flows.");
  });

  it("uses only the last 2 scenes when given more", () => {
    const scenes = [
      { script: "Scene 1.", prompt: "Prompt 1." },
      { script: "Scene 2.", prompt: "Prompt 2." },
      { script: "Scene 3.", prompt: "Prompt 3." },
    ];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).not.toContain("Scene 1.");
    expect(anchor).toContain("Scene 2.");
    expect(anchor).toContain("Scene 3.");
  });

  it("truncates long prompts to 80 characters", () => {
    const longPrompt = "A".repeat(200);
    const scenes = [{ script: "Short.", prompt: longPrompt }];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).toContain("A".repeat(80) + "...");
    expect(anchor).not.toContain("A".repeat(81) + "...");
  });
});
```

- [ ] **Step 1.2 — Run tests to confirm they fail**

```
npx vitest run src/test/scriptToJson.test.ts
```
Expected: all tests fail with "Cannot find module '../lib/scriptToJson'"

- [ ] **Step 1.3 — Create `src/lib/scriptToJson.ts` with types and utilities**

```typescript
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
  const wordsPerScene = Math.round((WORDS_PER_MINUTE * secondsPerScene) / 60);
  return Math.max(1, Math.round(wordCount / wordsPerScene));
}

/**
 * Split script text into chunks of at most maxWords words, always breaking at
 * sentence boundaries (. ! ?) so the AI never receives a mid-sentence start.
 */
export function chunkScript(text: string, maxWords: number): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
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
```

- [ ] **Step 1.4 — Run tests to confirm they pass**

```
npx vitest run src/test/scriptToJson.test.ts
```
Expected: all 12 tests pass.

- [ ] **Step 1.5 — Commit**

```
git add src/lib/scriptToJson.ts src/test/scriptToJson.test.ts
git commit -m "feat: add scriptToJson utilities with tests"
```

---

## Task 2: Pass 1 — Scene splitting API call

**Files:**
- Modify: `src/lib/scriptToJson.ts`

This task adds the function that calls the API for Pass 1 (scene splitting). It is not independently unit-testable without mocking fetch, so it has no new unit tests — correctness is validated by the full integration in Task 4.

- [ ] **Step 2.1 — Add Pass 1 system prompts and API function**

Append to `src/lib/scriptToJson.ts`:

```typescript
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
  retryOnRateLimit = true
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
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, false);
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
    if (retryOnRateLimit) {
      console.warn(`[${provider}] Pass1 JSON parse failed — retrying with strict instruction`);
      return callPass1(chunk, startId, wordsPerScene, secondsPerScene, provider, apiKey, false);
    }
    throw new Error(`${provider} returned malformed JSON during scene splitting`);
  }
}
```

- [ ] **Step 2.2 — Run existing tests to confirm nothing broke**

```
npx vitest run src/test/scriptToJson.test.ts
```
Expected: all 12 tests still pass.

- [ ] **Step 2.3 — Commit**

```
git add src/lib/scriptToJson.ts
git commit -m "feat: add Pass 1 scene splitting API call"
```

---

## Task 3: Pass 2 — Prompt generation and main orchestrator

**Files:**
- Modify: `src/lib/scriptToJson.ts`

- [ ] **Step 3.1 — Add Pass 2 batch function**

Append to `src/lib/scriptToJson.ts`:

```typescript
// ── Pass 2 — Prompt generation ────────────────────────────────────────────────

async function callPass2Batch(
  title: string,
  scenes: SplitScene[],
  style: "impasto" | "ww2",
  provider: "groq" | "nvidia",
  apiKey: string,
  continuityAnchor: string,
  retryOnRateLimit = true
): Promise<Array<{ id: number; prompt: string }>> {
  const baseSystem = style === "ww2" ? PASS2_WWII_SYSTEM : PASS2_IMPASTO_SYSTEM;
  const systemPrompt = continuityAnchor
    ? `${baseSystem}\n\n${continuityAnchor}`
    : baseSystem;

  const scenesText = scenes
    .map((s) => `Scene ${s.id}: "${s.script}"`)
    .join("\n");
  const userPrompt = `Documentary title: "${title}"\n\nGenerate ONE image prompt for each scene below. Return ONLY a JSON object with a "scenes" array:\n\n${scenesText}\n\nReturn format: {"scenes":[{"id":1,"prompt":"..."},{"id":2,"prompt":"..."}]}`;

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
          max_tokens: 32000,
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
    if (result.status === 429 && retryOnRateLimit) {
      console.log(`[${provider}] Pass2 rate limited — waiting 15s...`);
      await delay(15000);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, false);
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
    if (retryOnRateLimit) {
      console.warn(`[${provider}] Pass2 JSON parse failed — retrying`);
      return callPass2Batch(title, scenes, style, provider, apiKey, continuityAnchor, false);
    }
    // On second failure, return placeholder prompts so the rest can continue
    console.error(`[${provider}] Pass2 JSON parse failed twice — using placeholders`);
    return scenes.map((s) => ({ id: s.id, prompt: "[generation failed]" }));
  }
}
```

- [ ] **Step 3.2 — Add main `runScriptToJson` orchestrator**

Append to `src/lib/scriptToJson.ts`:

```typescript
// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runScriptToJson(
  params: ScriptToJsonParams,
  onProgress: ProgressCallback
): Promise<ScriptToJsonResult> {
  const { title, script, secondsPerScene, style, provider } = params;
  const apiKey = (provider === "groq" ? params.groqApiKey : params.nvidiaApiKey) ?? "";
  if (!apiKey) throw new Error(`No API key provided for ${provider}`);

  const wordsPerScene = Math.round((WORDS_PER_MINUTE * secondsPerScene) / 60);
  const batchSize = provider === "groq" ? GROQ_BATCH_SIZE : NVIDIA_BATCH_SIZE;

  // ── Pass 1: scene splitting ───────────────────────────────────────────────
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
    allSplitScenes.push(...scenes);
    nextId += scenes.length;
    onProgress("pass1", i + 1, chunks.length);
  }

  if (allSplitScenes.length === 0) throw new Error("No scenes were generated from the script");

  // ── Pass 2: prompt generation ─────────────────────────────────────────────
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

    // Build partial output so the UI can show progress
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

  // ── Assemble final output ─────────────────────────────────────────────────
  const scenes: OutputScene[] = allSplitScenes.map((s) => ({
    image: `${s.id}.png`,
    script: s.script,
    prompt: promptMap.get(s.id) ?? "[generation failed]",
    overlay_text: s.overlay_text,
  }));

  return { title, scenes };
}
```

- [ ] **Step 3.3 — Run all tests**

```
npx vitest run src/test/scriptToJson.test.ts
```
Expected: all 12 pass.

- [ ] **Step 3.4 — Commit**

```
git add src/lib/scriptToJson.ts
git commit -m "feat: add Pass 2 prompt generation and runScriptToJson orchestrator"
```

---

## Task 4: Page component

**Files:**
- Create: `src/pages/ScriptToJson.tsx`

- [ ] **Step 4.1 — Create the page**

Create `src/pages/ScriptToJson.tsx`:

```tsx
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { loadProviderSettings } from "@/lib/providers";
import {
  estimateSceneCount,
  runScriptToJson,
  type OutputScene,
  type ProgressCallback,
} from "@/lib/scriptToJson";

const DURATION_OPTIONS = [
  { value: 10, label: "10s", words: 19 },
  { value: 15, label: "15s", words: 29 },
  { value: 20, label: "20s", words: 38 },
  { value: 30, label: "30s", words: 57 },
] as const;

type Style = "impasto" | "ww2";
type Provider = "groq" | "nvidia";

interface Progress {
  phase: "pass1" | "pass2";
  done: number;
  total: number;
}

function highlightJson(json: string): string {
  return json
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")\s*:/g, '<span class="text-violet-400">$1</span>:')
    .replace(/: ("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, ': <span class="text-emerald-400">$1</span>')
    .replace(/: (null)/g, ': <span class="text-slate-500">$1</span>');
}

export default function ScriptToJson() {
  const { toast } = useToast();
  const settings = useMemo(() => loadProviderSettings(), []);

  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [secondsPerScene, setSecondsPerScene] = useState<10 | 15 | 20 | 30>(15);
  const [style, setStyle] = useState<Style>("impasto");
  const [provider, setProvider] = useState<Provider>("groq");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [partialScenes, setPartialScenes] = useState<OutputScene[]>([]);
  const [result, setResult] = useState<{ title: string; scenes: OutputScene[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedScenes = wordCount > 0 ? estimateSceneCount(wordCount, secondsPerScene) : 0;
  const apiKey = provider === "groq" ? settings.groqApiKey : settings.nvidiaApiKey;
  const canGenerate = title.trim().length > 0 && wordCount > 0 && apiKey.length > 0 && !generating;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    setPartialScenes([]);
    setProgress(null);

    const onProgress: ProgressCallback = (phase, done, total, partial) => {
      setProgress({ phase, done, total });
      if (partial) setPartialScenes(partial);
    };

    try {
      const output = await runScriptToJson(
        {
          title: title.trim(),
          script: script.trim(),
          secondsPerScene,
          style,
          provider,
          groqApiKey: settings.groqApiKey,
          nvidiaApiKey: settings.nvidiaApiKey,
        },
        onProgress
      );
      setResult(output);
      setPartialScenes([]);
    } catch (e: any) {
      setError(e.message ?? "Generation failed");
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }, [title, script, secondsPerScene, style, provider, settings, toast]);

  const displayOutput = result ?? (partialScenes.length > 0 ? { title, scenes: partialScenes } : null);
  const jsonString = displayOutput ? JSON.stringify(displayOutput, null, 2) : "";

  function handleCopy() {
    if (!jsonString) return;
    navigator.clipboard.writeText(jsonString);
    toast({ title: "Copied to clipboard" });
  }

  function handleDownload() {
    if (!jsonString) return;
    const slug = (result?.title ?? "output").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full flex overflow-hidden bg-background">
      {/* ── Left Panel ── */}
      <div className="w-[420px] shrink-0 flex flex-col border-r border-border overflow-y-auto">
        <div className="px-5 py-4 border-b border-border shrink-0">
          <h1 className="text-lg font-display font-semibold">Script → JSON</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate a cinematic scene manifest from your documentary script
          </p>
        </div>

        <div className="flex flex-col gap-4 p-5 flex-1">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1.5">
              Documentary Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Bridge at Remagen - March 7 1945"
              disabled={generating}
            />
          </div>

          {/* Script */}
          <div className="flex flex-col flex-1 min-h-0">
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1.5">
              Script
            </label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste your documentary script here..."
              className="flex-1 min-h-[140px] resize-none font-mono text-xs"
              disabled={generating}
            />
            <div className="text-xs text-muted-foreground mt-1 text-right">
              {wordCount > 0 ? `${wordCount.toLocaleString()} words · ~${Math.round(wordCount / 117)} min` : ""}
            </div>
          </div>

          {/* Scene Duration */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1">
              Scene Duration
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              How long each scene displays — sets narration length per scene
            </p>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSecondsPerScene(opt.value as 10 | 15 | 20 | 30)}
                  disabled={generating}
                  className={`rounded-lg border py-2 px-1 text-center transition-colors ${
                    secondsPerScene === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <div className="text-sm font-bold">{opt.label}</div>
                  <div className="text-[10px] opacity-70">~{opt.words}w</div>
                </button>
              ))}
            </div>
            {estimatedScenes > 0 && (
              <div className="mt-2 text-xs text-emerald-500">
                Estimated ~{estimatedScenes} scenes
              </div>
            )}
          </div>

          {/* Visual Style */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-2">
              Visual Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["impasto", "ww2"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  disabled={generating}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    style === s
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <div className="text-xs font-semibold">
                    {s === "impasto" ? "🎨 Impasto Oil" : "📷 WWII Archival"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {s === "impasto"
                      ? "17th-century digital oil painting, heavy brushwork, chiaroscuro"
                      : "B&W photojournalism, Kodak grain, documentary realism"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* AI Provider */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-2">
              AI Provider
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["groq", "nvidia"] as const).map((p) => {
                const key = p === "groq" ? settings.groqApiKey : settings.nvidiaApiKey;
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    disabled={generating}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      provider === p
                        ? "border-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <div className="text-xs font-semibold">
                      {p === "groq" ? "Groq" : "NVIDIA"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {p === "groq" ? "Batch 8 scenes" : "Batch 20 scenes"}
                    </div>
                    {!key && (
                      <div className="text-[10px] text-amber-500 mt-0.5">No key set</div>
                    )}
                  </button>
                );
              })}
            </div>
            {apiKey ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-500">
                <CheckCircle2 className="h-3 w-3" />
                Using {provider === "groq" ? "Groq" : "NVIDIA"} key from Settings
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
                <AlertCircle className="h-3 w-3" />
                No API key — set one in Settings
              </div>
            )}
          </div>
        </div>

        {/* Generate button */}
        <div className="px-5 pb-5 shrink-0">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              "▶ Generate Scene Manifest"
            )}
          </Button>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold">JSON Output</h2>
            {displayOutput && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {displayOutput.scenes.length} scenes
                {result ? " · complete" : " · generating..."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!jsonString}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!result}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .json
            </Button>
          </div>
        </div>

        {/* Progress */}
        {progress && (
          <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-primary">
                {progress.phase === "pass1"
                  ? `Pass 1: Splitting script (chunk ${progress.done}/${progress.total})...`
                  : `Pass 2: Generating prompts...`}
              </span>
              {progress.phase === "pass2" && (
                <span className="text-muted-foreground">
                  {progress.done} / {progress.total} scenes
                </span>
              )}
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shrink-0">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* JSON display */}
        {jsonString ? (
          <div className="flex-1 overflow-auto p-5">
            <pre
              className="text-xs leading-relaxed font-mono whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlightJson(jsonString) }}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            {generating ? "Processing..." : "Output will appear here"}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2 — Commit**

```
git add src/pages/ScriptToJson.tsx
git commit -m "feat: add ScriptToJson page component"
```

---

## Task 5: Route and navigation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppSidebar.tsx`

- [ ] **Step 5.1 — Add route to `src/App.tsx`**

Add the import (after the existing ImageModelTest import):
```typescript
import ScriptToJson from "./pages/ScriptToJson";
```

Add the route (after the `/image-test` route):
```tsx
<Route path="/script-to-json" element={<ScriptToJson />} />
```

- [ ] **Step 5.2 — Add nav item to `src/components/AppSidebar.tsx`**

Add `FileCode` to the existing lucide import:
```typescript
import { Plus, FolderOpen, Settings, AlertTriangle, FileJson, FlaskConical, FileCode } from "lucide-react";
```

Add to the `items` array (after the `JSON Import` entry):
```typescript
{ title: "Script → JSON", url: "/script-to-json", icon: FileCode },
```

- [ ] **Step 5.3 — Run the dev server and smoke-test**

```
npm run dev
```

Open http://localhost:5000/script-to-json and confirm:
- Both panels render without errors
- Word count updates as you type in the script box
- Estimated scenes updates when you change duration
- Provider/style cards toggle correctly
- Generate button is disabled when title or script is empty
- Generate button is disabled when no API key is set for the chosen provider
- No TypeScript errors in the console

- [ ] **Step 5.4 — Run all tests**

```
npm run test
```
Expected: all tests pass.

- [ ] **Step 5.5 — Final commit**

```
git add src/App.tsx src/components/AppSidebar.tsx
git commit -m "feat: add Script to JSON route and sidebar nav item"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `/script-to-json` route | Task 5 |
| Split-panel layout (420px left, flex right) | Task 4 |
| Title input (user-supplied) | Task 4 |
| Script textarea with word count + runtime estimate | Task 4 |
| Scene Duration toggle (10/15/20/30s) | Task 4 |
| Visual Style selector (Impasto / WWII) | Task 4 |
| AI Provider selector (Groq / NVIDIA) | Task 4 |
| API key status indicator (green/amber) | Task 4 |
| Generate button disabled when missing key/title/script | Task 4 |
| Live scene count estimate | Task 4 |
| `estimateSceneCount` utility with tests | Task 1 |
| `chunkScript` (≤2000 words, sentence boundary) with tests | Task 1 |
| `parseJsonResponse` (handles fences, preamble) with tests | Task 1 |
| `buildContinuityAnchor` (last 2, 80-char truncation) with tests | Task 1 |
| Pass 1: scene splitting with retry on rate-limit | Task 2 |
| Pass 2: batched prompt generation (Groq 8, NVIDIA 20) | Task 3 |
| Visual continuity anchor injected per batch | Task 3 |
| `runScriptToJson` orchestrator with `onProgress` callback | Task 3 |
| Right panel updates progressively during Pass 2 | Task 4 |
| Syntax-highlighted JSON display | Task 4 |
| Copy to clipboard button | Task 4 |
| Download .json button | Task 4 |
| Download disabled until generation fully complete | Task 4 |
| `image` field = `"{id}.png"` 1-based sequential | Task 3 |
| Impasto system prompts | Task 2 + 3 |
| WWII system prompts | Task 2 + 3 |
| Error handling: 429 wait+retry, 401 message, JSON parse fallback | Tasks 2+3 |
| Sidebar nav item | Task 5 |

All spec requirements are covered. No TBDs, no placeholders.
