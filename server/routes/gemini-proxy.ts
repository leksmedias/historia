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

    if (action === "inworld-chat") {
      const key = apiKey || process.env.INWORLD_API_KEY;
      if (!key) return res.json({ status: 500, data: { error: "INWORLD_API_KEY not configured" } });
      const r = await fetch("https://api.inworld.ai/v1/chat/completions", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "Authorization": `Basic ${key}` 
        },
        body: JSON.stringify(payload),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
      return res.json({ status: r.status, data });
    }

    if (action === "claude-chat") {
      const modelName = payload?.model || "";
      const isVertexClaude = modelName.startsWith("publishers/") || modelName.includes("@") || modelName === "claude-haiku-4-5" || modelName === "claude-sonnet-4-6";

      if (isVertexClaude) {
        try {
          const modelPath = modelName.startsWith("publishers/") 
            ? modelName 
            : `publishers/anthropic/models/${modelName}`;
          
          const region = "global";
          const host = "aiplatform.googleapis.com";
          const url = `https://${host}/v1/projects/${PROJECT_ID}/locations/${region}/${modelPath}:rawPredict`;
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

    if (action === "gemini-chat") {
      const model = payload?.model || "gemini-3.5-flash";
      const key = apiKey || process.env.GEMINI_API_KEY;

      const { model: _, ...bodyWithoutModel } = payload;

      if (key) {
        // Developer API / AI Studio endpoint
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyWithoutModel),
        });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
        return res.json({ status: r.status, data });
      } else {
        // Vertex AI endpoint using OAuth
        try {
          const accessToken = getAccessToken();
          const endpoint = "aiplatform.googleapis.com";
          const url = `https://${endpoint}/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${model}:generateContent`;
          
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(bodyWithoutModel),
          });
          const text = await r.text();
          let data;
          try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
          return res.json({ status: r.status, data });
        } catch (e: any) {
          console.error("[gemini-proxy] gemini-vertex error:", e.message);
          return res.json({ status: 500, data: { error: e.message } });
        }
      }
    }

    res.status(400).json({ error: "Unknown action" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
