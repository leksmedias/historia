# Gemini Web API Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google Whisk (Imagen 3.5 image gen + Veo video animation) with a Python `gemini_webapi` FastAPI sidecar, keeping the same pipeline interfaces and adding one-click setup.

**Architecture:** A Python FastAPI sidecar (`gemini-service/`) exposes `/generate-image` and `/generate-video` endpoints. Node.js routes (`gemini-proxy.ts`, `gemini.ts`) call the sidecar in place of all Whisk calls. The frontend Settings page swaps the single `whiskCookie` field for two Gemini cookie fields (`geminiPsid`, `geminiPsidts`).

**Tech Stack:** Python 3.10+, FastAPI, uvicorn, gemini_webapi; Node.js/TypeScript, Express 5; concurrently (new devDep); Vitest (existing test runner).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `gemini-service/main.py` | FastAPI sidecar — image + video endpoints |
| CREATE | `gemini-service/requirements.txt` | Python deps |
| CREATE | `gemini-service/install.sh` | Standalone VPS setup script |
| CREATE | `gemini-service/tests/test_main.py` | pytest tests for sidecar endpoints |
| CREATE | `server/lib/gemini.ts` | Node.js helpers — calls sidecar |
| CREATE | `server/routes/gemini-proxy.ts` | Express route — replaces whisk-proxy.ts |
| DELETE | `server/lib/whisk.ts` | Removed |
| DELETE | `server/routes/whisk-proxy.ts` | Removed |
| MODIFY | `server/index.ts` | Swap whisk-proxy import for gemini-proxy |
| MODIFY | `server/routes/render.ts` | Swap whisk import, update headers |
| MODIFY | `src/lib/providers.ts` | New Gemini functions + settings fields |
| MODIFY | `src/lib/api.ts` | Rename whisk→gemini references |
| MODIFY | `src/pages/Settings.tsx` | New cookie fields UI |
| MODIFY | `package.json` | Add concurrently, new scripts |
| MODIFY | `README.md` | Updated setup + Gemini cookie docs |

---

## Task 1: Python sidecar scaffold

**Files:**
- Create: `gemini-service/requirements.txt`
- Create: `gemini-service/install.sh`
- Create: `gemini-service/tests/__init__.py`

- [ ] **Step 1: Create requirements.txt**

```
gemini_webapi>=1.0.0
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
httpx>=0.27.0
pytest>=8.0.0
pytest-asyncio>=0.24.0
httpx>=0.27.0
```

Save to `gemini-service/requirements.txt`.

- [ ] **Step 2: Create install.sh**

```bash
#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv venv
fi

echo "Installing Python dependencies..."
venv/bin/pip install --quiet --upgrade pip
venv/bin/pip install --quiet -r requirements.txt
echo "Gemini service dependencies installed."
```

Save to `gemini-service/install.sh`, then run:

```bash
chmod +x gemini-service/install.sh
```

- [ ] **Step 3: Create tests package**

Create `gemini-service/tests/__init__.py` as an empty file.

- [ ] **Step 4: Commit**

```bash
git add gemini-service/requirements.txt gemini-service/install.sh gemini-service/tests/__init__.py
git commit -m "feat: add gemini-service scaffold (requirements, install script)"
```

---

## Task 2: Python sidecar — `/generate-image` endpoint

**Files:**
- Create: `gemini-service/main.py`
- Create: `gemini-service/tests/test_main.py`

- [ ] **Step 1: Write the failing test**

Create `gemini-service/tests/test_main.py`:

```python
import base64
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def mock_image_bytes():
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest.mark.asyncio
async def test_generate_image_returns_base64(mock_image_bytes):
    mock_image = AsyncMock()
    mock_image.save = AsyncMock(side_effect=lambda path, filename: open(f"{path}/{filename}", "wb").write(mock_image_bytes))

    mock_response = MagicMock()
    mock_response.images = [mock_image]

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", return_value=mock_client):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-image", json={
                "prompt": "A medieval castle at sunset",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 200
    data = r.json()
    assert "image_base64" in data
    decoded = base64.b64decode(data["image_base64"])
    assert decoded == mock_image_bytes


@pytest.mark.asyncio
async def test_generate_image_no_images_returns_500():
    mock_response = MagicMock()
    mock_response.images = []

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", return_value=mock_client):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-image", json={
                "prompt": "A scene",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 500
    assert "No images" in r.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd gemini-service && venv/bin/pytest tests/test_main.py -v 2>&1 | head -20
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 3: Implement main.py**

Create `gemini-service/main.py`:

```python
import base64
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from gemini_webapi import GeminiClient

_cached_client: Optional[GeminiClient] = None
_cached_psid: Optional[str] = None


async def get_client(psid: str, psidts: str) -> GeminiClient:
    global _cached_client, _cached_psid
    if _cached_client is None or _cached_psid != psid:
        client = GeminiClient(psid, psidts, proxy=None)
        cookie_path = os.environ.get("GEMINI_COOKIE_PATH", None)
        await client.init(timeout=30, auto_close=False, auto_refresh=True)
        _cached_client = client
        _cached_psid = psid
    return _cached_client


class ImageRequest(BaseModel):
    prompt: str
    psid: str
    psidts: str


class VideoRequest(BaseModel):
    prompt: str
    image_path: str
    psid: str
    psidts: str


app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/generate-image")
async def generate_image(req: ImageRequest):
    try:
        client = await get_client(req.psid, req.psidts)
        response = await client.generate_content(f"Generate an image: {req.prompt}")
        images = list(response.images)
        if not images:
            raise HTTPException(status_code=500, detail="No images in Gemini response")
        with tempfile.TemporaryDirectory() as tmpdir:
            await images[0].save(path=tmpdir, filename="output.png")
            img_bytes = (Path(tmpdir) / "output.png").read_bytes()
        return {"image_base64": base64.b64encode(img_bytes).decode()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-video")
async def generate_video(req: VideoRequest):
    try:
        image_path = Path(req.image_path)
        if not image_path.exists():
            raise HTTPException(status_code=400, detail=f"Image not found: {req.image_path}")
        client = await get_client(req.psid, req.psidts)
        response = await client.generate_content(
            f"Generate a short cinematic video: {req.prompt}",
            files=[str(image_path)],
        )
        videos = list(response.videos)
        if not videos:
            raise HTTPException(status_code=500, detail="No video in Gemini response")
        with tempfile.TemporaryDirectory() as tmpdir:
            await videos[0].save(path=tmpdir, filename="output.mp4")
            vid_bytes = (Path(tmpdir) / "output.mp4").read_bytes()
        return {"video_base64": base64.b64encode(vid_bytes).decode()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd gemini-service && venv/bin/pytest tests/test_main.py::test_generate_image_returns_base64 tests/test_main.py::test_generate_image_no_images_returns_500 -v
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add gemini-service/main.py gemini-service/tests/test_main.py
git commit -m "feat: add gemini sidecar with /generate-image endpoint"
```

---

## Task 3: Python sidecar — `/generate-video` endpoint tests

**Files:**
- Modify: `gemini-service/tests/test_main.py`

- [ ] **Step 1: Add video tests**

Append to `gemini-service/tests/test_main.py`:

```python
import os


@pytest.mark.asyncio
async def test_generate_video_returns_base64(tmp_path, mock_image_bytes):
    # Create a fake image file the sidecar can find
    fake_image = tmp_path / "1.png"
    fake_image.write_bytes(mock_image_bytes)

    fake_video_bytes = b"\x00\x00\x00\x18ftyp" + b"\x00" * 100

    mock_video = AsyncMock()

    async def save_video(path, filename):
        (Path(path) / filename).write_bytes(fake_video_bytes)

    mock_video.save = save_video

    mock_response = MagicMock()
    mock_response.videos = [mock_video]

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", return_value=mock_client):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-video", json={
                "prompt": "Camera slowly pans left",
                "image_path": str(fake_image),
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 200
    data = r.json()
    assert "video_base64" in data
    assert base64.b64decode(data["video_base64"]) == fake_video_bytes


@pytest.mark.asyncio
async def test_generate_video_missing_image_returns_400():
    with patch("main.get_client", return_value=AsyncMock()):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-video", json={
                "prompt": "Camera pan",
                "image_path": "/nonexistent/path/1.png",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 400
    assert "not found" in r.json()["detail"].lower()
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd gemini-service && venv/bin/pytest tests/test_main.py -v
```

Expected: `4 passed`

- [ ] **Step 3: Commit**

```bash
git add gemini-service/tests/test_main.py
git commit -m "test: add /generate-video sidecar tests"
```

---

## Task 4: Node.js `server/lib/gemini.ts`

**Files:**
- Create: `server/lib/gemini.ts`

This replaces `server/lib/whisk.ts`. It exposes `generateGeminiImage` and `animateGeminiVideo` which call the Python sidecar.

- [ ] **Step 1: Create server/lib/gemini.ts**

```typescript
import path from "path";

const GEMINI_SERVICE_URL = (process.env.GEMINI_SERVICE_URL || "http://localhost:3060").replace(/\/$/, "");

export async function generateGeminiImage(
  prompt: string,
  psid: string,
  psidts: string
): Promise<string> {
  const res = await fetch(`${GEMINI_SERVICE_URL}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, psid, psidts }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`Gemini image failed: ${(err as any).detail}`);
  }
  const data = await res.json() as { image_base64: string };
  return data.image_base64;
}

export async function animateGeminiVideo(
  imagePath: string,
  psid: string,
  psidts: string,
  prompt: string
): Promise<Buffer> {
  const absPath = path.isAbsolute(imagePath) ? imagePath : path.resolve(imagePath);
  const res = await fetch(`${GEMINI_SERVICE_URL}/generate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_path: absPath, psid, psidts }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(`Gemini video failed: ${(err as any).detail}`);
  }
  const data = await res.json() as { video_base64: string };
  return Buffer.from(data.video_base64, "base64");
}

export function getStyleImagePaths(projectId: string): string[] {
  return [
    path.join("uploads", projectId, "style", "style1.png"),
    path.join("uploads", projectId, "style", "style2.png"),
  ];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (or only pre-existing errors unrelated to gemini.ts).

- [ ] **Step 3: Commit**

```bash
git add server/lib/gemini.ts
git commit -m "feat: add server/lib/gemini.ts to call Gemini sidecar"
```

---

## Task 5: Node.js `server/routes/gemini-proxy.ts`

**Files:**
- Create: `server/routes/gemini-proxy.ts`

This replaces `server/routes/whisk-proxy.ts`. Keeps `groq-chat` and `claude-chat` actions unchanged. Replaces `generate` and `session` actions.

- [ ] **Step 1: Create server/routes/gemini-proxy.ts**

```typescript
import { Router, Request, Response } from "express";
import { generateGeminiImage } from "../lib/gemini.js";

const router = Router();
const GEMINI_SERVICE_URL = (process.env.GEMINI_SERVICE_URL || "http://localhost:3060").replace(/\/$/, "");

router.post("/", async (req: Request, res: Response) => {
  try {
    const { action, payload, apiKey, psid, psidts } = req.body;

    if (action === "generate") {
      const promptText: string = payload?.userInput?.prompts?.[0] || payload?.prompt || "";
      if (!promptText) return res.json({ status: 400, data: { error: "prompt required" } });
      if (!psid) return res.json({ status: 400, data: { error: "psid required" } });

      try {
        const imageBase64 = await generateGeminiImage(promptText, psid, psidts || "");
        return res.json({
          status: 200,
          data: { imagePanels: [{ generatedImages: [{ encodedImage: imageBase64 }] }] },
        });
      } catch (e: any) {
        console.error("[gemini-proxy] generate error:", e.message);
        const status = e.message?.includes("401") || e.message?.includes("403") ? 401
          : e.message?.includes("429") ? 429 : 500;
        return res.json({ status, data: { error: e.message } });
      }
    }

    if (action === "session") {
      try {
        const healthRes = await fetch(`${GEMINI_SERVICE_URL}/health`);
        if (healthRes.ok) return res.json({ status: 200, data: { authenticated: true } });
        return res.status(503).json({ error: "Gemini service unreachable" });
      } catch {
        return res.status(503).json({ error: "Gemini service unreachable" });
      }
    }

    if (action === "groq-chat") {
      const key = apiKey || process.env.GROQ_API_KEY;
      if (!key) return res.json({ status: 500, data: { error: "GROQ_API_KEY not configured" } });
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
      return res.json({ status: r.status, data });
    }

    if (action === "claude-chat") {
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) return res.json({ status: 500, data: { error: "ANTHROPIC_API_KEY not configured" } });
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
      return res.json({ status: r.status, data });
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/gemini-proxy.ts
git commit -m "feat: add server/routes/gemini-proxy.ts (replaces whisk-proxy)"
```

---

## Task 6: Update `server/index.ts`

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Swap the import and route mount**

In `server/index.ts`, replace:

```typescript
import whiskProxyRouter from "./routes/whisk-proxy.js";
```

with:

```typescript
import geminiProxyRouter from "./routes/gemini-proxy.js";
```

And replace:

```typescript
app.use("/api/whisk-proxy", whiskProxyRouter);
```

with:

```typescript
app.use("/api/gemini-proxy", geminiProxyRouter);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors from server/index.ts.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount gemini-proxy route, unmount whisk-proxy"
```

---

## Task 7: Update `server/routes/render.ts`

**Files:**
- Modify: `server/routes/render.ts`

Replace the `animateWhiskImage` import and all usages with `animateGeminiVideo`. Update the `x-whisk-cookie` header to two new headers and the auto pipeline cookie passing.

- [ ] **Step 1: Update the import (line 10)**

Replace:

```typescript
import { animateWhiskImage } from "../lib/whisk.js";
```

with:

```typescript
import { animateGeminiVideo } from "../lib/gemini.js";
```

- [ ] **Step 2: Update the animate route (around line 349-366)**

Replace:

```typescript
router.post("/:id/animate", async (req: Request, res: Response) => {
  const projectId = (req.params.id as string);
  const cookie = req.headers["x-whisk-cookie"] as string;
  if (!cookie) return res.status(400).json({ error: "Whisk cookie required (x-whisk-cookie header)" });
```

with:

```typescript
router.post("/:id/animate", async (req: Request, res: Response) => {
  const projectId = (req.params.id as string);
  const psid = req.headers["x-gemini-psid"] as string;
  const psidts = (req.headers["x-gemini-psidts"] as string) || "";
  if (!psid) return res.status(400).json({ error: "Gemini cookies required (x-gemini-psid header)" });
```

Then replace the `animateScenes(projectId, sceneNums, allScenes, cookie)` call on ~line 364 with:

```typescript
  animateScenes(projectId, sceneNums, allScenes, psid, psidts).catch(e => {
```

- [ ] **Step 3: Update the auto pipeline route (around line 437-445)**

Replace:

```typescript
  const whiskCookie: string | undefined = req.body?.whiskCookie || undefined;
  res.json({ success: true, message: "Auto pipeline started in background" });
  runAutoPipeline(projectId, resKey, whiskCookie).catch(e => {
```

with:

```typescript
  const geminiPsid: string | undefined = req.body?.geminiPsid || undefined;
  const geminiPsidts: string | undefined = req.body?.geminiPsidts || undefined;
  res.json({ success: true, message: "Auto pipeline started in background" });
  runAutoPipeline(projectId, resKey, geminiPsid, geminiPsidts).catch(e => {
```

- [ ] **Step 4: Update `runAutoPipeline` signature (around line 732)**

Replace:

```typescript
async function runAutoPipeline(projectId: string, resKey: "480p" | "720p", whiskCookie?: string) {
```

with:

```typescript
async function runAutoPipeline(projectId: string, resKey: "480p" | "720p", geminiPsid?: string, geminiPsidts?: string) {
```

Replace (around line 764-769):

```typescript
  if (whiskCookie) {
    console.log(`[auto] ${projectId}: animating ${ready.length} scenes with Veo`);
    autoJobs[projectId] = { ...autoJobs[projectId], status: "animating" as any };
    animateJobs[projectId] = { status: "animating", progress: 0, done: 0, total: ready.length, sceneErrors: {} };
    const sceneNums = ready.map(s => s.scene_number);
    await animateScenes(projectId, sceneNums, ready, whiskCookie).catch(e => {
```

with:

```typescript
  if (geminiPsid) {
    console.log(`[auto] ${projectId}: animating ${ready.length} scenes with Gemini`);
    autoJobs[projectId] = { ...autoJobs[projectId], status: "animating" as any };
    animateJobs[projectId] = { status: "animating", progress: 0, done: 0, total: ready.length, sceneErrors: {} };
    const sceneNums = ready.map(s => s.scene_number);
    await animateScenes(projectId, sceneNums, ready, geminiPsid, geminiPsidts || "").catch(e => {
```

- [ ] **Step 5: Update `animateScenes` function (around line 788)**

Replace:

```typescript
async function animateScenes(
  projectId: string,
  sceneNumbers: number[],
  sceneList: any[],
  cookie: string
) {
```

with:

```typescript
async function animateScenes(
  projectId: string,
  sceneNumbers: number[],
  sceneList: any[],
  psid: string,
  psidts: string
) {
```

Replace the inner call on ~line 808:

```typescript
      const buf = await animateWhiskImage(img, cookie, s.image_prompt || "");
```

with:

```typescript
      const buf = await animateGeminiVideo(img, psid, psidts, s.image_prompt || "");
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors from render.ts.

- [ ] **Step 7: Commit**

```bash
git add server/routes/render.ts
git commit -m "feat: update render.ts to use animateGeminiVideo"
```

---

## Task 8: Update `src/lib/providers.ts`

**Files:**
- Modify: `src/lib/providers.ts`

- [ ] **Step 1: Update ProviderSettings interface (lines 12-25)**

Replace:

```typescript
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
```

with:

```typescript
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
  geminiPsid: string;
  geminiPsidts: string;
  inworldApiKey: string;
  customVoices: CustomVoice[];
}
```

- [ ] **Step 2: Update DEFAULTS (lines 61-74)**

Replace:

```typescript
const DEFAULTS: ProviderSettings = {
  imageProvider: "ai",
  ttsProvider: "inworld",
  voiceId: "Dennis",
  modelId: "inworld-tts-1.5-max",
  imageConcurrency: 2,
  audioConcurrency: 2,
  groqApiKey: "",
  anthropicApiKey: "",
  claudeModel: "claude-haiku-4-5-20251001",
  whiskCookie: "",
  inworldApiKey: "",
  customVoices: [],
};
```

with:

```typescript
const DEFAULTS: ProviderSettings = {
  imageProvider: "gemini",
  ttsProvider: "inworld",
  voiceId: "Dennis",
  modelId: "inworld-tts-1.5-max",
  imageConcurrency: 2,
  audioConcurrency: 2,
  groqApiKey: "",
  anthropicApiKey: "",
  claudeModel: "claude-haiku-4-5-20251001",
  geminiPsid: "",
  geminiPsidts: "",
  inworldApiKey: "",
  customVoices: [],
};
```

- [ ] **Step 3: Replace the Whisk section (lines 561-684)**

Remove the entire `// Whisk — Image generation` section (lines 561–684) and replace it with:

```typescript
// ========================
// Gemini — Image generation
// ========================

async function geminiProxy(body: any): Promise<any> {
  const res = await fetch(`/api/gemini-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini proxy error (HTTP ${res.status}): ${errText.substring(0, 200)}`);
  }
  return res.json();
}

export async function generateGeminiImage(
  prompt: string,
  psid: string,
  psidts: string
): Promise<Blob> {
  const genResult = await geminiProxy({
    action: "generate",
    psid,
    psidts,
    payload: {
      userInput: { candidatesCount: 1, prompts: [prompt] },
    },
  });

  if (genResult.status && genResult.status >= 400) {
    const detail = JSON.stringify(genResult.data || genResult).substring(0, 300);
    console.error(`Gemini generate error ${genResult.status}:`, detail);
    if (genResult.status === 429) throw new Error("Gemini rate limited — wait a minute and try again.");
    if (genResult.status === 401 || genResult.status === 403) throw new Error("Gemini auth expired. Update your Gemini cookies in Settings.");
    throw new Error(`Gemini failed (${genResult.status}): ${detail}`);
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
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in files that still reference `whiskCookie` or `generateWhiskImage` (fixed in next tasks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers.ts
git commit -m "feat: replace whisk functions with gemini in providers.ts"
```

---

## Task 9: Update `src/lib/api.ts`

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Update the import**

Replace:

```typescript
  generateWhiskImage,
```

with:

```typescript
  generateGeminiImage,
```

- [ ] **Step 2: Update the client-side pipeline (around line 227-257)**

Replace every block matching this pattern (there are 3 of them — lines ~227-252, ~373-399, ~734-760):

```typescript
        if (settings.imageProvider === "whisk") {
          if (!settings.whiskCookie) throw new Error("Whisk cookie not configured. Add it in Settings.");
```

with:

```typescript
        if (settings.imageProvider === "gemini" || settings.imageProvider === "whisk") {
          if (!settings.geminiPsid) throw new Error("Gemini cookies not configured. Add them in Settings.");
```

Replace all occurrences of:

```typescript
imageBlob = await generateWhiskImage(
              prompt, settings.whiskCookie,
```

with:

```typescript
imageBlob = await generateGeminiImage(
              prompt, settings.geminiPsid,
              settings.geminiPsidts,
```

> Note: `generateGeminiImage` takes `(prompt, psid, psidts)` — 3 args. Remove the old 4th arg (`styleImageUrls`) if present.

Replace all occurrences of:

```typescript
              lastWhiskError = e.message;
              console.error(`Whisk prompt failed: ${e.message}`);
```

with:

```typescript
              lastWhiskError = e.message;
              console.error(`Gemini prompt failed: ${e.message}`);
```

Replace all occurrences of:

```typescript
          if (!success) throw new Error(lastWhiskError);
        } else {
          throw new Error("No image provider configured. Please set up Whisk in Settings.");
        }
        const ext = settings.imageProvider === "whisk" ? "png" : "svg";
```

with:

```typescript
          if (!success) throw new Error(lastWhiskError);
        } else {
          throw new Error("No image provider configured. Please set up Gemini in Settings.");
        }
        const ext = "png";
```

- [ ] **Step 3: Update startAnimateScenes (around line 655-674)**

Replace the function signature and headers:

```typescript
export async function startAnimateScenes(
  projectId: string,
  sceneNumbers: number[],
  whiskCookie: string
): Promise<{ total: number }> {
  return fetch(`${API_BASE}/render/${projectId}/animate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-whisk-cookie": whiskCookie,
    },
```

with:

```typescript
export async function startAnimateScenes(
  projectId: string,
  sceneNumbers: number[],
  geminiPsid: string,
  geminiPsidts: string
): Promise<{ total: number }> {
  return fetch(`${API_BASE}/render/${projectId}/animate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-gemini-psid": geminiPsid,
      "x-gemini-psidts": geminiPsidts,
    },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: errors only in Settings.tsx (fixed next).

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: update api.ts — replace all whisk references with gemini"
```

---

## Task 10: Update `src/pages/Settings.tsx`

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Replace state variables**

Replace:

```typescript
  const [showWhisk, setShowWhisk] = useState(false);
```

with:

```typescript
  const [showGeminiPsid, setShowGeminiPsid] = useState(false);
  const [showGeminiPsidts, setShowGeminiPsidts] = useState(false);
```

Replace:

```typescript
  const [whiskStatus, setWhiskStatus] = useState<HealthStatus>("idle");
  const [whiskMsg, setWhiskMsg] = useState("");
```

with:

```typescript
  const [geminiStatus, setGeminiStatus] = useState<HealthStatus>("idle");
  const [geminiMsg, setGeminiMsg] = useState("");
```

- [ ] **Step 2: Replace testWhisk with testGemini**

Replace the entire `testWhisk` function (lines 67-85):

```typescript
  const testWhisk = async () => {
    if (!settings.whiskCookie) { setWhiskStatus("error"); setWhiskMsg("No cookie provided"); return; }
    setWhiskStatus("checking"); setWhiskMsg("");
    try {
      const res = await fetch(`/api/whisk-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session", cookie: settings.whiskCookie }),
      });
      if (!res.ok) { setWhiskStatus("error"); setWhiskMsg(`Proxy error: HTTP ${res.status}`); return; }
      const result = await res.json();
      if (result.status === 401 || result.status === 403) { setWhiskStatus("error"); setWhiskMsg("Cookie expired or invalid"); return; }
      if (result.status && result.status >= 400) { setWhiskStatus("error"); setWhiskMsg(`HTTP ${result.status}`); return; }
      if (!result.data?.access_token) { setWhiskStatus("error"); setWhiskMsg("No access token — cookie may be expired"); return; }
      setWhiskStatus("ok");
    } catch (e: any) {
      setWhiskStatus("error"); setWhiskMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };
```

with:

```typescript
  const testGemini = async () => {
    if (!settings.geminiPsid) { setGeminiStatus("error"); setGeminiMsg("No __Secure-1PSID provided"); return; }
    setGeminiStatus("checking"); setGeminiMsg("");
    try {
      const res = await fetch(`/api/gemini-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session" }),
      });
      if (!res.ok) { setGeminiStatus("error"); setGeminiMsg(`Proxy error: HTTP ${res.status}`); return; }
      const result = await res.json();
      if (result.status && result.status >= 400) { setGeminiStatus("error"); setGeminiMsg(`HTTP ${result.status}`); return; }
      setGeminiStatus("ok");
    } catch (e: any) {
      setGeminiStatus("error"); setGeminiMsg(e.message?.includes("fetch") ? "Network error" : e.message);
    }
  };
```

- [ ] **Step 3: Update testAll**

Replace:

```typescript
  const testAll = () => { testGroq(); testWhisk(); testInworld(); testRenderApi(); };
```

with:

```typescript
  const testAll = () => { testGroq(); testGemini(); testInworld(); testRenderApi(); };
```

- [ ] **Step 4: Replace the Whisk UI block**

In the JSX, replace the entire Whisk card section:

```tsx
              {/* Whisk */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Whisk Cookie</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={whiskStatus} message={whiskMsg} />
                    <Button variant="ghost" size="sm" onClick={testWhisk} className="text-xs h-7">
                      {whiskStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showWhisk ? "text" : "password"}
                    placeholder="Cookie from labs.google"
                    value={settings.whiskCookie}
                    onChange={(e) => { setSettings(s => ({ ...s, whiskCookie: e.target.value })); setWhiskStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowWhisk(!showWhisk)}>
                    {showWhisk ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Google session cookie from labs.google — powers Imagen 3.5 and Veo animation. Expires every few days.</p>
              </div>
```

with:

```tsx
              {/* Gemini */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Gemini Cookies</label>
                  <div className="flex items-center gap-2">
                    <StatusIndicator status={geminiStatus} message={geminiMsg} />
                    <Button variant="ghost" size="sm" onClick={testGemini} className="text-xs h-7">
                      {geminiStatus === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showGeminiPsid ? "text" : "password"}
                    placeholder="__Secure-1PSID"
                    value={settings.geminiPsid}
                    onChange={(e) => { setSettings(s => ({ ...s, geminiPsid: e.target.value })); setGeminiStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowGeminiPsid(!showGeminiPsid)}>
                    {showGeminiPsid ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showGeminiPsidts ? "text" : "password"}
                    placeholder="__Secure-1PSIDTS"
                    value={settings.geminiPsidts}
                    onChange={(e) => { setSettings(s => ({ ...s, geminiPsidts: e.target.value })); setGeminiStatus("idle"); }}
                    className="bg-secondary flex-1"
                  />
                  <Button variant="ghost" size="icon" onClick={() => setShowGeminiPsidts(!showGeminiPsidts)}>
                    {showGeminiPsidts ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Go to <strong>gemini.google.com</strong>, press F12 → Network tab → refresh → copy <code>__Secure-1PSID</code> and <code>__Secure-1PSIDTS</code> cookie values. Expires every few days.
                </p>
              </div>
```

- [ ] **Step 5: Update the Providers tab imageProvider select**

Replace:

```tsx
                    <SelectItem value="whisk">Whisk (Imagen 3.5)</SelectItem>
```

with:

```tsx
                    <SelectItem value="gemini">Gemini (Nano Banana)</SelectItem>
```

Replace:

```tsx
                {settings.imageProvider === "whisk" && !settings.whiskCookie && (
                  <p className="text-xs text-destructive">⚠ Whisk Cookie required — configure it in the Connections tab</p>
                )}
```

with:

```tsx
                {settings.imageProvider === "gemini" && !settings.geminiPsid && (
                  <p className="text-xs text-destructive">⚠ Gemini cookies required — configure them in the Connections tab</p>
                )}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: update Settings page for Gemini cookie fields"
```

---

## Task 11: Update `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add concurrently and update scripts**

In `package.json`, add `concurrently` to `devDependencies`:

```json
"concurrently": "^9.0.0",
```

Replace the `scripts` block:

```json
"scripts": {
  "setup": "npm install && cd gemini-service && python3 -m venv venv && venv/bin/pip install --quiet -r requirements.txt",
  "dev": "npm run build && concurrently --names \"node,gemini\" --prefix-colors \"cyan,magenta\" \"node --import tsx/esm server/index.ts\" \"cd gemini-service && venv/bin/uvicorn main:app --host 0.0.0.0 --port 3060 --reload\"",
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "server": "concurrently --names \"node,gemini\" --prefix-colors \"cyan,magenta\" \"node --import tsx/esm server/index.ts\" \"cd gemini-service && venv/bin/uvicorn main:app --host 0.0.0.0 --port 3060\"",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:push": "drizzle-kit push",
  "deploy": "git push origin main"
}
```

- [ ] **Step 2: Install concurrently**

```bash
npm install
```

Expected: `concurrently` added to `node_modules`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add concurrently, add setup/dev/server scripts for gemini sidecar"
```

---

## Task 11b: Update page components that reference `whiskCookie`

**Files:**
- Modify: `src/pages/ProjectStatus.tsx`
- Modify: `src/pages/ProjectPreview.tsx`
- Modify: `src/pages/VideoGen.tsx`
- Modify: `src/pages/JsonToVideo.tsx`

- [ ] **Step 1: Update ProjectStatus.tsx (lines 112-115)**

Replace:

```typescript
    const canRunClient = settings.imageProvider !== "whisk" || !!settings.whiskCookie;
    if (!canRunClient) {
      toast.error("Whisk cookie not configured. Add it in Settings to generate images.");
      return;
    }
```

with:

```typescript
    const canRunClient = settings.imageProvider !== "gemini" || !!settings.geminiPsid;
    if (!canRunClient) {
      toast.error("Gemini cookies not configured. Add them in Settings to generate images.");
      return;
    }
```

Also replace (line ~254-257):

```typescript
    if (!settings.whiskCookie) { toast.error("Whisk cookie not configured in Settings"); return; }
```

with:

```typescript
    if (!settings.geminiPsid) { toast.error("Gemini cookies not configured in Settings"); return; }
```

And the `startAnimateScenes` call on line ~257:

```typescript
      await startAnimateScenes(projectId, [sceneNumber], settings.whiskCookie);
```

with:

```typescript
      await startAnimateScenes(projectId, [sceneNumber], settings.geminiPsid, settings.geminiPsidts || "");
```

- [ ] **Step 2: Update ProjectPreview.tsx (lines 431-436)**

Replace:

```typescript
    if (!settings.whiskCookie) { toast.error("Whisk cookie not configured in Settings"); return; }
    setAnimateError(null);
    setAnimateStatus("animating");
    setAnimateProgress(0);
    try {
      const { total } = await startAnimateScenes(projectId, Array.from(animateSelected), settings.whiskCookie);
```

with:

```typescript
    if (!settings.geminiPsid) { toast.error("Gemini cookies not configured in Settings"); return; }
    setAnimateError(null);
    setAnimateStatus("animating");
    setAnimateProgress(0);
    try {
      const { total } = await startAnimateScenes(projectId, Array.from(animateSelected), settings.geminiPsid, settings.geminiPsidts || "");
```

Also replace the toast message (line ~439):

```typescript
      toast.success(`Animating ${total} scenes with Veo…`);
```

with:

```typescript
      toast.success(`Animating ${total} scenes with Gemini…`);
```

- [ ] **Step 3: Update VideoGen.tsx (lines 55-59)**

Replace:

```typescript
      const whiskCookie = settings.whiskCookie || undefined;
      await fetch(`/api/render/${pid}/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, whiskCookie }),
      });
```

with:

```typescript
      const geminiPsid = settings.geminiPsid || undefined;
      const geminiPsidts = settings.geminiPsidts || undefined;
      await fetch(`/api/render/${pid}/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, geminiPsid, geminiPsidts }),
      });
```

- [ ] **Step 4: Update JsonToVideo.tsx (line 59)**

Replace:

```typescript
  const missingWhisk = !settings.whiskCookie;
```

with:

```typescript
  const missingGemini = !settings.geminiPsid;
```

Then find and update any JSX that references `missingWhisk` (replace with `missingGemini` and update messages to say "Gemini cookies" instead of "Whisk Cookie").

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ProjectStatus.tsx src/pages/ProjectPreview.tsx src/pages/VideoGen.tsx src/pages/JsonToVideo.tsx
git commit -m "feat: update page components to use Gemini cookies instead of whiskCookie"
```

---

## Task 11c: Remove `@rohitaryal/whisk-api` from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove the dependency**

In `package.json`, delete the line:

```json
    "@rohitaryal/whisk-api": "^4.0.1",
```

- [ ] **Step 2: Re-run npm install**

```bash
npm install
```

Expected: `@rohitaryal/whisk-api` is no longer in `node_modules`.

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: build succeeds with no import errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove @rohitaryal/whisk-api dependency"
```

---

## Task 12: Remove old Whisk files

**Files:**
- Delete: `server/routes/whisk-proxy.ts`
- Delete: `server/lib/whisk.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm server/routes/whisk-proxy.ts server/lib/whisk.ts
```

- [ ] **Step 2: Verify no remaining references**

```bash
npx tsc --noEmit
```

Expected: no errors.

Also check no stray imports remain:

```bash
grep -r "whisk-proxy\|whisk\.js\|animateWhiskImage\|generateWhiskImage\|whiskCookie" src/ server/ --include="*.ts" --include="*.tsx"
```

Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: remove whisk-proxy.ts and whisk.ts"
```

---

## Task 13: Update README

**Files:**
- Modify: `README.md` (create if not present)

- [ ] **Step 1: Update or create README.md**

Ensure `README.md` contains the following sections (replace existing Whisk content if found, otherwise add):

```markdown
## Quick Start

```bash
# 1. Install all dependencies (Node.js + Python sidecar)
npm run setup

# 2. Configure environment — copy and edit .env
cp .env.example .env   # or create manually (see Environment Variables below)

# 3. Start everything
npm run dev            # dev mode (frontend build + Node server + Gemini sidecar)
# or
npm run server         # production (skips Vite build)
```

**Requirements:** Node.js 18+, Python 3.10+, PostgreSQL

---

## Environment Variables

Create `.env` in the project root:

```env
PORT=3001
DATABASE_URL=postgresql://historia:password@localhost:5432/historia
RENDER_API_URL=http://5.189.146.143:9000
RENDER_API_KEY=alliswell
SERVER_URL=http://your-vps-ip:3001
GEMINI_SERVICE_URL=http://localhost:3060
```

> `GEMINI_SERVICE_URL` — URL of the Python Gemini sidecar. Defaults to `http://localhost:3060`.

---

## Gemini Cookie Setup

Image generation and video animation require your Google account cookies from gemini.google.com.

1. Go to **https://gemini.google.com** and log in
2. Press **F12** → Network tab → refresh the page
3. Click any request and find the **Cookie** header
4. Copy the values of `__Secure-1PSID` and `__Secure-1PSIDTS`
5. Paste them in the **Settings → Connections → Gemini Cookies** fields

> Cookies expire every few days — refresh them when image generation starts failing.

---

## Pipeline

1. Submit script → AI scene splitting (Groq/Claude)
2. Scene images — Gemini (Nano Banana) via Python sidecar
3. TTS narration — Inworld AI
4. Video export — FFmpeg Ken Burns clips → merged MP4
5. Optional animation — Gemini video generation via Python sidecar
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with Gemini setup, one-click install instructions"
```

---

## Task 14: End-to-end smoke test

- [ ] **Step 1: Run setup**

```bash
npm run setup
```

Expected: Node deps installed + Python venv created + `gemini_webapi` installed.

- [ ] **Step 2: Start the app**

```bash
npm run dev
```

Expected: Two processes start — `[node]` Express server on port 3001, `[gemini]` uvicorn on port 3060.

- [ ] **Step 3: Verify sidecar health**

```bash
curl http://localhost:3060/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Verify gemini-proxy route is mounted**

```bash
curl -s -X POST http://localhost:3001/api/gemini-proxy \
  -H "Content-Type: application/json" \
  -d '{"action":"session"}' | cat
```

Expected: `{"status":200,"data":{"authenticated":true}}`

- [ ] **Step 5: Run existing Vitest suite**

```bash
npm run test
```

Expected: all existing tests pass (no regressions).

- [ ] **Step 6: Run Python tests**

```bash
cd gemini-service && venv/bin/pytest tests/ -v
```

Expected: `4 passed`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "test: verify gemini replacement smoke tests pass"
```
