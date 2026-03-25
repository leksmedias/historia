import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Film, ChevronRight, ChevronLeft } from "lucide-react";
import { createProjectFrontend } from "@/lib/api";
import { loadProviderSettings, splitScriptIntoScenes, splitScriptByDuration } from "@/lib/providers";

type Step = "script" | "settings" | "creating";

export default function VideoGen() {
  const navigate = useNavigate();
  const settings = loadProviderSettings();

  const [step, setStep] = useState<Step>("script");
  const [script, setScript] = useState("");
  const [splitMode, setSplitMode] = useState<"smart" | "exact" | "duration">("smart");
  const [title, setTitle] = useState("");
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  const [stylePrompt, setStylePrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const scenes = useMemo(() => {
    if (!script.trim()) return [];
    if (splitMode === "duration") return splitScriptByDuration(script).map(s => s.script_text);
    return splitScriptIntoScenes(script, splitMode === "exact" ? "exact" : "smart").map(s => s.script_text);
  }, [script, splitMode]);

  async function handleGenerate() {
    setStep("creating");
    setCreating(true);
    setPhaseLabel("Generating scene manifest...");
    setErrorMsg("");
    try {
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
      // Server generates images + audio in background — safe to leave / close browser
      navigate(`/projects/${pid}`);
    } catch (e: any) {
      setStep("settings");
      setCreating(false);
      setErrorMsg(e.message ?? "Unknown error");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        {(["script", "settings", "creating"] as Step[]).map((s, i) => (
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

              {script && (
                <p className="text-sm text-muted-foreground">
                  <span className="text-foreground font-medium">{scenes.length}</span> scenes
                  {" · "}{script.trim().match(/\S+/g)?.length ?? 0} words total
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

          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("script")} disabled={creating}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={handleGenerate} disabled={creating}>
              {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Film className="mr-1 h-4 w-4" />}
              Generate Video
            </Button>
          </div>
        </div>
      )}

      {/* ── Creating spinner ── */}
      {step === "creating" && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{phaseLabel}</p>
            <p className="text-xs text-muted-foreground">You'll be taken to the project page automatically.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
