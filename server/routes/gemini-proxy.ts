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
