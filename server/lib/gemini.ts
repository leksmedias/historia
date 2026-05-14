import { execSync } from "child_process";
import path from "path";

const PROJECT_ID = process.env.VERTEX_PROJECT_ID || "project-f3847793-8610-4a16-945";
const LOCATION_ID = process.env.VERTEX_LOCATION_ID || "europe-west4";
const MODEL_ID = process.env.VERTEX_MODEL_ID || "imagen-4.0-fast-generate-001";
const API_ENDPOINT = `${LOCATION_ID}-aiplatform.googleapis.com`;
// Gemini models only run in us-central1
const GEMINI_LOCATION = "us-central1";
const GEMINI_ENDPOINT = `${GEMINI_LOCATION}-aiplatform.googleapis.com`;

// Global semaphore — max 2 concurrent Imagen calls across all pipelines
const IMAGEN_CONCURRENCY = 2;
let activeImagenCalls = 0;
const imagenQueue: Array<() => void> = [];

function acquireImagenSlot(): Promise<void> {
  return new Promise(resolve => {
    if (activeImagenCalls < IMAGEN_CONCURRENCY) {
      activeImagenCalls++;
      resolve();
    } else {
      imagenQueue.push(() => { activeImagenCalls++; resolve(); });
    }
  });
}

function releaseImagenSlot(): void {
  activeImagenCalls--;
  if (imagenQueue.length > 0) imagenQueue.shift()!();
}

function getAccessToken(): string {
  try {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch (e: any) {
    throw new Error(`Failed to get gcloud access token — run: gcloud auth login --no-browser && gcloud auth application-default login --no-browser`);
  }
}

export async function generateGeminiImage(prompt: string, modelId?: string): Promise<string> {
  await acquireImagenSlot();
  try {
    const model = modelId || MODEL_ID;
    return model.startsWith("gemini-")
      ? await _generateWithGemini(prompt, model)
      : await _generateWithImagen(prompt, model);
  } finally {
    releaseImagenSlot();
  }
}

async function _generateWithImagen(prompt: string, model: string): Promise<string> {
  const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION_ID}/publishers/google/models/${model}:predict`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1,
      personGeneration: "allow_all",
      safetySettings: "block_few",
      addWatermark: false,
      includeRaiReason: false,
      language: "auto",
      outputOptions: {
        mimeType: "image/jpeg",
        compressionQuality: 95,
      },
    },
  };

  const delays = [10_000, 20_000, 30_000];
  let lastError = "";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const accessToken = getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (res.ok) {
      const data = (await res.json()) as { predictions: Array<{ bytesBase64Encoded: string }> };
      const img = data.predictions?.[0]?.bytesBase64Encoded;
      if (!img) throw new Error("No image in Imagen response");
      return img;
    }

    const err = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error("Vertex AI auth failed — run: gcloud auth login --no-browser");
    if (res.status === 429) {
      lastError = `Rate limited (attempt ${attempt + 1})`;
      if (attempt < delays.length) {
        console.warn(`[imagen] 429 rate limit — retrying in ${delays[attempt] / 1000}s`);
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      throw new Error("Imagen rate limited after 4 attempts — check your Vertex AI quota at console.cloud.google.com");
    }
    throw new Error(`Imagen API failed ${res.status}: ${err.slice(0, 200)}`);
  }

  throw new Error(lastError || "Imagen generation failed");
}

async function _generateWithGemini(prompt: string, model: string): Promise<string> {
  const url = `https://${GEMINI_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${GEMINI_LOCATION}/publishers/google/models/${model}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  };

  const delays = [10_000, 20_000, 30_000];
  let lastError = "";

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const accessToken = getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        candidates: Array<{ content: { parts: Array<{ inlineData?: { mimeType: string; data: string } }> } }>;
      };
      const img = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (!img) throw new Error("No image in Gemini response");
      return img;
    }

    const err = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error("Vertex AI auth failed — run: gcloud auth login --no-browser");
    if (res.status === 429) {
      lastError = `Rate limited (attempt ${attempt + 1})`;
      if (attempt < delays.length) {
        console.warn(`[gemini-img] 429 rate limit — retrying in ${delays[attempt] / 1000}s`);
        await new Promise(r => setTimeout(r, delays[attempt]));
        continue;
      }
      throw new Error("Gemini rate limited after 4 attempts");
    }
    throw new Error(`Gemini image API failed ${res.status}: ${err.slice(0, 200)}`);
  }

  throw new Error(lastError || "Gemini image generation failed");
}

export function getStyleImagePaths(projectId: string): string[] {
  return [
    path.join("uploads", projectId, "style", "style1.png"),
    path.join("uploads", projectId, "style", "style2.png"),
  ];
}
