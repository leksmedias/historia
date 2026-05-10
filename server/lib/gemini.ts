import { execSync } from "child_process";
import path from "path";

const PROJECT_ID = process.env.VERTEX_PROJECT_ID || "project-f3847793-8610-4a16-945";
const LOCATION_ID = process.env.VERTEX_LOCATION_ID || "europe-west4";
const MODEL_ID = process.env.VERTEX_MODEL_ID || "imagen-4.0-fast-generate-001";
const API_ENDPOINT = `${LOCATION_ID}-aiplatform.googleapis.com`;

function getAccessToken(): string {
  try {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch (e: any) {
    throw new Error(`Failed to get gcloud access token — run: gcloud auth login --no-browser && gcloud auth application-default login --no-browser`);
  }
}

export async function generateGeminiImage(prompt: string): Promise<string> {
  const accessToken = getAccessToken();
  const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION_ID}/publishers/google/models/${MODEL_ID}:predict`;

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

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) throw new Error("Imagen rate limited — try again in a moment.");
    if (res.status === 401 || res.status === 403) throw new Error("Vertex AI auth failed — run: gcloud auth login --no-browser");
    throw new Error(`Imagen API failed ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { predictions: Array<{ bytesBase64Encoded: string }> };
  const img = data.predictions?.[0]?.bytesBase64Encoded;
  if (!img) throw new Error("No image in Imagen response");
  return img;
}

export function getStyleImagePaths(projectId: string): string[] {
  return [
    path.join("uploads", projectId, "style", "style1.png"),
    path.join("uploads", projectId, "style", "style2.png"),
  ];
}
