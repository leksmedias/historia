const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { imageUrls } = await req.json();
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return new Response(JSON.stringify({ error: "imageUrls array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build vision message with all reference images
    const contentParts: any[] = [
      {
        type: "text",
        text: `You are a visual style analyst for a cinematic image generation pipeline. Analyze these reference images and extract a detailed, reusable style description that can be prepended to every image generation prompt to ensure visual consistency.

Describe the following attributes precisely:
1. **palette**: Exact color tones, saturation levels, color temperature, dominant hues
2. **lighting**: Light sources, direction, quality (soft/hard), shadows, atmosphere
3. **texture**: Surface quality, grain, digital vs painterly, level of detail
4. **framing**: Camera angles, composition patterns, depth of field
5. **mood**: Emotional tone, atmosphere, tension level
6. **medium**: What artistic medium it resembles (oil painting, digital art, photography, etc.)
7. **people_style**: How people/figures are rendered (realistic, stylized, silhouetted, etc.)
8. **historicalLook**: Period-specific visual elements, architecture style, clothing style

Also generate a single "style_anchor" string (2-3 sentences) that captures the ESSENCE of this visual style, suitable for prepending to every image prompt.

Return ONLY valid JSON:
{
  "palette": "...",
  "lighting": "...",
  "texture": "...",
  "framing": "...",
  "mood": "...",
  "medium": "...",
  "people_style": "...",
  "historicalLook": "...",
  "style_anchor": "In the style of..."
}`,
      },
    ];

    for (const url of imageUrls) {
      contentParts.push({
        type: "image_url",
        image_url: { url },
      });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: contentParts,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[analyze-style] AI gateway error: ${response.status} ${errText}`);
      return new Response(JSON.stringify({ error: `AI analysis failed (${response.status})` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    let content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: "No content from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse JSON from response
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const styleSummary = JSON.parse(content);

    console.log(`[analyze-style] Extracted style:`, JSON.stringify(styleSummary).substring(0, 500));

    return new Response(JSON.stringify({ styleSummary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[analyze-style] error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
