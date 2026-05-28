# Script → JSON Page — Design Spec

## Overview

A new page at `/script-to-json` where users paste a documentary script and get back a structured JSON scene manifest. Each scene in the output contains an image filename, the narration text, a cinematic image prompt, and an optional short overlay label.

**Output format:**
```json
{
  "title": "The Bridge at Remagen - March 7 1945",
  "scenes": [
    {
      "image": "1.png",
      "script": "The Rhine River was supposed to end the war.",
      "prompt": "Digital oil painting, heavy impasto. Panoramic establishing shot...",
      "overlay_text": "Rhine 1945"
    }
  ]
}
```

---

## Page Layout — Split Panel

**Route:** `/script-to-json`  
**Nav link:** Added to app navigation alongside JsonToVideo.

### Left Panel — Inputs (fixed width ~420px)

| Control | Details |
|---|---|
| Documentary Title | Text input, user-supplied |
| Script | Large textarea; shows live word count + estimated runtime (words ÷ 117 × 60) |
| Scene Duration | 4-button toggle: 10s / 15s / 20s / 30s. Default: **15s** |
| Visual Style | 2 cards: Impasto Oil / WWII Archival |
| AI Provider | 2 cards: Groq / NVIDIA |
| API key status | Read from localStorage via `getProviderSettings()`. Shows green tick if key present, warning if missing |
| Generate button | Disabled until title + script filled and API key present |
| Live estimate | "Estimated ~N scenes" updates as user types, based on word count ÷ words-per-scene |

**Words-per-scene by duration (at 117 words/min):**
- 10s → 19 words
- 15s → 29 words
- 20s → 38 words
- 30s → 57 words

### Right Panel — Output (flex remaining space)

- **Header:** scene count, Copy button, Download .json button
- **Progress area:** two-line progress (Pass 1 status, Pass 2 progress bar + X/Y count)
- **JSON display:** syntax-highlighted, scrollable, updates progressively as each Pass 2 batch completes
- Copy and Download disabled until generation completes

---

## Pipeline — Approach C (2-pass, batched)

### Pass 1 — Scene Splitting

Goal: split the script into scenes of ~N words (based on chosen duration). No image prompts yet.

**Input chunking:** Script is split into chunks of ≤2000 words at sentence boundaries before calling the API. Each chunk is processed sequentially, with scene IDs continuing from the previous chunk's last ID.

**API call:** `groq-chat` or `nvidia-chat` via existing `/api/gemini-proxy`.

**System prompt for Pass 1:**
```
You are a documentary scene director. Split the provided script excerpt into visual scenes.

SPLITTING RULES:
- Target ~{wordsPerScene} words per scene ({duration}s at documentary pace)
- Split at: visual transitions, narrative beats, emotional shifts, location/time changes
- Each scene = one distinct visual idea. Never split mid-sentence.
- Continue numbering from scene {startId}

OVERLAY TEXT RULES:
- 3 words or fewer
- Plain letters, numbers, spaces, hyphens only — no colons, commas, or dashes
- K/M shorthand for large numbers (25K, 3M)
- Ranges use hyphen: 3M-5M
- If nothing meaningful, set to null
- Examples: "Rhine 1945", "Last Barrier", "Army 25K"

Output ONLY valid JSON, no markdown:
{"scenes":[{"id":1,"script":"narration","overlay_text":"Rhine 1945"},{"id":2,"script":"narration","overlay_text":null}]}
```

**Output:** flat list of `{id, script, overlay_text}` objects merged across all chunks.

**`image` field:** assigned during final assembly as `"{id}.png"` (1-based, e.g. `"1.png"`, `"2.png"`). IDs are sequential across the entire script, not per-chunk.

---

### Pass 2 — Prompt Generation

Goal: generate a cinematic image prompt for each scene, in batches, with a visual continuity anchor.

**Batch sizes:**
- Groq: 8 scenes per batch
- NVIDIA: 20 scenes per batch

**Continuity anchor:** each batch receives the last 2 complete `{script, prompt}` pairs from the previous batch injected into the system prompt. This keeps visual style and composition consistent without sending the full prompt history.

**System prompt for Pass 2 — Impasto Oil style:**
```
You are the Lead Creative Director for a high-end historical documentary series.

GLOBAL STYLE BIBLE:
- Style: Digital oil painting, heavy Impasto texture
- Lighting: Dramatic Chiaroscuro — deep shadows, bright focal highlights on faces/armor/weapons
- Texture: Visible brushstrokes throughout smoke, water, sky
- Palette: Muted earth tones, cold desaturated blues, gray-green shadows, amber highlights
- Composition: Cinematic 16:9, wide-angle historical framing
- Atmosphere: Black powder smoke as recurring element

IMAGE TYPE DISTRIBUTION: 70% narrative illustrations (action, portraits, landscapes), 30% tactical maps and infographics.

For NARRATIVE scenes — start with "Digital oil painting, heavy impasto."
For MAP scenes — start with "Tactical Parchment map." Include: aged tea-stained vellum, cartographic style, blue protagonist arrows, red antagonist arrows, calligraphic place names.
For INFOGRAPHIC scenes — start with "Museum Gallery infographic." Include: heraldic iconography, flowchart logic, hybrid vintage-modern typography.

HARD CONSTRAINTS:
- Prompt must directly match the narration — never introduce future events
- No photorealistic textures or clean CGI renders
- 120–250 words per prompt

{CONTINUITY_ANCHOR}

For each scene below, output ONE image prompt. Return ONLY valid JSON array:
[{"id":1,"prompt":"..."},{"id":2,"prompt":"..."}]
```

**System prompt for Pass 2 — WWII Archival style:**
```
You are the Lead Creative Director for a WWII/WWI historical documentary series.

GLOBAL STYLE BIBLE:
- Style: Cinematic WWII archival photorealism — black-and-white war photojournalism
- Film: Kodak Tri-X grain, imperfect exposure, shallow depth of field
- Lighting: Dramatic chiaroscuro, deep shadows, directional light cutting through smoke/dust/rain
- Characters: Exhausted, dirty, emotionally strained — realistic imperfections
- Uniforms/vehicles: Worn, muddy, battle-damaged, historically accurate
- Composition: Asymmetrical, handheld feel, foreground obstruction, smoke framing

IMAGE TYPE DISTRIBUTION: 70% narrative imagery, 30% tactical maps and infographics.

For NARRATIVE scenes — start with "Cinematic WWII archival photograph, black-and-white war photojournalism style."
For MAP scenes — start with "WWII tactical parchment map." Include: aged paper, grease-pencil markings, muted blue Allied arrows, muted red Axis arrows, typewriter labels.
For INFOGRAPHIC scenes — start with "Museum archive infographic." Include: old dossier paper, faded diagrams, archival stamps, wartime stencil fonts.

HARD CONSTRAINTS:
- Prompt must directly match the narration — never introduce future events
- No CGI, no modern gear, no bright colors, no clean battlefields
- 120–250 words per prompt

{CONTINUITY_ANCHOR}

For each scene below, output ONE image prompt. Return ONLY valid JSON array:
[{"id":1,"prompt":"..."},{"id":2,"prompt":"..."}]
```

**Continuity anchor format:**
```
PREVIOUS SCENES FOR VISUAL CONTINUITY (maintain consistent style and atmosphere):
Scene {n-1}: "{script}" → "{prompt excerpt, first 80 chars}..."
Scene {n}: "{script}" → "{prompt excerpt, first 80 chars}..."
```

---

## Data Flow

```
User input
  │
  ├─ Pass 1: chunk script (≤2000 words each)
  │    └─ API call per chunk → {id, script, overlay_text}[]
  │    └─ Merge all chunks → scenes[]
  │
  └─ Pass 2: batch scenes
       └─ For each batch:
            ├─ Inject style bible + continuity anchor
            ├─ API call → {id, prompt}[]
            ├─ Merge prompts into scenes[]
            └─ Update right panel JSON display
  │
  └─ Final JSON assembled:
       {title, scenes: [{image, script, prompt, overlay_text}]}
```

---

## JSON Response Parsing

API responses may include markdown code fences. Parser must:
1. Extract content between ` ```json ` ... ` ``` ` if present, otherwise use raw text
2. `JSON.parse()` the result
3. On failure: retry the batch once with an explicit "output only raw JSON, no markdown" instruction
4. On second failure: mark affected scenes with `prompt: "[generation failed]"` and continue

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Missing API key | Generate button disabled; warning shown in key status area |
| API 429 (rate limit) | Wait 15s, retry once; if still 429, show error toast and stop |
| API 401 | Show "Invalid API key — update in Settings" toast, stop |
| JSON parse failure | Retry batch once; on second failure, fill scenes with `"[generation failed]"` placeholder and continue |
| Network error | Show toast, stop generation; allow user to re-click Generate (restarts from scratch) |

---

## Files

| File | Action |
|---|---|
| `src/pages/ScriptToJson.tsx` | New page component (UI only — calls lib functions) |
| `src/lib/scriptToJson.ts` | New — all pipeline logic: chunking, Pass 1, Pass 2, JSON assembly |
| `src/App.tsx` | Add route `/script-to-json` |
| `src/components/AppLayout.tsx` | Add nav link |

`scriptToJson.ts` exports:
- `estimateSceneCount(wordCount: number, secondsPerScene: number): number`
- `runScriptToJson(params: ScriptToJsonParams, onProgress: ProgressCallback): Promise<ScriptToJsonResult>`

`ScriptToJsonParams`: `{ title, script, secondsPerScene, style, provider, groqApiKey?, nvidiaApiKey? }`  
`ProgressCallback`: `(phase: "pass1" | "pass2", done: number, total: number, partialScenes?: Scene[]) => void`

---

## Out of Scope

- Claude as a provider on this page
- Streaming token-by-token output
- Editing scenes after generation
- Connecting output directly to JsonToVideo page (user copies/downloads)
