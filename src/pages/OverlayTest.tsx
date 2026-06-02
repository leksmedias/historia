import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Upload, Play, RotateCcw } from "lucide-react";

interface OverlayScene {
  start: number;
  duration: number;
  text: string;
}

const DEFAULT_SCENES: OverlayScene[] = [
  { start: 0.3,  duration: 1.2, text: "September 1918" },
  { start: 5.0,  duration: 1.8, text: "The Middle East" },
  { start: 10.0, duration: 2.0, text: "Three Armies Converge" },
  { start: 16.0, duration: 2.5, text: "The Fall of Damascus" },
  { start: 22.0, duration: 1.5, text: "An Empire in Ruins" },
];

function computeActiveText(scenes: OverlayScene[], currentTime: number): string {
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const next = scenes[i + 1];
    if (currentTime < scene.start) continue;
    if (next && currentTime >= next.start) continue;

    const elapsed = currentTime - scene.start;
    const totalLen = scene.text.length;
    if (elapsed >= scene.duration) return scene.text;
    const chars = Math.max(0, Math.floor((elapsed / scene.duration) * totalLen));
    return scene.text.slice(0, chars);
  }
  return "";
}

export default function OverlayTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const whooshRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneRef = useRef<number>(-1);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [activeText, setActiveText] = useState("");
  const [scenes, setScenes] = useState<OverlayScene[]>(DEFAULT_SCENES);
  const [jsonText, setJsonText] = useState(JSON.stringify(DEFAULT_SCENES, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    setVideoSrc(URL.createObjectURL(file));
    setActiveText("");
    lastSceneRef.current = -1;
  };

  const playWhoosh = () => {
    if (!whooshRef.current) {
      whooshRef.current = new Audio("/sfx/whoosh.MP3");
      whooshRef.current.volume = 0.4;
    }
    whooshRef.current.currentTime = 0;
    whooshRef.current.play().catch(() => {});
  };

  const handleTimeUpdate = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0;
    const text = computeActiveText(scenes, t);
    setActiveText(text);

    // Detect scene transition — play whoosh when a new scene's text first appears
    const activeIdx = scenes.findIndex((s, i) => {
      const next = scenes[i + 1];
      return t >= s.start && (!next || t < next.start);
    });
    if (activeIdx !== -1 && activeIdx !== lastSceneRef.current) {
      lastSceneRef.current = activeIdx;
      if (text.length > 0) playWhoosh();
    } else if (activeIdx === -1) {
      lastSceneRef.current = -1;
    }
  }, [scenes]);

  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) throw new Error("Must be an array");
      setScenes(parsed);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  const resetScenes = () => {
    setScenes(DEFAULT_SCENES);
    setJsonText(JSON.stringify(DEFAULT_SCENES, null, 2));
    setJsonError(null);
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-display tracking-wide text-foreground">
            Overlay Test
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick any video to preview the typewriter text overlay. Timings sync to the video's{" "}
            <code className="font-mono text-xs">currentTime</code> — scrubbing, pausing, and rewinding all work.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video area — 2/3 width */}
          <div className="lg:col-span-2 space-y-3">
            {/* Video picker */}
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
                <span className="text-sm text-muted-foreground">Click to upload a test video</span>
                <span className="text-xs text-muted-foreground/60">MP4, MOV, WebM — any length</span>
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

                {/* Overlay */}
                {activeText && (
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
                      {activeText}
                      <span
                        style={{
                          fontWeight: 100,
                          animation: "overlayBlink 0.75s infinite",
                          marginLeft: "2px",
                          opacity: 0,
                        }}
                      >
                        |
                      </span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {videoSrc && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Change video
              </Button>
            )}
          </div>

          {/* Config panel — 1/3 width */}
          <div className="space-y-4">
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground flex items-center justify-between">
                  Overlay Scenes JSON
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={resetScenes}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <code className="font-mono">start</code>: seconds into video<br />
                  <code className="font-mono">duration</code>: typewriter animation length (s)<br />
                  <code className="font-mono">text</code>: text to display
                </p>

                <Textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="bg-secondary border-border font-mono text-xs min-h-[260px] resize-none"
                  spellCheck={false}
                />

                {jsonError && (
                  <p className="text-xs text-destructive">{jsonError}</p>
                )}

                <Button
                  size="sm"
                  className="w-full text-xs"
                  onClick={applyJson}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Apply
                </Button>
              </CardContent>
            </Card>

            {/* Active scene indicator */}
            <Card className="border-border/50">
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                  Live overlay
                </p>
                <div className="min-h-[2rem] flex items-center">
                  {activeText ? (
                    <Badge variant="secondary" className="font-mono text-xs max-w-full truncate">
                      {activeText}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground/50 italic">none</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-lg bg-secondary/40 border border-border/30">
              <p className="font-medium text-foreground/70">How it works in production</p>
              <p>Scene timecodes come from summing audio file durations. Each scene's <code className="font-mono">overlay_text</code> from the JSON import becomes the typed text.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Blink keyframe injected inline */}
      <style>{`
        @keyframes overlayBlink {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
