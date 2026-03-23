import fs from "fs";
import path from "path";
import { Whisk, Media, VideoGenerationModel } from "@rohitaryal/whisk-api";

function decodeEncodedImage(encodedImage: string): Uint8Array {
  const binary = atob(encodedImage);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function resolveExistingPath(base: string): string | null {
  const candidates = [
    base,
    base.replace(/\.png$/, ".jpg"),
    base.replace(/\.png$/, ".jpeg"),
    base.replace(/\.png$/, ".webp"),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

export async function createWhiskProject(cookie: string, styleImagePaths: string[]): Promise<{ project: any; refsAdded: number }> {
  const whisk = new Whisk(cookie);
  const project = await whisk.newProject("Historia-" + Date.now());

  let refsAdded = 0;

  const subjectPath = resolveExistingPath(styleImagePaths[0] || "");
  if (subjectPath) {
    try {
      await project.addSubject({ file: subjectPath });
      refsAdded++;
      console.log(`[whisk] Added subject ref: ${subjectPath}`);
    } catch (e: any) {
      console.warn(`[whisk] addSubject failed: ${e.message}`);
    }
  }

  const stylePath = resolveExistingPath(styleImagePaths[1] || "");
  if (stylePath) {
    try {
      await project.addStyle({ file: stylePath });
      refsAdded++;
      console.log(`[whisk] Added style ref: ${stylePath}`);
    } catch (e: any) {
      console.warn(`[whisk] addStyle failed: ${e.message}`);
    }
  }

  console.log(`[whisk] Project ready with ${refsAdded} reference(s)`);
  return { project, refsAdded };
}

export async function generateImageFromProject(project: any, prompt: string, refsAdded: number): Promise<Uint8Array> {
  console.log(`[whisk] Generating: ${prompt.substring(0, 100)}...`);

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Whisk generation timed out after 60s")), 60000)
  );

  const genPromise = refsAdded > 0
    ? project.generateImageWithReferences({ prompt, aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE" })
    : project.generateImage({ prompt, aspectRatio: "IMAGE_ASPECT_RATIO_LANDSCAPE" });

  const media = await Promise.race([genPromise, timeoutPromise]);

  const encodedImage = (media as any).encodedMedia;
  if (!encodedImage) throw new Error("No image in Whisk response");

  console.log(`[whisk] Image generated successfully`);
  return decodeEncodedImage(encodedImage);
}

export async function generateWhiskImageWithRefs(
  prompt: string,
  cookie: string,
  styleImagePaths: string[]
): Promise<Uint8Array> {
  const { project, refsAdded } = await createWhiskProject(cookie, styleImagePaths);
  return generateImageFromProject(project, prompt, refsAdded);
}

export function getStyleImagePaths(projectId: string): string[] {
  return [
    path.join("uploads", projectId, "style", "style1.png"),
    path.join("uploads", projectId, "style", "style2.png"),
  ];
}

/**
 * Animate a landscape image into a ~8s video via the VPS Whisk proxy.
 * Uses POST /api/animate with multipart file upload.
 * Returns the raw video bytes.
 */
export async function animateWhiskImage(
  imagePath: string,
  cookie: string,
  videoScript: string
): Promise<Buffer> {
  const WHISK_VPS = (process.env.WHISK_VPS_URL ?? "http://5.189.146.143:3050").replace(/\/$/, "");
  console.log(`[whisk-vps] animating ${path.basename(imagePath)} via ${WHISK_VPS}`);

  const imageData = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace(".", "") || "png";
  const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

  const formData = new FormData();
  formData.append("file", new Blob([imageData], { type: mimeType }), path.basename(imagePath));
  formData.append("script", videoScript || "Camera slowly pans left revealing the scene");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5-min timeout

  try {
    const res = await fetch(`${WHISK_VPS}/api/animate`, {
      method: "POST",
      headers: { "x-whisk-cookie": cookie },
      body: formData as any,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Whisk VPS animate failed (${res.status}): ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    if (!data.videoUrl) throw new Error("No videoUrl in animate response");
    console.log(`[whisk-vps] videoUrl received, downloading…`);

    const videoRes = await fetch(data.videoUrl, { signal: controller.signal });
    if (!videoRes.ok) throw new Error(`Video download failed: ${videoRes.status}`);
    const buf = await videoRes.arrayBuffer();
    return Buffer.from(buf);
  } finally {
    clearTimeout(timer);
  }
}
