import path from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL_ID = process.env.IMAGEN_MODEL_ID || "imagen-3.0-generate-002";

export async function generateGeminiImage(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in .env");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:predict?key=${GEMINI_API_KEY}`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio: "16:9",
      sampleCount: 1,
      personGeneration: "allow_all",
      safetySettings: "block_few",
      addWatermark: false,
      language: "auto",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Imagen API failed ${res.status}: ${err.slice(0, 300)}`);
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
