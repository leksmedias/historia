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
