import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getProjects, deleteProject } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    created: { label: "Created", className: "bg-info/20 text-info border-info/30" },
    processing: { label: "Generating", className: "bg-warning/20 text-warning border-warning/30" },
    completed: { label: "Completed", className: "bg-success/20 text-success border-success/30" },
    partial: { label: "Partial", className: "bg-warning/20 text-warning border-warning/30" },
    failed: { label: "Failed", className: "bg-destructive/20 text-destructive border-destructive/30" },
    stopped: { label: "Stopped", className: "bg-muted text-muted-foreground border-border" },
  };
  const s = map[status] || map.created;
  return <Badge className={s.className}>{s.label}</Badge>;
}

function ProjectProgress({ p }: { p: Project }) {
  const total = (p.stats.sceneCount || 0) * 2;
  const done = (p.stats.imagesCompleted || 0) + (p.stats.audioCompleted || 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="animate-pulse">Generating...</span>
        <span>{p.stats.imagesCompleted}/{p.stats.sceneCount} images</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await getProjects();
      setProjects(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    const hasProcessing = projects.some(p => p.status === "processing" || p.status === "created");
    if (!hasProcessing) return;
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, [projects, fetchProjects]);

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(projectId);
    try {
      await deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      toast.success("Project deleted");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-12 max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-display text-foreground">Projects</h1>
      {projects.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No projects yet. Create one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div key={p.id} className="relative">
              <Link to={`/projects/${p.id}`} className="block h-full">
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between">
                      <h3 className="font-display text-foreground font-medium truncate">{p.title}</h3>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={p.status} />
                        <div className="h-7 w-7" />
                      </div>
                    </div>
                    {(p.status === "processing" || p.status === "created") ? (
                      <ProjectProgress p={p} />
                    ) : (
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{p.stats.sceneCount} scenes</span>
                        <span>{p.stats.imagesCompleted} images</span>
                        <span>{p.stats.audioCompleted} audio</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
              <div className="absolute top-5 right-5">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      {deleting === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{p.title}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the project, all scenes, and all generated assets. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={(e) => handleDelete(e, p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
