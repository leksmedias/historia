import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ImageIcon, Volume2, RefreshCw, Video, Film } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface ErrorEntry {
  id: string;
  project_id: string;
  project_title: string;
  scene_number: number | null;
  type: "image" | "audio" | "video" | "render";
  render_job_type?: "clip" | "merge" | "animate" | "auto";
  resolution?: string;
  error: string;
  attempts: number;
  updated_at: string;
}

interface ProjectGroup {
  project_id: string;
  project_title: string;
  errors: ErrorEntry[];
}

async function retryError(entry: ErrorEntry): Promise<void> {
  if (entry.type === "render") {
    const urls: Record<string, string> = {
      clip: `/api/render/${entry.project_id}/clips`,
      merge: `/api/render/${entry.project_id}`,
      auto: `/api/render/${entry.project_id}/auto`,
      animate: `/api/render/${entry.project_id}/animate`,
    };
    const url = urls[entry.render_job_type ?? "merge"];
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: entry.resolution || "720p" }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    return;
  }
  if (entry.type === "video") {
    const res = await fetch(`/api/render/${entry.project_id}/animate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenes: [entry.scene_number] }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  } else {
    const res = await fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: entry.project_id,
        sceneNumber: entry.scene_number,
        type: entry.type,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
  }
}

export default function ErrorLog() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio" | "video" | "render">("all");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  const fetchErrors = async () => {
    setLoading(true);
    try {
      const [allProjects, renderFails]: [any[], any[]] = await Promise.all([
        fetch("/api/projects").then(r => r.json()),
        fetch("/api/render/failures").then(r => r.json()).catch(() => []),
      ]);
      const entries: ErrorEntry[] = [];

      for (const proj of allProjects) {
        const { scenes } = await fetch(`/api/projects/${proj.id}`).then(r => r.json());
        for (const s of (scenes || [])) {
          if (s.image_status === "failed" && s.image_error) {
            entries.push({
              id: `${s.id}-img`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "image",
              error: s.image_error,
              attempts: s.image_attempts,
              updated_at: s.updated_at,
            });
          }
          if (s.audio_status === "failed" && s.audio_error) {
            entries.push({
              id: `${s.id}-aud`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "audio",
              error: s.audio_error,
              attempts: s.audio_attempts,
              updated_at: s.updated_at,
            });
          }
          if (s.video_status === "failed" && s.video_error) {
            entries.push({
              id: `${s.id}-vid`,
              project_id: s.project_id,
              project_title: proj.title,
              scene_number: s.scene_number,
              type: "video",
              error: s.video_error,
              attempts: 1,
              updated_at: s.updated_at,
            });
          }
        }
      }

      for (const r of (Array.isArray(renderFails) ? renderFails : [])) {
        if (r.error) {
          entries.push({
            id: r.id,
            project_id: r.project_id,
            project_title: r.project_title,
            scene_number: null,
            type: "render",
            render_job_type: r.type,
            resolution: r.resolution,
            error: r.error,
            attempts: 1,
            updated_at: r.updated_at,
          });
        }
      }

      entries.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      setErrors(entries);
    } catch (e) {
      console.error("Failed to fetch errors:", e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchErrors(); }, []);

  const filtered = filter === "all" ? errors : errors.filter(e => e.type === filter);

  const groups: ProjectGroup[] = Object.values(
    filtered.reduce<Record<string, ProjectGroup>>((acc, e) => {
      if (!acc[e.project_id]) {
        acc[e.project_id] = { project_id: e.project_id, project_title: e.project_title, errors: [] };
      }
      acc[e.project_id].errors.push(e);
      return acc;
    }, {})
  );

  const defaultOpen = filtered.length <= 10 ? groups.map(g => g.project_id) : [];

  const imageFails = errors.filter(e => e.type === "image").length;
  const audioFails = errors.filter(e => e.type === "audio").length;
  const videoFails = errors.filter(e => e.type === "video").length;
  const renderFails = errors.filter(e => e.type === "render").length;

  const handleRetry = async (entry: ErrorEntry) => {
    setRetrying(prev => new Set(prev).add(entry.id));
    try {
      await retryError(entry);
      setErrors(prev => prev.filter(e => e.id !== entry.id));
      toast.success(
        entry.type === "render"
          ? `Queued retry for ${RENDER_JOB_LABELS[entry.render_job_type ?? ""] ?? entry.render_job_type}`
          : `Queued retry for scene ${entry.scene_number}`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRetrying(prev => { const n = new Set(prev); n.delete(entry.id); return n; });
    }
  };

  const RENDER_JOB_LABELS: Record<string, string> = {
    clip: "Clip Generation",
    merge: "Merge / Export",
    auto: "Auto Pipeline",
    animate: "Animation",
  };

  const typeIcon = (type: ErrorEntry["type"]) => {
    if (type === "image") return <ImageIcon className="h-3 w-3 mr-1" />;
    if (type === "audio") return <Volume2 className="h-3 w-3 mr-1" />;
    if (type === "render") return <Film className="h-3 w-3 mr-1" />;
    return <Video className="h-3 w-3 mr-1" />;
  };

  const typeVariant = (type: ErrorEntry["type"]): "secondary" | "outline" => {
    return type === "image" ? "secondary" : "outline";
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Error Log</h1>
          <p className="text-sm text-muted-foreground">Failed asset generations across all projects</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchErrors} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-2xl font-bold text-foreground">{errors.length}</p>
              <p className="text-xs text-muted-foreground">Total Errors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ImageIcon className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{imageFails}</p>
              <p className="text-xs text-muted-foreground">Image Failures</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{audioFails}</p>
              <p className="text-xs text-muted-foreground">Audio Failures</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Video className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{videoFails}</p>
              <p className="text-xs text-muted-foreground">Video Failures</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Film className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-2xl font-bold text-foreground">{renderFails}</p>
              <p className="text-xs text-muted-foreground">Render Failures</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="image">Images only</SelectItem>
            <SelectItem value="audio">Audio only</SelectItem>
            <SelectItem value="video">Video only</SelectItem>
            <SelectItem value="render">Render only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Accordion grouped by project */}
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No errors found 🎉</p>
      ) : (
        <Accordion type="multiple" defaultValue={defaultOpen} className="space-y-2">
          {groups.map(group => (
            <AccordionItem key={group.project_id} value={group.project_id} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-foreground">{group.project_title}</span>
                  <Badge variant="destructive" className="text-xs">{group.errors.length} error{group.errors.length !== 1 ? "s" : ""}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 pb-2">
                  {group.errors.map(e => (
                    <div key={e.id} className="flex items-start gap-3 bg-secondary rounded px-3 py-2">
                      <div className="shrink-0 pt-0.5">
                        <Badge variant={typeVariant(e.type)} className="text-xs">
                          {typeIcon(e.type)}{e.type}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                          {e.type === "render"
                            ? <span>{RENDER_JOB_LABELS[e.render_job_type ?? ""] ?? e.render_job_type}</span>
                            : <span>Scene #{e.scene_number}</span>
                          }
                          <span>·</span>
                          <span>{e.attempts} attempt{e.attempts !== 1 ? "s" : ""}</span>
                          <span>·</span>
                          <span>{format(new Date(e.updated_at), "MMM d, HH:mm")}</span>
                        </div>
                        <p className="text-xs text-destructive font-mono truncate" title={e.error}>{e.error}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-xs"
                        disabled={retrying.has(e.id)}
                        onClick={() => handleRetry(e)}
                      >
                        {retrying.has(e.id) ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          "Retry"
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
