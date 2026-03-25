import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Download,
  ExternalLink,
  Film,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import {
  createProjectFrontend,
  startClipGeneration,
  getClipStatus,
  startRender,
  getRenderStatus,
  getRenderDownloadUrl,
} from "@/lib/api";
import { loadProviderSettings } from "@/lib/providers";

// ── text splitting (same logic as TextSplitter page) ──────────────────────────
const normalizeText = (text: string) =>
  text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const splitIntoSentences = (text: string): string[] => {
  const clean = normalizeText(text);
  if (!clean) return [];
  const matches = clean.match(/[^.!?\n]+(?:[.!?]+["')\]]*)?|\n+/g) || [];
  return matches.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
};

const splitLongSentence = (sentence: string, limit: number): string[] => {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= limit) return [sentence];
  const pieces: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + limit, words.length);
    if (end < words.length) {
      for (let i = end; i > start + Math.floor(limit * 0.6); i -= 1) {
        if (/[,:;)]$/.test(words[i - 1])) { end = i; break; }
      }
    }
    pieces.push(words.slice(start, end).join(" "));
    start = end;
  }
  return pieces;
};

function splitScript(text: string, targetWords: number): string[] {
  const sentences = splitIntoSentences(text).flatMap((s) => splitLongSentence(s, targetWords));
  const result: string[] = [];
  let current = "";
  let currentWords = 0;
  const tolerance = Math.round(targetWords * 0.3);
  for (const sentence of sentences) {
    const words = sentence.trim().match(/\S+/g)?.length ?? 0;
    if (!current) { current = sentence; currentWords = words; continue; }
    if (currentWords + words <= targetWords + tolerance) {
      current += " " + sentence;
      currentWords += words;
    } else {
      result.push(current.trim());
      current = sentence;
      currentWords = words;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}
// ─────────────────────────────────────────────────────────────────────────────

type Step = "script" | "settings" | "progress";
type Phase = "idle" | "creating" | "assets" | "clips" | "merging" | "done" | "error";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "",
  creating: "Creating project & scenes...",
  assets: "Generating images & audio...",
  clips: "Generating video clips...",
  merging: "Merging final video...",
  done: "Done!",
  error: "Error",
};

const PHASE_ORDER: Phase[] = ["creating", "assets", "clips", "merging", "done"];

export default function VideoGen() {
  const navigate = useNavigate();
  const settings = loadProviderSettings();

  // step state
  const [step, setStep] = useState<Step>("script");

  // step 1 — script
  const [script, setScript] = useState("");
  const [splitMode, setSplitMode] = useState<"smart" | "exact" | "duration">("smart");
  const [targetWords, setTargetWords] = useState(80);

  // step 2 — settings
  const [title, setTitle] = useState("");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [stylePrompt, setStylePrompt] = useState("");

  // step 3 — progress
  const [phase, setPhase] = useState<Phase>("idle");
  const [phaseLabel, setPhaseLabel] = useState("");
  const [assetsProgress, setAssetsProgress] = useState(0);  // 0–100
  const [clipsProgress, setClipsProgress] = useState(0);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const abortRef = useRef(false);

  const scenes = useMemo(() => splitScript(script, targetWords), [script, targetWords]);

  // ── polling helpers ────────────────────────────────────────────────────────
  async function pollAssets(pid: string): Promise<void> {
    while (!abortRef.current) {
      const res = await fetch(`/api/projects/${pid}`).then(r => r.json()).catch(() => null);
      if (!res?.project) { await delay(3000); continue; }
      const { project, scenes: sceneList } = res;
      const total = sceneList?.length ?? 0;
      if (total > 0) {
        const imgDone = sceneList.filter((s: any) => s.image_status === "completed" || s.image_status === "failed").length;
        const audDone = sceneList.filter((s: any) => s.audio_status === "completed" || s.audio_status === "failed").length;
        const pct = Math.round(((imgDone + audDone) / (total * 2)) * 100);
        setAssetsProgress(pct);
        setPhaseLabel(`Images & audio: ${Math.round(pct)}%`);
        if (imgDone === total && audDone === total) return;
      }
      if (project.status === "completed" || project.status === "failed") return;
      await delay(3000);
    }
  }

  async function pollClips(pid: string): Promise<void> {
    while (!abortRef.current) {
      const s = await getClipStatus(pid).catch(() => null);
      if (!s) { await delay(2000); continue; }
      setClipsProgress(s.progress ?? 0);
      setPhaseLabel(`Clips: ${s.done ?? 0}/${s.total ?? "?"}`);
      if (s.status === "done") return;
      if (s.status === "failed") throw new Error(s.error ?? "Clip generation failed");
      await delay(2000);
    }
  }

  async function pollMerge(pid: string): Promise<void> {
    while (!abortRef.current) {
      const s = await getRenderStatus(pid).catch(() => null);
      if (!s) { await delay(2000); continue; }
      setMergeProgress(s.progress ?? 0);
      setPhaseLabel(`Merging: ${s.progress ?? 0}%`);
      if (s.status === "done") return;
      if (s.status === "failed") throw new Error(s.error ?? "Merge failed");
      await delay(2000);
    }
  }

  // ── main orchestration ─────────────────────────────────────────────────────
  async function handleGenerate() {
    abortRef.current = false;
    setStep("progress");
    setPhase("creating");
    setPhaseLabel("Creating project...");
    setErrorMsg("");
    setAssetsProgress(0);
    setClipsProgress(0);
    setMergeProgress(0);

    try {
      // 1. Create project + scenes
      const { projectId: pid } = await createProjectFrontend(
        title || "Untitled Video",
        script,
        null,
        null,
        { splitMode, stylePrompt: stylePrompt || undefined },
        {
          onPhase: (msg) => setPhaseLabel(msg),
          onSceneProgress: () => {},
          onStats: () => {},
        }
      );
      setProjectId(pid);

      // 2. Wait for images + audio
      setPhase("assets");
      setPhaseLabel("Generating images & audio...");
      await pollAssets(pid);
      if (abortRef.current) return;

      // 3. Generate clips
      setPhase("clips");
      setPhaseLabel("Starting clip generation...");
      await startClipGeneration(pid, resolution);
      await pollClips(pid);
      if (abortRef.current) return;

      // 4. Merge
      setPhase("merging");
      setPhaseLabel("Starting merge...");
      await startRender(pid, resolution);
      await pollMerge(pid);
      if (abortRef.current) return;

      setPhase("done");
      setPhaseLabel("Video ready!");
    } catch (e: any) {
      setPhase("error");
      setErrorMsg(e.message ?? "Unknown error");
    }
  }

  // ── phase progress bar value ───────────────────────────────────────────────
  function overallProgress(): number {
    if (phase === "creating") return 5;
    if (phase === "assets") return 5 + assetsProgress * 0.45;
    if (phase === "clips") return 50 + clipsProgress * 0.35;
    if (phase === "merging") return 85 + mergeProgress * 0.15;
    if (phase === "done") return 100;
    return 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {(["script", "settings", "progress"] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            <span className={`font-medium ${step === s ? "text-foreground" : "text-muted-foreground"}`}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </span>
        ))}
      </div>

      {/* ── Step 1: Script ── */}
      {step === "script" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Paste Your Script</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                className="min-h-[260px] font-mono text-sm"
                placeholder="Paste your full documentary script here..."
                value={script}
                onChange={e => setScript(e.target.value)}
              />
              <div className="space-y-1">
                <Label>Script Split Mode</Label>
                <Select value={splitMode} onValueChange={(v) => setSplitMode(v as "smart" | "exact" | "duration")}>
                  <SelectTrigger className="bg-secondary border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smart">Smart — 3 sentences per scene</SelectItem>
                    <SelectItem value="exact">Exact — 1 sentence per scene</SelectItem>
                    <SelectItem value="duration">Duration — adapts to speaking pace</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {splitMode === "smart" && (
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-1">
                    <Label>Words per scene: {targetWords}</Label>
                    <input
                      type="range" min={40} max={200} step={10}
                      value={targetWords}
                      onChange={e => setTargetWords(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground text-right shrink-0">
                    <span className="text-foreground font-medium">{scenes.length}</span> scenes
                    {script && <><br />{script.trim().match(/\S+/g)?.length ?? 0} words</>}
                  </div>
                </div>
              )}
              {splitMode !== "smart" && script && (
                <p className="text-sm text-muted-foreground">
                  ~{script.trim().match(/\S+/g)?.length ?? 0} words total · scenes determined by server at creation
                </p>
              )}
            </CardContent>
          </Card>

          {scenes.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Scene Preview</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {scenes.map((s, i) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <span className="shrink-0 text-muted-foreground w-6">{i + 1}.</span>
                      <span className="text-muted-foreground">{s}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button
              disabled={scenes.length === 0}
              onClick={() => setStep("settings")}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Settings ── */}
      {step === "settings" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Video Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  placeholder="My Documentary"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Resolution</Label>
                <div className="flex gap-2">
                  {(["480p", "720p"] as const).map(r => (
                    <Button
                      key={r}
                      size="sm"
                      variant={resolution === r ? "default" : "outline"}
                      onClick={() => setResolution(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Style Prompt (optional)</Label>
                <Input
                  placeholder="e.g. oil painting, dark cinematic, watercolor..."
                  value={stylePrompt}
                  onChange={e => setStylePrompt(e.target.value)}
                />
              </div>

              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
                <p>Using providers from Settings:</p>
                <p>Image: <span className="text-foreground">{settings.imageProvider || "whisk"}</span></p>
                <p>Voice: <span className="text-foreground">{settings.ttsProvider || "inworld"}</span></p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("script")}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={handleGenerate}>
              <Film className="mr-1 h-4 w-4" /> Generate Video
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Progress ── */}
      {step === "progress" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {phase === "done" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                {phase === "error" && <AlertTriangle className="h-5 w-5 text-destructive" />}
                {!["done", "error"].includes(phase) && <Loader2 className="h-5 w-5 animate-spin" />}
                {phase === "done" ? "Video Ready" : phase === "error" ? "Generation Failed" : "Generating Video..."}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {phase !== "error" && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{phaseLabel}</span>
                      <span>{Math.round(overallProgress())}%</span>
                    </div>
                    <Progress value={overallProgress()} />
                  </div>

                  <div className="space-y-3">
                    {PHASE_ORDER.map((p) => {
                      const idx = PHASE_ORDER.indexOf(p);
                      const curIdx = PHASE_ORDER.indexOf(phase === "done" ? "done" : phase);
                      const done = idx < curIdx || phase === "done";
                      const active = p === phase && phase !== "done";
                      return (
                        <div key={p} className={`flex items-center gap-2 text-sm ${done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground"}`}>
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : active ? (
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border border-muted-foreground/40 shrink-0" />
                          )}
                          <span>{PHASE_LABELS[p]}</span>
                          {active && p === "assets" && <span className="ml-auto text-muted-foreground">{assetsProgress}%</span>}
                          {active && p === "clips" && <span className="ml-auto text-muted-foreground">{clipsProgress}%</span>}
                          {active && p === "merging" && <span className="ml-auto text-muted-foreground">{mergeProgress}%</span>}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {phase === "error" && (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{errorMsg}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => { setStep("settings"); setPhase("idle"); }}>
                      Back to Settings
                    </Button>
                    {projectId && (
                      <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}/preview`)}>
                        <ExternalLink className="mr-1 h-4 w-4" /> Open Project
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {phase === "done" && projectId && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <a href={getRenderDownloadUrl(projectId)} download>
                    <Button>
                      <Download className="mr-1 h-4 w-4" /> Download MP4
                    </Button>
                  </a>
                  <Button variant="outline" onClick={() => navigate(`/projects/${projectId}/preview`)}>
                    <ExternalLink className="mr-1 h-4 w-4" /> View Project
                  </Button>
                  <Button variant="ghost" onClick={() => { setStep("script"); setPhase("idle"); setProjectId(null); setScript(""); }}>
                    New Video
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
