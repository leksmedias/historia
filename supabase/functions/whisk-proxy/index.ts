import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// tRPC endpoints return nested result.data.json — unwrap it
function unwrapTrpc(json: any): any {
  return json?.result?.data?.json?.result || json?.result?.data?.json || json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, cookie, accessToken, payload } = body;

    // Action: session — get access token from cookie
    if (action === "session") {
      console.log("[whisk-proxy] session request");
      const res = await fetch("https://labs.google/fx/api/auth/session", {
        headers: { cookie },
      });
      const data = await res.json();
      console.log(`[whisk-proxy] session status=${res.status}`);
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: create-project — create a Whisk workflow/project
    if (action === "create-project") {
      console.log("[whisk-proxy] create-project request");
      const res = await fetch("https://labs.google/fx/api/trpc/media.createOrUpdateWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          json: { workflowMetadata: { workflowName: payload?.name || "Historia Project" } },
        }),
      });
      const text = await res.text();
      console.log(`[whisk-proxy] create-project status=${res.status} body=${text.substring(0, 500)}`);
      let data;
      try { data = unwrapTrpc(JSON.parse(text)); } catch { data = { raw: text.substring(0, 1000) }; }
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: caption-image — generate caption for an image
    if (action === "caption-image") {
      console.log("[whisk-proxy] caption-image request");
      const res = await fetch("https://labs.google/fx/api/trpc/backbone.captionImage", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          json: {
            clientContext: { workflowId: payload?.workflowId || "" },
            captionInput: {
              candidatesCount: 1,
              mediaInput: {
                mediaCategory: payload?.mediaCategory || "MEDIA_CATEGORY_STYLE",
                rawBytes: payload?.rawBytes,
              },
            },
          },
        }),
      });
      const text = await res.text();
      console.log(`[whisk-proxy] caption-image status=${res.status} body=${text.substring(0, 500)}`);
      let data;
      try { data = unwrapTrpc(JSON.parse(text)); } catch { data = { raw: text.substring(0, 1000) }; }
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: upload — upload image to Whisk (correct endpoint, no ?batch=1)
    if (action === "upload") {
      console.log("[whisk-proxy] upload request");
      const res = await fetch("https://labs.google/fx/api/trpc/backbone.uploadImage", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          json: {
            clientContext: { workflowId: payload?.workflowId || "" },
            uploadMediaInput: {
              mediaCategory: payload?.mediaCategory || "MEDIA_CATEGORY_STYLE",
              rawBytes: payload?.rawBytes,
              caption: payload?.caption || "",
            },
          },
        }),
      });
      const text = await res.text();
      console.log(`[whisk-proxy] upload status=${res.status} body=${text.substring(0, 500)}`);
      let data;
      try { data = unwrapTrpc(JSON.parse(text)); } catch { data = { raw: text.substring(0, 1000) }; }
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: generate-recipe — run image recipe with style refs
    if (action === "generate-recipe") {
      console.log(`[whisk-proxy] generate-recipe request, payload keys: ${Object.keys(payload || {}).join(",")}`);
      const res = await fetch("https://aisandbox-pa.googleapis.com/v1/whisk:runImageRecipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      console.log(`[whisk-proxy] generate-recipe status=${res.status} body=${text.substring(0, 1000)}`);
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: generate — plain text-to-image
    if (action === "generate") {
      console.log(`[whisk-proxy] generate request, prompt preview: ${JSON.stringify(payload).substring(0, 200)}`);
      const res = await fetch("https://aisandbox-pa.googleapis.com/v1:runImageFx", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      console.log(`[whisk-proxy] generate status=${res.status} body=${text.substring(0, 1000)}`);
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }
      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Action: groq-chat — proxy scene/prompt generation
    if (action === "groq-chat") {
      const key = body.apiKey || Deno.env.get("GROQ_API_KEY");
      if (!key) {
        return new Response(JSON.stringify({ status: 500, data: { error: "GROQ_API_KEY not configured" } }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      console.log(`[whisk-proxy] groq-chat status=${res.status} body=${text.substring(0, 500)}`);
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.substring(0, 1000) }; }

      return new Response(JSON.stringify({ status: res.status, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[whisk-proxy] error:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
