import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, RotateCcw, Download, FlaskConical } from "lucide-react";
import { IMAGE_MODELS, ASPECT_RATIOS } from "@/lib/providers";

type ModelStatus = "idle" | "generating" | "done" | "failed";

interface ModelResult {
  modelId: string;
  label: string;
  status: ModelStatus;
  imageUrl?: string;
  error?: string;
  durationMs?: number;
}

const DEFAULT_PROMPT =
  "Wide establishing shot of ancient Roman soldiers marching in formation through a dust-filled valley at golden hour, backs turned, lorica segmentata armor catching the light, dramatic chiaroscuro, cinematic oil painting style.";

export default function ImageModelTest() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [results, setResults] = useState<ModelResult[]>(
    IMAGE_MODELS.map(m => ({ modelId: m.id, label: m.label, status: "idle" }))
  );
  const abortRef = useRef<boolean>(false);

  function setResult(modelId: string, patch: Partial<ModelResult>) {
    setResults(prev => prev.map(r => r.modelId === modelId ? { ...r, ...patch } : r));
  }

  async function generateForModel(modelId: string, label: string) {
    setResult(modelId, { status: "generating", imageUrl: undefined, error: undefined });
    const t0 = Date.now();
    try {
      const res = await fetch("/api/gemini-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          payload: {
            userInput: { candidatesCount: 1, prompts: [prompt] },
            modelId,
            aspectRatio,
          },
        }),
      });
      const json = await res.json();
      if (abortRef.current) return;

      const encoded = json.data?.imagePanels?.[0]?.generatedImages?.[0]?.encodedImage;
      if (!encoded) throw new Error(json.data?.error || "No image returned");

      const url = `data:image/png;base64,${encoded}`;
      setResult(modelId, { status: "done", imageUrl: url, durationMs: Date.now() - t0 });
    } catch (e: any) {
      if (!abortRef.current) {
        setResult(modelId, { status: "failed", error: e.message, durationMs: Date.now() - t0 });
      }
    }
  }

  async function runAll() {
    abortRef.current = false;
    for (const m of IMAGE_MODELS) {
      if (abortRef.current) break;
      await generateForModel(m.id, m.label);
    }
  }

  function stopAll() {
    abortRef.current = true;
    setResults(prev =>
      prev.map(r => r.status === "generating" ? { ...r, status: "idle" } : r)
    );
  }

  function reset() {
    abortRef.current = true;
    setResults(IMAGE_MODELS.map(m => ({ modelId: m.id, label: m.label, status: "idle" })));
  }

  function downloadImage(url: string, modelId: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${modelId}-${aspectRatio.replace(":", "x")}.png`;
    a.click();
  }

  const anyGenerating = results.some(r => r.status === "generating");

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-display text-foreground">Image Model Test</h1>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Prompt</label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              className="bg-secondary resize-none"
              placeholder="Describe the image you want to generate…"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Aspect Ratio</label>
              <Select value={aspectRatio} onValueChange={v => setAspectRatio(v as "16:9" | "9:16")}>
                <SelectTrigger className="bg-secondary w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              {anyGenerating ? (
                <Button variant="destructive" onClick={stopAll}>Stop</Button>
              ) : (
                <Button onClick={runAll} disabled={!prompt.trim()}>
                  <Play className="h-4 w-4 mr-2" />
                  Run All Models
                </Button>
              )}
              <Button variant="outline" onClick={reset} disabled={anyGenerating}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {results.map(r => (
          <Card key={r.modelId} className="overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium truncate">{r.label}</CardTitle>
                <StatusBadge status={r.status} />
              </div>
              {r.durationMs !== undefined && r.status !== "generating" && (
                <p className="text-xs text-muted-foreground">{(r.durationMs / 1000).toFixed(1)}s</p>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {/* Image area */}
              <div
                className={`bg-secondary rounded overflow-hidden flex items-center justify-center ${
                  aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-video"
                }`}
              >
                {r.status === "generating" && (
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                )}
                {r.status === "done" && r.imageUrl && (
                  <img
                    src={r.imageUrl}
                    alt={r.label}
                    className="w-full h-full object-cover"
                  />
                )}
                {r.status === "failed" && (
                  <p className="text-xs text-destructive text-center px-3">{r.error}</p>
                )}
                {r.status === "idle" && (
                  <p className="text-xs text-muted-foreground">Not generated</p>
                )}
              </div>

              {/* Per-model controls */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  disabled={anyGenerating}
                  onClick={() => generateForModel(r.modelId, r.label)}
                >
                  {r.status === "generating" ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Play className="h-3 w-3 mr-1" />
                  )}
                  Generate
                </Button>
                {r.imageUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => downloadImage(r.imageUrl!, r.modelId)}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ModelStatus }) {
  if (status === "idle") return <Badge variant="secondary" className="text-xs shrink-0">Idle</Badge>;
  if (status === "generating") return (
    <Badge variant="secondary" className="text-xs shrink-0 text-amber-500 border-amber-500/30">
      <Loader2 className="h-3 w-3 animate-spin mr-1" />Generating
    </Badge>
  );
  if (status === "done") return <Badge className="text-xs shrink-0 bg-green-500/20 text-green-600 border-green-500/30">Done</Badge>;
  return <Badge variant="destructive" className="text-xs shrink-0">Failed</Badge>;
}
