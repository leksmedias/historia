import { Router, Request, Response } from "express";
import { generateGeminiImage, PROJECT_ID, getAccessToken } from "../lib/gemini.js";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { action, payload, apiKey } = req.body;

    if (action === "generate") {
      const promptText: string = payload?.userInput?.prompts?.[0] || payload?.prompt || "";
      if (!promptText) return res.json({ status: 400, data: { error: "prompt required" } });

      try {
        const imageBase64 = await generateGeminiImage(promptText, payload?.modelId, payload?.aspectRatio);
        return res.json({
          status: 200,
          data: { imagePanels: [{ generatedImages: [{ encodedImage: imageBase64 }] }] },
        });
      } catch (e: any) {
        console.error("[gemini-proxy] generate error:", e.message);
        return res.json({ status: 500, data: { error: e.message } });
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

    if (action === "nvidia-chat") {
      const key = apiKey || process.env.NVIDIA_API_KEY || "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";
      const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
      const modelName = payload?.model || "";
      const isVertexClaude = modelName.startsWith("publishers/") || modelName.includes("@") || modelName === "claude-haiku-4-5";

      if (isVertexClaude) {
        try {
          const modelPath = modelName.startsWith("publishers/") 
            ? modelName 
            : `publishers/anthropic/models/${modelName}`;
          
          const region = "us-east5"; // us-east5 is the primary region for Claude in Vertex AI
          const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${region}/${modelPath}:rawPredict`;
          const accessToken = getAccessToken();

          const { model, ...bodyWithoutModel } = payload;
          const vertexPayload = {
            ...bodyWithoutModel,
            anthropic_version: "vertex-2023-10-16"
          };

          const r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`
            },
            body: JSON.stringify(vertexPayload)
          });

          const text = await r.text();
          let data;
          try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
          return res.json({ status: r.status, data });
        } catch (e: any) {
          console.error("[gemini-proxy] claude-vertex error:", e.message);
          return res.json({ status: 500, data: { error: e.message } });
        }
      }

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
