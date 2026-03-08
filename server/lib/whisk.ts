import fs from "fs";
import path from "path";

function unwrapTrpc(json: any): any {
  return json?.result?.data?.json?.result || json?.result?.data?.json || json;
}

async function getWhiskSession(cookie: string): Promise<string> {
  const res = await fetch("https://labs.google/fx/api/auth/session", { headers: { cookie } });
  if (!res.ok) throw new Error(`Whisk session failed: ${res.status}`);
  const data = await res.json();
  const accessToken = data?.access_token;
  if (!accessToken) throw new Error("No access_token in Whisk session — cookie may be expired");
  return accessToken;
}

async function captionImageFromBytes(rawBytes: string, workflowId: string, cookie: string): Promise<string> {
  try {
    const res = await fetch("https://labs.google/fx/api/trpc/backbone.captionImage", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({
        json: {
          clientContext: { workflowId },
          captionInput: {
            candidatesCount: 1,
            mediaInput: { mediaCategory: "MEDIA_CATEGORY_STYLE", rawBytes },
          },
        },
      }),
    });
    if (!res.ok) return "";
    const text = await res.text();
    const data = unwrapTrpc(JSON.parse(text));
    return data?.candidates?.[0]?.output || "";
  } catch {
    return "";
  }
}

async function createWhiskProject(cookie: string): Promise<string> {
  const res = await fetch("https://labs.google/fx/api/trpc/media.createOrUpdateWorkflow", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      json: { workflowMetadata: { workflowName: "Historia-" + Date.now() } },
    }),
  });
  const text = await res.text();
  const data = unwrapTrpc(JSON.parse(text));
  const workflowId = data?.workflowId;
  if (!workflowId) throw new Error(`No workflowId from Whisk. Response: ${text.substring(0, 200)}`);
  return workflowId;
}

function fileToBase64DataUrl(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function decodeEncodedImage(encodedImage: string): Uint8Array {
  const binary = atob(encodedImage);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function resolveExistingPath(base: string): string | null {
  const candidates = [base, base.replace(/\.png$/, ".jpg"), base.replace(/\.png$/, ".jpeg"), base.replace(/\.png$/, ".webp")];
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function buildStyleEnhancedPrompt(
  prompt: string,
  stylePaths: string[],
  cookie: string
): Promise<{ enhancedPrompt: string; workflowId: string | null }> {
  const existing = stylePaths.map(resolveExistingPath).filter(Boolean) as string[];
  if (existing.length === 0) return { enhancedPrompt: prompt, workflowId: null };

  let workflowId: string | null = null;
  const captions: string[] = [];

  try {
    workflowId = await createWhiskProject(cookie);
    for (const p of existing) {
      const rawBytes = fileToBase64DataUrl(p);
      const caption = await captionImageFromBytes(rawBytes, workflowId, cookie);
      if (caption) {
        console.log(`[whisk] Style caption: ${caption.substring(0, 100)}`);
        captions.push(caption);
      }
    }
  } catch (e: any) {
    console.warn(`[whisk] Caption step failed: ${e.message}`);
  }

  if (captions.length === 0) return { enhancedPrompt: prompt, workflowId };

  const stylePrefix = `In the visual style of: ${captions.join("; ")}. `;
  return { enhancedPrompt: stylePrefix + prompt, workflowId };
}

async function generateViaImageFx(prompt: string, accessToken: string): Promise<Uint8Array> {
  const res = await fetch("https://aisandbox-pa.googleapis.com/v1:runImageFx", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      userInput: { candidatesCount: 1, prompts: [prompt] },
      generationParams: { seed: null },
      clientContext: { tool: "WHISK" },
      modelInput: { modelNameType: "IMAGEN_3_5" },
      aspectRatio: "LANDSCAPE",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) throw new Error("Whisk rate limited — wait a minute and try again.");
    if (res.status === 401 || res.status === 403) throw new Error("Whisk auth expired. Update your Whisk Cookie.");
    throw new Error(`Whisk generation failed (${res.status}): ${errText.substring(0, 200)}`);
  }

  const genData = await res.json();
  const encodedImage = genData?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
  if (!encodedImage) throw new Error("No image in Whisk response");
  return decodeEncodedImage(encodedImage);
}

export async function generateWhiskImageWithRefs(
  prompt: string,
  cookie: string,
  styleImagePaths: string[]
): Promise<Uint8Array> {
  const accessToken = await getWhiskSession(cookie);
  const { enhancedPrompt } = await buildStyleEnhancedPrompt(prompt, styleImagePaths, cookie);
  console.log(`[whisk] Generating image with prompt: ${enhancedPrompt.substring(0, 120)}...`);
  return generateViaImageFx(enhancedPrompt, accessToken);
}

export function getStyleImagePaths(projectId: string): string[] {
  return [
    path.join("uploads", projectId, "style", "style1.png"),
    path.join("uploads", projectId, "style", "style2.png"),
  ];
}
