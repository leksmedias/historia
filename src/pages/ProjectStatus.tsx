import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getProject, getAssetUrl, getDownloadUrl, bulkRegenerateFailed, bulkRegeneratePending, bulkGenerateMissingAudio, checkAndFixImages, deleteProject, stopProject, resumeProject, runClientSidePipeline, startAnimateScenes, getAnimateStatus, type PipelineCallbacks } from "@/lib/api";
import type { Project, Scene } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import SceneCard from "@/components/SceneCard";
import Timeline from "@/components/Timeline";
import {
  ArrowLeft, Download, Image as ImageIcon, Volume2, AlertTriangle,
  CheckCircle2, Loader2, Scroll, RefreshCw, Play, Trash2, Square, RotateCw, ScanSearch,
} from "lucide-react";
import { toast } from "sonner";
import { loadProviderSettings } from "@/lib/providers";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    created: { label: "Created", className: "bg-info/20 text-info border-info/30" },
    processing: { label: "Processing", className: "bg-warning/20 text-warning border-warning/30" },
    completed: { label: "Completed", className: "bg-success/20 text-success border-success/30" },
    partial: { label: "Partial", className: "bg-warning/20 text-warning border-warning/30" },
    failed: { label: "Failed", className: "bg-destructive/20 text-destructive border-destructive/30" },
    stopped: { label: "Stopped", className: "bg-muted text-muted-foreground border-border" },
  };
  const s = map[status] || map.created;
  return <Badge className={s.className}>{s.label}</Badge>;
}

export default function ProjectStatus() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeScene, setActiveScene] = useState<number | undefined>();
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkRetryingAudio, setBulkRetryingAudio] = useState(false);
  const [bulkAudioProgress, setBulkAudioProgress] = useState({ done: 0, total: 0 });
  const [bulkGeneratingAudio, setBulkGeneratingAudio] = useState(false);
  const [bulkAudioGenerateProgress, setBulkAudioGenerateProgress] = useState({ done: 0, total: 0 });
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState({ done: 0, total: 0 });
  const [checkingImages, setCheckingImages] = useState(false);
  const [checkProgress, setCheckProgress] = useState({ done: 0, total: 0, bad: 0 });
  const [isResuming, setIsResuming] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [clientPipelineRunning, setClientPipelineRunning] = useState(false);
  const sceneRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const clientPipelineStarted = useRef(false);

  // Veo animation
  const [animatingScenes, setAnimatingScenes] = useState<Set<number>>(new Set());
  const [animatedScenes, setAnimatedScenes] = useState<Set<number>>(new Set());

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getProject(projectId);
      setProject(data.project);
      setScenes(data.scenes);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    // Keep refreshing while the pipeline is active OR while there's still incomplete work
    // (covers partial status where client-side retries are ongoing)
    const hasPending = scenes.some(
      s => s.image_status === "pending" || s.audio_status === "pending" ||
           s.image_status === "generating" || s.audio_status === "generating"
    );
    const isActive = project?.status === "processing" || project?.status === "created" || hasPending;
    if (!isActive) return;
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData, project?.status, scenes]);

  useEffect(() => {
    if (clientPipelineStarted.current) return;
    if (!project || !projectId) return;
    const isActive = project.status === "processing" || project.status === "created";
    if (!isActive) return;

    const stats = (project.stats as any) || {};
    const isServerPipeline = stats.serverPipeline === true;
    if (isServerPipeline) return;

    const hasPendingScenes = scenes.length > 0 && scenes.some(
      s => s.image_status === "pending" || s.audio_status === "pending"
    );
    if (!hasPendingScenes) return;

    const settings = loadProviderSettings();
    const canRunClient = settings.imageProvider !== "whisk" || !!settings.whiskCookie;
    if (!canRunClient) {
      toast.error("Whisk cookie not configured. Add it in Settings to generate images.");
      return;
    }

    clientPipelineStarted.current = true;
    setClientPipelineRunning(true);
    toast.info(`Starting generation for ${scenes.length} scenes...`);

    const callbacks: PipelineCallbacks = {
      onPhase: (phase) => console.log("[client-pipeline]", phase),
      onSceneProgress: () => {},
      onStats: () => {},
    };

    runClientSidePipeline(projectId, scenes as any, {}, callbacks)
      .then(() => {
        toast.success("Generation complete!");
        fetchData();
      })
      .catch((err: any) => {
        toast.error(`Generation failed: ${err.message}`);
      })
      .finally(() => setClientPipelineRunning(false));
  }, [project, projectId, scenes, fetchData]);

  const scrollToScene = (num: number) => {
    setActiveScene(num);
    sceneRefs.current[num]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const failedScenes = scenes.filter(s => s.image_status === "failed" || s.audio_status === "failed");
  const failedAudioScenes = scenes.filter(s => s.audio_status === "failed");
  const pendingAudioScenes = scenes.filter(s => s.audio_status !== "completed");
  const pendingImageScenes = scenes.filter(s => s.image_status !== "completed");
  const hasPendingWork = scenes.some(s => s.image_status === "pending" || s.audio_status === "pending" || s.image_status === "failed" || s.audio_status === "failed");

  const handleBulkRetry = async () => {
    if (!projectId) return;
    setBulkRetrying(true);
    setBulkProgress({ done: 0, total: failedScenes.length });
    try {
      await bulkRegenerateFailed(projectId, failedScenes, (done, total) => {
        setBulkProgress({ done, total });
        fetchData();
      });
    } finally {
      setBulkRetrying(false);
      fetchData();
    }
  };

  const handleBulkRetryAudio = async () => {
    if (!projectId) return;
    setBulkRetryingAudio(true);
    setBulkAudioProgress({ done: 0, total: failedAudioScenes.length });
    try {
      await bulkRegenerateFailed(projectId, failedAudioScenes, (done, total) => {
        setBulkAudioProgress({ done, total });
        fetchData();
      });
    } finally {
      setBulkRetryingAudio(false);
      fetchData();
    }
  };

  const handleGenerateMissingAudio = async () => {
    if (!projectId) return;
    setBulkGeneratingAudio(true);
    setBulkAudioGenerateProgress({ done: 0, total: pendingAudioScenes.length });
    try {
      await bulkGenerateMissingAudio(projectId, pendingAudioScenes, (done, total) => {
        setBulkAudioGenerateProgress({ done, total });
        fetchData();
      });
      toast.success("Missing audio generated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkGeneratingAudio(false);
      fetchData();
    }
  };

  const handleGeneratePending = async () => {
    if (!projectId) return;
    setBulkGenerating(true);
    setBulkGenerateProgress({ done: 0, total: pendingImageScenes.length });
    try {
      await bulkRegeneratePending(projectId, pendingImageScenes, (done, total) => {
        setBulkGenerateProgress({ done, total });
        fetchData();
      });
      toast.success("Images generated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBulkGenerating(false);
      fetchData();
    }
  };

  const handleCheckImages = async () => {
    if (!projectId) return;
    setCheckingImages(true);
    setCheckProgress({ done: 0, total: 0, bad: 0 });
    try {
      const bad = await checkAndFixImages(projectId, scenes, (done, total, bad) => {
        setCheckProgress({ done, total, bad });
      });
      if (bad > 0) {
        toast.warning(`Found ${bad} blank/missing image(s) — marked for regeneration.`);
      } else {
        toast.success("All images verified — no issues found.");
      }
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCheckingImages(false);
    }
  };

  const handleAnimate = async (sceneNumber: number) => {
    if (!projectId) return;
    const settings = loadProviderSettings();
    if (!settings.whiskCookie) { toast.error("Whisk cookie not configured in Settings"); return; }
    setAnimatingScenes(prev => new Set(prev).add(sceneNumber));
    try {
      await startAnimateScenes(projectId, [sceneNumber], settings.whiskCookie);
      // Poll until this scene's animation is done
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const s = await getAnimateStatus(projectId).catch(() => null);
        if (!s) continue;
        if (s.status === "done" || s.status === "idle") break;
      }
      setAnimatedScenes(prev => new Set(prev).add(sceneNumber));
      toast.success(`Scene ${sceneNumber} animated with Veo`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setAnimatingScenes(prev => { const n = new Set(prev); n.delete(sceneNumber); return n; });
    }
  };

  const handleDelete = async () => {
    if (!projectId) return;
    try {
      await deleteProject(projectId);
      toast.success("Project deleted");
      navigate("/projects");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleStop = async () => {
    if (!projectId) return;
    setIsStopping(true);
    try {
      await stopProject(projectId);
      toast.success("Project stopped");
      fetchData();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsStopping(false);
    }
  };

  const handleResume = async () => {
    if (!projectId) return;
    setIsResuming(true);
    const callbacks: PipelineCallbacks = {
      onPhase: (phase) => toast.info(phase),
      onSceneProgress: () => {},
      onStats: () => {},
    };
    try {
      await resumeProject(projectId, callbacks);
      toast.success("Processing complete");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsResuming(false);
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <p className="text-destructive">{error || "Project not found"}</p>
            <Link to="/"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = project.stats;
  const imgProgress = stats.sceneCount > 0 ? (stats.imagesCompleted / stats.sceneCount) * 100 : 0;
  const audioProgress = stats.sceneCount > 0 ? (stats.audioCompleted / stats.sceneCount) * 100 : 0;
  const canResume = (project.status === "stopped" || project.status === "partial" || project.status === "failed") && hasPendingWork;

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link to="/projects"><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
            <div>
              <div className="flex items-center gap-3">
                <Scroll className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-display text-foreground">{project.title}</h1>
                <StatusBadge status={project.status} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">Created {new Date(project.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Stop button */}
            {(project.status === "processing" || isResuming || clientPipelineRunning) && (
              <Button variant="outline" onClick={handleStop} disabled={isStopping}>
                {isStopping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Square className="h-4 w-4 mr-2" />}
                Stop
              </Button>
            )}
            {/* Resume button */}
            {canResume && !isResuming && (
              <Button variant="default" onClick={handleResume}>
                <RotateCw className="h-4 w-4 mr-2" />Resume
              </Button>
            )}
            {isResuming && (
              <Button variant="default" disabled>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Resuming...
              </Button>
            )}
            <Link to={`/projects/${project.id}/preview`}>
              <Button variant="default">
                <Play className="h-4 w-4 mr-2" />Preview
              </Button>
            </Link>
            <Button variant="outline" onClick={() => window.open(getDownloadUrl(project.id), "_blank")}>
              <Download className="h-4 w-4 mr-2" />Download ZIP
            </Button>
            {/* Delete button */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{project.title}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the project, all scenes, and all generated assets. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { value: stats.sceneCount, label: "Scenes", color: "text-primary" },
            { value: stats.imagesCompleted, label: "Images Done", color: "text-success" },
            { value: stats.audioCompleted, label: "Audio Done", color: "text-success" },
            { value: stats.needsReviewCount, label: "Needs Review", color: "text-destructive" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-display ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Progress */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <ImageIcon className="h-4 w-4 text-primary" /><span>Images</span>
                <span className="ml-auto text-muted-foreground">{stats.imagesCompleted}/{stats.sceneCount}</span>
              </div>
              <Progress value={imgProgress} className="h-2" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Volume2 className="h-4 w-4 text-primary" /><span>Audio</span>
                <span className="ml-auto text-muted-foreground">{stats.audioCompleted}/{stats.sceneCount}</span>
              </div>
              <Progress value={audioProgress} className="h-2" />
            </CardContent>
          </Card>
        </div>

        {/* Timeline */}
        <Card>
          <CardHeader><CardTitle className="text-lg font-display">Scene Timeline</CardTitle></CardHeader>
          <CardContent>
            <Timeline scenes={scenes} projectId={project.id} onSelectScene={scrollToScene} activeScene={activeScene} />
          </CardContent>
        </Card>

        {/* Style References */}
        <Card>
          <CardHeader><CardTitle className="text-lg font-display">Style References</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <img 
                src={getAssetUrl(project.id, "style", "style1.png")} 
                alt="Style Reference 1" 
                className="rounded-lg border border-border aspect-video object-cover bg-secondary"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} 
              />
              <img 
                src={getAssetUrl(project.id, "style", "style2.png")} 
                alt="Style Reference 2" 
                className="rounded-lg border border-border aspect-video object-cover bg-secondary" 
                onError={(e) => { e.currentTarget.style.display = 'none'; }} 
              />
            </div>
          </CardContent>
        </Card>

        <Separator />

        {/* Scenes */}
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xl font-display text-foreground">Scenes ({scenes.length})</h2>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={handleCheckImages}
                disabled={checkingImages || bulkGenerating || bulkRetrying || project.status === "processing"}
                className="text-sm"
              >
                {checkingImages ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking {checkProgress.done}/{checkProgress.total}{checkProgress.bad > 0 ? ` (${checkProgress.bad} bad)` : ""}</>
                ) : (
                  <><ScanSearch className="h-4 w-4 mr-2" /> Check All Images</>
                )}
              </Button>
              {pendingImageScenes.length > 0 && (
                <Button
                  variant="default"
                  onClick={handleGeneratePending}
                  disabled={bulkGenerating || bulkRetrying || checkingImages || project.status === "processing"}
                  className="text-sm"
                >
                  {bulkGenerating ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating {bulkGenerateProgress.done}/{bulkGenerateProgress.total}</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" /> Generate All Missing Images ({pendingImageScenes.length})</>
                  )}
                </Button>
              )}
              {failedScenes.length > 0 && (
                <Button variant="outline" onClick={handleBulkRetry} disabled={bulkRetrying || project.status === "processing"} className="text-sm">
                  {bulkRetrying ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Retrying {bulkProgress.done}/{bulkProgress.total}</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" /> Retry All Failed ({failedScenes.length})</>
                  )}
                </Button>
              )}
              {failedAudioScenes.length > 0 && (
                <Button variant="outline" onClick={handleBulkRetryAudio} disabled={bulkRetryingAudio || bulkGeneratingAudio || project.status === "processing"} className="text-sm">
                  {bulkRetryingAudio ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Retrying Audio {bulkAudioProgress.done}/{bulkAudioProgress.total}</>
                  ) : (
                    <><Volume2 className="h-4 w-4 mr-2" /> Retry Failed Audio ({failedAudioScenes.length})</>
                  )}
                </Button>
              )}
              {pendingAudioScenes.length > 0 && failedAudioScenes.length < pendingAudioScenes.length && (
                <Button variant="outline" onClick={handleGenerateMissingAudio} disabled={bulkGeneratingAudio || bulkRetryingAudio || project.status === "processing"} className="text-sm">
                  {bulkGeneratingAudio ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating Audio {bulkAudioGenerateProgress.done}/{bulkAudioGenerateProgress.total}</>
                  ) : (
                    <><Volume2 className="h-4 w-4 mr-2" /> Generate Missing Audio ({pendingAudioScenes.length - failedAudioScenes.length})</>
                  )}
                </Button>
              )}
            </div>
          </div>
          {scenes.length === 0 && project.status === "processing" && (
            <Card>
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
                <p className="text-muted-foreground">Generating scene manifest...</p>
              </CardContent>
            </Card>
          )}
          {scenes.map((scene) => (
            <div key={scene.scene_number} ref={(el) => { sceneRefs.current[scene.scene_number] = el; }}>
              <SceneCard
                scene={scene}
                projectId={project.id}
                onRefresh={fetchData}
                onAnimate={handleAnimate}
                isAnimating={animatingScenes.has(scene.scene_number)}
                isAnimated={animatedScenes.has(scene.scene_number)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
