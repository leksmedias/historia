import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, Download, CheckCircle2, AlertCircle, X } from "lucide-react";
import { loadProviderSettings } from "@/lib/providers";
import { estimateSceneCount, type OutputScene } from "@/lib/scriptToJson";

const DURATION_OPTIONS = [
  { value: 10, label: "10s", words: 19 },
  { value: 15, label: "15s", words: 29 },
  { value: 20, label: "20s", words: 38 },
  { value: 30, label: "30s", words: 57 },
] as const;

type Style = "impasto" | "ww2";
type Provider = "groq" | "nvidia";

interface Progress {
  phase: "pass1" | "pass2";
  done: number;
  total: number;
}

const STORAGE_KEY = "stj_job";

function highlightJson(json: string): string {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")\s*:/g, '<span class="text-violet-400">$1</span>:')
    .replace(/: ("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")/g, ': <span class="text-emerald-400">$1</span>')
    .replace(/: (null)/g, ': <span class="text-slate-500">$1</span>');
}

export default function ScriptToJson() {
  const { toast } = useToast();
  const settings = useMemo(() => loadProviderSettings(), []);

  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [secondsPerScene, setSecondsPerScene] = useState<10 | 15 | 20 | 30>(15);
  const [style, setStyle] = useState<Style>("impasto");
  const [provider, setProvider] = useState<Provider>("groq");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [partialScenes, setPartialScenes] = useState<OutputScene[]>([]);
  const [result, setResult] = useState<{ title: string; scenes: OutputScene[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/script-to-json/${jobId}`);
      if (res.status === 404) {
        stopPolling();
        setGenerating(false);
        setProgress(null);
        setActiveJobId(null);
        localStorage.removeItem(STORAGE_KEY);
        setError("Job was lost (server restarted). Please regenerate.");
        return;
      }
      const job = await res.json();
      if (job.progress) {
        setProgress({ phase: job.progress.phase, done: job.progress.done, total: job.progress.total });
        if (job.progress.partialScenes?.length) setPartialScenes(job.progress.partialScenes);
      }
      if (job.status === "completed") {
        stopPolling();
        setResult(job.result);
        setGenerating(false);
        setProgress(null);
        setPartialScenes([]);
        setActiveJobId(null);
        localStorage.removeItem(STORAGE_KEY);
      } else if (job.status === "failed") {
        stopPolling();
        setError(job.error ?? "Generation failed");
        toast({ title: "Generation failed", description: job.error, variant: "destructive" });
        setGenerating(false);
        setProgress(null);
        setActiveJobId(null);
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Network hiccup — will retry on next tick
    }
  }, [stopPolling, toast]);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(() => pollJob(jobId), 2000);
    // Poll immediately
    pollJob(jobId);
  }, [pollJob, stopPolling]);

  // Resume any in-progress job on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const { jobId, savedTitle } = JSON.parse(stored);
        setActiveJobId(jobId);
        if (savedTitle) setTitle(savedTitle);
        setGenerating(true);
        startPolling(jobId);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = useCallback(() => {
    stopPolling();
    setGenerating(false);
    setProgress(null);
    setActiveJobId(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [stopPolling]);

  const wordCount = script.trim() ? script.trim().split(/\s+/).length : 0;
  const estimatedScenes = wordCount > 0 ? estimateSceneCount(wordCount, secondsPerScene) : 0;
  const apiKey = provider === "groq" ? settings.groqApiKey : settings.nvidiaApiKey;
  const canGenerate = title.trim().length > 0 && wordCount > 0 && apiKey.length > 0 && !generating;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    setPartialScenes([]);
    setProgress(null);

    try {
      const res = await fetch("/api/script-to-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          script: script.trim(),
          secondsPerScene,
          style,
          provider,
          apiKey,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error ?? `Failed to start job (HTTP ${res.status})`);
      }
      const { jobId } = await res.json();
      setActiveJobId(jobId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId, savedTitle: title.trim() }));
      startPolling(jobId);
    } catch (e: any) {
      setError(e.message ?? "Failed to start generation");
      setGenerating(false);
    }
  }, [title, script, secondsPerScene, style, provider, apiKey, startPolling]);

  const displayOutput = result ?? (partialScenes.length > 0 ? { title, scenes: partialScenes } : null);
  const jsonString = displayOutput ? JSON.stringify(displayOutput, null, 2) : "";

  async function handleCopy() {
    if (!jsonString) return;
    try {
      await navigator.clipboard.writeText(jsonString);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access denied", variant: "destructive" });
    }
  }

  function handleDownload() {
    if (!jsonString) return;
    const slug = (result?.title ?? "output").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="h-full flex overflow-hidden bg-background">
      {/* ── Left Panel ── */}
      <div className="w-[420px] shrink-0 flex flex-col border-r border-border overflow-y-auto">
        <div className="px-5 py-4 border-b border-border shrink-0">
          <h1 className="text-lg font-display font-semibold">Script → JSON</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate a cinematic scene manifest from your documentary script
          </p>
        </div>

        <div className="flex flex-col gap-4 p-5 flex-1">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1.5">
              Documentary Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Bridge at Remagen - March 7 1945"
              disabled={generating}
            />
          </div>

          {/* Script */}
          <div className="flex flex-col flex-1 min-h-0">
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1.5">
              Script
            </label>
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste your documentary script here..."
              className="flex-1 min-h-[140px] resize-none font-mono text-xs"
              disabled={generating}
            />
            <div className="text-xs text-muted-foreground mt-1 text-right">
              {wordCount > 0 ? `${wordCount.toLocaleString()} words · ~${Math.round(wordCount / 117)} min` : ""}
            </div>
          </div>

          {/* Scene Duration */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-1">
              Scene Duration
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              How long each scene displays — sets narration length per scene
            </p>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSecondsPerScene(opt.value as 10 | 15 | 20 | 30)}
                  disabled={generating}
                  className={`rounded-lg border py-2 px-1 text-center transition-colors ${
                    secondsPerScene === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <div className="text-sm font-bold">{opt.label}</div>
                  <div className="text-[10px] opacity-70">~{opt.words}w</div>
                </button>
              ))}
            </div>
            {estimatedScenes > 0 && (
              <div className="mt-2 text-xs text-emerald-500">
                Estimated ~{estimatedScenes} scenes
              </div>
            )}
          </div>

          {/* Visual Style */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-2">
              Visual Style
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["impasto", "ww2"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  disabled={generating}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    style === s
                      ? "border-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <div className="text-xs font-semibold">
                    {s === "impasto" ? "🎨 Impasto Oil" : "📷 WWII Archival"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {s === "impasto"
                      ? "17th-century digital oil painting, heavy brushwork, chiaroscuro"
                      : "B&W photojournalism, Kodak grain, documentary realism"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* AI Provider */}
          <div>
            <label className="text-xs font-medium text-primary uppercase tracking-wide block mb-2">
              AI Provider
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["groq", "nvidia"] as const).map((p) => {
                const key = p === "groq" ? settings.groqApiKey : settings.nvidiaApiKey;
                return (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    disabled={generating}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      provider === p
                        ? "border-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    <div className="text-xs font-semibold">
                      {p === "groq" ? "Groq" : "NVIDIA"}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {p === "groq" ? "Batch 8 scenes" : "Batch 20 scenes"}
                    </div>
                    {!key && (
                      <div className="text-[10px] text-amber-500 mt-0.5">No key set</div>
                    )}
                  </button>
                );
              })}
            </div>
            {apiKey ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-500">
                <CheckCircle2 className="h-3 w-3" />
                Using {provider === "groq" ? "Groq" : "NVIDIA"} key from Settings
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
                <AlertCircle className="h-3 w-3" />
                No API key — set one in Settings
              </div>
            )}
          </div>
        </div>

        {/* Generate / Cancel button */}
        <div className="px-5 pb-5 shrink-0 flex flex-col gap-2">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              "▶ Generate Scene Manifest"
            )}
          </Button>
          {generating && (
            <button
              onClick={handleCancel}
              className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold">JSON Output</h2>
            {displayOutput && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {displayOutput.scenes.length} scenes
                {result ? " · complete" : " · generating..."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              disabled={!jsonString}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!result}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download .json
            </Button>
          </div>
        </div>

        {/* Background job banner */}
        {generating && (
          <div className="px-5 py-2.5 border-b border-border bg-primary/5 shrink-0 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
            <span className="text-xs text-primary">
              Running in background — you can navigate away and return to see results
            </span>
            {activeJobId && (
              <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                {activeJobId.slice(0, 8)}
              </span>
            )}
          </div>
        )}

        {/* Progress */}
        {progress && (
          <div className="px-5 py-3 border-b border-border bg-muted/30 shrink-0">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-primary">
                {progress.phase === "pass1"
                  ? `Pass 1: Splitting script (chunk ${progress.done}/${progress.total})...`
                  : `Pass 2: Generating prompts...`}
              </span>
              {progress.phase === "pass2" && (
                <span className="text-muted-foreground">
                  {progress.done} / {progress.total} scenes
                </span>
              )}
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shrink-0">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* JSON display */}
        {jsonString ? (
          <div className="flex-1 overflow-auto p-5">
            <pre
              className="text-xs leading-relaxed font-mono whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlightJson(jsonString) }}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            {generating ? "Processing..." : "Output will appear here"}
          </div>
        )}
      </div>
    </div>
  );
}
