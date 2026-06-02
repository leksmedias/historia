import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Upload, Play, RotateCcw, Square, ChevronRight, Film } from "lucide-react";

// ─── Video mode types ──────────────────────────────────────────────────────────

interface OverlayScene {
  start: number;
  duration: number;
  text: string;
}

const DEFAULT_VIDEO_SCENES: OverlayScene[] = [
  { start: 0.3,  duration: 1.2, text: "September 1918" },
  { start: 5.0,  duration: 1.8, text: "The Middle East" },
  { start: 10.0, duration: 2.0, text: "Three Armies Converge" },
  { start: 16.0, duration: 2.5, text: "The Fall of Damascus" },
  { start: 22.0, duration: 1.5, text: "An Empire in Ruins" },
];

const OVERLAY_VISIBLE_SECS = 4; // overlay clears 4 seconds after its start

function computeActiveText(scenes: OverlayScene[], t: number): string {
  for (const scene of scenes) {
    if (t < scene.start) continue;
    if (t > scene.start + OVERLAY_VISIBLE_SECS) continue; // past the visible window
    const elapsed = t - scene.start;
    if (elapsed >= scene.duration) return scene.text;
    const chars = Math.max(0, Math.floor((elapsed / scene.duration) * scene.text.length));
    return scene.text.slice(0, chars);
  }
  return "";
}

// ─── JSON preview mode types ───────────────────────────────────────────────────

interface RawScene {
  script?: string;
  narration_text?: string;
  overlay_text?: string | null;
  image?: string;
  prompt?: string;
  visual_prompt?: string;
}

interface PreviewScene {
  script: string;
  overlayText: string | null;
  image: string | null;
  prompt: string;
}

const EXAMPLE_JSON = `{
  "title": "Siege of Rhodes (1522)",
  "scenes": [
    {
      "image": "1.png",
      "script": "July, 1522. The island of Rhodes.",
      "prompt": "Wide shot of Rhodes city walls at dawn.",
      "overlay_text": "Rhodes 1522"
    },
    {
      "image": "2.png",
      "script": "The Eastern Mediterranean.",
      "prompt": "Parchment map of the Eastern Mediterranean.",
      "overlay_text": "Eastern Mediterranean"
    },
    {
      "image": "3.png",
      "script": "The walls are coming down.",
      "prompt": "Crumbling city walls, black powder smoke.",
      "overlay_text": null
    },
    {
      "image": "4.png",
      "script": "Not collapsing on their own. Being eaten.",
      "prompt": "Ottoman sappers tunneling beneath foundations.",
      "overlay_text": null
    },
    {
      "image": "5.png",
      "script": "Systematically, methodically, from below and outside simultaneously — the largest siege the Ottoman Empire has ever mounted.",
      "prompt": "Massive Ottoman siege operation, hundreds of soldiers.",
      "overlay_text": "Ottoman 100K"
    }
  ]
}`;

function parseSceneJson(raw: string): PreviewScene[] | null {
  try {
    let parsed = JSON.parse(raw);
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.scenes)) {
      parsed = parsed.scenes;
    }
    if (!Array.isArray(parsed)) return null;
    return parsed.map((s: RawScene) => ({
      script: (s.script || s.narration_text || "").trim(),
      overlayText: s.overlay_text ?? null,
      image: s.image ?? null,
      prompt: (s.prompt || s.visual_prompt || "").trim(),
    })).filter((s: PreviewScene) => s.script);
  } catch {
    return null;
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

type Mode = "video" | "json";

export default function OverlayTest() {
  const [mode, setMode] = useState<Mode>("json");

  // ── Video mode state ────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [activeVideoText, setActiveVideoText] = useState("");
  const [videoScenes, setVideoScenes] = useState<OverlayScene[]>(DEFAULT_VIDEO_SCENES);
  const [videoScenesJson, setVideoScenesJson] = useState(JSON.stringify(DEFAULT_VIDEO_SCENES, null, 2));
  const [videoJsonError, setVideoJsonError] = useState<string | null>(null);
  const lastVideoSceneRef = useRef<number>(-1);

  // ── JSON preview state ──────────────────────────────────────────────────────
  const [jsonInput, setJsonInput] = useState(EXAMPLE_JSON);
  const [previewScenes, setPreviewScenes] = useState<PreviewScene[]>(() => parseSceneJson(EXAMPLE_JSON) ?? []);
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [typedChars, setTypedChars] = useState(0);
  const [fullOverlay, setFullOverlay] = useState<string | null>(null);
  const currentIdxRef = useRef(-1);
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Shared audio ────────────────────────────────────────────────────────────
  const whooshRef = useRef<HTMLAudioElement | null>(null);

  const playWhoosh = () => {
    if (!whooshRef.current) {
      whooshRef.current = new Audio("/sfx/whoosh.MP3");
      whooshRef.current.volume = 0.4;
    }
    whooshRef.current.currentTime = 0;
    whooshRef.current.play().catch(() => {});
  };

  // ── JSON parse on input change ──────────────────────────────────────────────
  const handleJsonChange = (val: string) => {
    setJsonInput(val);
    const parsed = parseSceneJson(val);
    if (parsed) {
      setPreviewScenes(parsed);
      setJsonParseError(null);
    } else {
      setJsonParseError("Invalid JSON — check format");
    }
  };

  // ── Typewriter helper ───────────────────────────────────────────────────────
  const startTypewriter = (text: string) => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    setFullOverlay(text);
    setTypedChars(0);
    playWhoosh();
    const total = text.length;
    const delay = Math.max(30, Math.min(80, 1400 / total)); // 30–80ms per char
    let i = 0;
    typeTimerRef.current = setInterval(() => {
      i++;
      setTypedChars(i);
      if (i >= total && typeTimerRef.current) {
        clearInterval(typeTimerRef.current);
        typeTimerRef.current = null;
      }
    }, delay);
  };

  const clearTypewriter = () => {
    if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    typeTimerRef.current = null;
    setFullOverlay(null);
    setTypedChars(0);
  };

  // ── JSON preview play ───────────────────────────────────────────────────────
  const playScene = useCallback((idx: number) => {
    if (idx >= previewScenes.length || currentIdxRef.current === -2) {
      setIsPlaying(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
      clearTypewriter();
      return;
    }

    const scene = previewScenes[idx];
    currentIdxRef.current = idx;
    setCurrentIdx(idx);
    clearTypewriter();

    if (scene.overlayText) {
      startTypewriter(scene.overlayText);
      // Auto-clear overlay after 4 seconds regardless of scene length
      setTimeout(() => {
        if (currentIdxRef.current === idx) {
          if (typeTimerRef.current) clearInterval(typeTimerRef.current);
          typeTimerRef.current = null;
          setFullOverlay(null);
          setTypedChars(0);
        }
      }, OVERLAY_VISIBLE_SECS * 1000);
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(scene.script);
    utter.rate = 0.88;
    utter.pitch = 0.95;

    utter.onend = () => {
      if (currentIdxRef.current === -2) return; // stopped
      setTimeout(() => {
        if (currentIdxRef.current === -2) return;
        playScene(idx + 1);
      }, 600);
    };

    window.speechSynthesis.speak(utter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewScenes]);

  const handlePlay = () => {
    if (previewScenes.length === 0) return;
    currentIdxRef.current = 0;
    setIsPlaying(true);
    playScene(0);
  };

  const handleStop = () => {
    currentIdxRef.current = -2;
    window.speechSynthesis.cancel();
    clearTypewriter();
    setIsPlaying(false);
    setCurrentIdx(-1);
  };

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      if (typeTimerRef.current) clearInterval(typeTimerRef.current);
    };
  }, []);

  // ── Video mode handlers ─────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    setVideoSrc(URL.createObjectURL(file));
    setActiveVideoText("");
    lastVideoSceneRef.current = -1;
  };

  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    const text = computeActiveText(videoScenes, t);
    setActiveVideoText(text);

    const activeIdx = videoScenes.findIndex((s, i) => {
      const next = videoScenes[i + 1];
      return t >= s.start && (!next || t < next.start);
    });
    if (activeIdx !== -1 && activeIdx !== lastVideoSceneRef.current) {
      lastVideoSceneRef.current = activeIdx;
      if (text.length > 0) playWhoosh();
    } else if (activeIdx === -1) {
      lastVideoSceneRef.current = -1;
    }
  }, [videoScenes]);

  const applyVideoJson = () => {
    try {
      const parsed = JSON.parse(videoScenesJson);
      if (!Array.isArray(parsed)) throw new Error("Must be an array");
      setVideoScenes(parsed);
      setVideoJsonError(null);
    } catch (e: any) {
      setVideoJsonError(e.message);
    }
  };

  // ── Overlay text for JSON mode ──────────────────────────────────────────────
  const displayedOverlay = fullOverlay ? fullOverlay.slice(0, typedChars) : "";
  const showCursor = fullOverlay ? typedChars < fullOverlay.length : false;

  // ── Current scene for JSON mode bg ─────────────────────────────────────────
  const currentScene = currentIdx >= 0 ? previewScenes[currentIdx] : null;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-display tracking-wide text-foreground flex items-center gap-2">
            <Film className="h-6 w-6 text-primary" />
            Overlay Test
          </h1>
          <p className="text-sm text-muted-foreground">
            Preview typewriter text overlays against your scene JSON or a rendered video file.
          </p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
          {(["json", "video"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "json" ? "JSON Preview" : "Video File"}
            </button>
          ))}
        </div>

        {/* ── JSON PREVIEW MODE ── */}
        {mode === "json" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Preview canvas */}
            <div className="lg:col-span-2 space-y-3">
              {/* Cinematic stage */}
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black shadow-2xl">
                {/* Scene background */}
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center"
                  style={{
                    background: "linear-gradient(160deg, #0f0f1a 0%, #1a1208 50%, #0a0a0f 100%)",
                  }}
                >
                  {!isPlaying && currentIdx === -1 ? (
                    <div className="text-center space-y-3 opacity-40">
                      <Play className="h-10 w-10 mx-auto text-white" />
                      <p className="text-white text-sm font-mono tracking-widest uppercase">
                        Press Play to Preview
                      </p>
                    </div>
                  ) : currentScene ? (
                    <div className="px-8 text-center space-y-2">
                      <p className="text-white/20 text-[10px] font-mono uppercase tracking-widest">
                        Scene {currentIdx + 1} of {previewScenes.length}
                      </p>
                      <p className="text-white/50 text-sm italic leading-relaxed max-w-md">
                        {currentScene.script}
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Cinematic bars */}
                <div className="absolute top-0 inset-x-0 h-[7%] bg-black" />
                <div className="absolute bottom-0 inset-x-0 h-[7%] bg-black" />

                {/* Typewriter overlay */}
                {displayedOverlay && (
                  <div
                    className="absolute pointer-events-none select-none"
                    style={{ left: "5%", bottom: "14%", right: "5%" }}
                  >
                    <span
                      style={{
                        fontFamily: "'Courier New', Courier, monospace",
                        fontWeight: "bold",
                        fontSize: "clamp(1.4rem, 4.5vw, 3rem)",
                        color: "#ffffff",
                        textShadow: "3px 3px 0 rgba(0,0,0,0.95), -1px -1px 0 rgba(0,0,0,0.6)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      {displayedOverlay}
                      {showCursor && (
                        <span style={{ fontWeight: 100, marginLeft: 2, animation: "overlayBlink 0.75s infinite" }}>|</span>
                      )}
                    </span>
                  </div>
                )}

                {/* Scene progress bar */}
                {isPlaying && previewScenes.length > 0 && (
                  <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${((currentIdx + 1) / previewScenes.length) * 100}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3">
                {!isPlaying ? (
                  <Button
                    onClick={handlePlay}
                    disabled={previewScenes.length === 0}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Play Preview
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={handleStop} className="gap-2">
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                )}

                {/* Scene pills */}
                <div className="flex gap-1.5 flex-wrap">
                  {previewScenes.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        if (!isPlaying) {
                          handleStop();
                          setTimeout(() => {
                            currentIdxRef.current = i;
                            setIsPlaying(true);
                            playScene(i);
                          }, 50);
                        }
                      }}
                      className={`w-6 h-6 rounded-full text-[10px] font-mono font-bold transition-colors ${
                        i === currentIdx
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:bg-primary/20"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>

                {currentIdx >= 0 && !isPlaying && (
                  <Badge variant="outline" className="text-xs font-mono ml-auto">
                    Scene {currentIdx + 1} done
                  </Badge>
                )}
              </div>
            </div>

            {/* JSON panel */}
            <div className="space-y-4">
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Scene JSON
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Paste your full scene JSON. Fields used:{" "}
                    <code className="font-mono">script</code> (speech),{" "}
                    <code className="font-mono">overlay_text</code> (typed title).
                  </p>
                  <Textarea
                    value={jsonInput}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    className="bg-secondary border-border font-mono text-xs min-h-[300px] resize-none"
                    spellCheck={false}
                  />
                  {jsonParseError && (
                    <p className="text-xs text-destructive">{jsonParseError}</p>
                  )}
                  {!jsonParseError && previewScenes.length > 0 && (
                    <p className="text-xs text-success">
                      {previewScenes.length} scene{previewScenes.length !== 1 ? "s" : ""} ready
                      {" · "}
                      {previewScenes.filter(s => s.overlayText).length} with overlays
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Overlay legend */}
              <Card className="border-border/50">
                <CardContent className="pt-4 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Overlay map
                  </p>
                  <div className="space-y-1">
                    {previewScenes.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-mono font-bold shrink-0 ${
                          i === currentIdx ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                        }`}>
                          {i + 1}
                        </span>
                        {s.overlayText ? (
                          <span className="font-mono text-foreground/80 truncate">{s.overlayText}</span>
                        ) : (
                          <span className="text-muted-foreground/50 italic">no overlay</span>
                        )}
                        {i === currentIdx && (
                          <ChevronRight className="h-3 w-3 text-primary ml-auto shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ── VIDEO FILE MODE ── */}
        {mode === "video" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {!videoSrc ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full aspect-video rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/40 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer"
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Click to upload a rendered video</span>
                </button>
              ) : (
                <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black shadow-2xl">
                  <video
                    ref={videoRef}
                    src={videoSrc}
                    controls
                    onTimeUpdate={handleTimeUpdate}
                    className="w-full h-full object-contain"
                  />
                  {activeVideoText && (
                    <div
                      className="absolute pointer-events-none select-none"
                      style={{ left: "5%", bottom: "18%", right: "5%" }}
                    >
                      <span
                        style={{
                          fontFamily: "'Courier New', Courier, monospace",
                          fontWeight: "bold",
                          fontSize: "clamp(1.2rem, 4vw, 2.8rem)",
                          color: "#ffffff",
                          textShadow: "3px 3px 0 rgba(0,0,0,0.9), -1px -1px 0 rgba(0,0,0,0.5)",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {activeVideoText}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {videoSrc && (
                <Button variant="outline" size="sm" className="text-xs" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Change video
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-foreground flex items-center justify-between">
                    Timed Overlays
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                      setVideoScenes(DEFAULT_VIDEO_SCENES);
                      setVideoScenesJson(JSON.stringify(DEFAULT_VIDEO_SCENES, null, 2));
                      setVideoJsonError(null);
                    }}>
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Reset
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    <code className="font-mono">start</code>: seconds · <code className="font-mono">duration</code>: type speed · <code className="font-mono">text</code>: overlay
                  </p>
                  <Textarea
                    value={videoScenesJson}
                    onChange={(e) => setVideoScenesJson(e.target.value)}
                    className="bg-secondary border-border font-mono text-xs min-h-[260px] resize-none"
                    spellCheck={false}
                  />
                  {videoJsonError && <p className="text-xs text-destructive">{videoJsonError}</p>}
                  <Button size="sm" className="w-full text-xs" onClick={applyVideoJson}>
                    Apply
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardContent className="pt-4 space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Live overlay</p>
                  <div className="min-h-[2rem] flex items-center">
                    {activeVideoText ? (
                      <Badge variant="secondary" className="font-mono text-xs max-w-full truncate">{activeVideoText}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/50 italic">none</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes overlayBlink {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
