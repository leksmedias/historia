import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAssetUrl, regenerateAssetFrontend, splitScene, deleteScene } from "@/lib/api";
import { getAvailableVoices, loadProviderSettings } from "@/lib/providers";
import type { Scene } from "@/lib/types";
import AudioPlayer from "@/components/AudioPlayer";
import SplitSceneDialog from "@/components/SplitSceneDialog";
import {
  Image as ImageIcon, Volume2, RefreshCw, AlertTriangle, CheckCircle2,
  Clock, Copy, Loader2, Pencil, Save, X, Scissors, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  scene: Scene;
  projectId: string;
  onRefresh: () => void;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle2 className="h-3 w-3 mr-1" />Done</Badge>;
  if (status === "failed")
    return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>;
  return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
}

export default function SceneCard({ scene, projectId, onRefresh }: Props) {
  const [regenImage, setRegenImage] = useState(false);
  const [regenAudio, setRegenAudio] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  // Editable fields
  const [editingField, setEditingField] = useState<"script" | "tts" | "prompt" | null>(null);
  const [editValue, setEditValue] = useState("");

  // Per-scene voice
  const [voiceId, setVoiceId] = useState(scene.voice_id || "");

  const imgUrl = scene.image_status === "completed" ? getAssetUrl(projectId, "images", scene.image_file) : null;
  const audioUrl = scene.audio_status === "completed" ? getAssetUrl(projectId, "audio", scene.audio_file) : null;

  const startEdit = (field: "script" | "tts" | "prompt") => {
    setEditingField(field);
    setEditValue(
      field === "script" ? scene.script_text :
      field === "tts" ? scene.tts_text : scene.image_prompt
    );
  };

  const saveEdit = async () => {
    if (!editingField) return;
    const col = editingField === "script" ? "script_text" : editingField === "tts" ? "tts_text" : "image_prompt";
    const res = await fetch(`/api/projects/${projectId}/scenes/${scene.scene_number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [col]: editValue }),
    });
    if (!res.ok) { const e = await res.json(); toast.error(e.error); return; }
    toast.success("Saved");
    setEditingField(null);
    onRefresh();
  };

  const handleVoiceChange = async (v: string) => {
    setVoiceId(v);
    await fetch(`/api/projects/${projectId}/scenes/${scene.scene_number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: v }),
    });
    toast.success(`Voice set to ${v}`);
  };

  const handleRegenImage = async () => {
    setRegenImage(true);
    try {
      await regenerateAssetFrontend(projectId, scene.scene_number, "image");
      toast.success(`Scene ${scene.scene_number} image regenerated`);
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRegenImage(false); }
  };

  const handleRegenAudio = async () => {
    setRegenAudio(true);
    try {
      await regenerateAssetFrontend(projectId, scene.scene_number, "audio", voiceId || undefined);
      toast.success(`Scene ${scene.scene_number} audio regenerated`);
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRegenAudio(false); }
  };

  const handleSplit = async (splitIndex: number) => {
    try {
      await splitScene(projectId, scene.scene_number, splitIndex);
      toast.success("Scene split successfully");
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleDelete = async () => {
    try {
      await deleteScene(projectId, scene.scene_number);
      toast.success(`Scene ${scene.scene_number} deleted`);
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const renderEditable = (label: string, field: "script" | "tts" | "prompt", value: string, mono = false) => {
    const isEditing = editingField === field;
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">{label}:</span>
          {field === "prompt" && (
            <button onClick={() => { navigator.clipboard.writeText(value); toast.success("Copied!"); }} className="text-primary hover:text-primary/80">
              <Copy className="h-3 w-3" />
            </button>
          )}
          {isEditing ? (
            <>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={saveEdit}><Save className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingField(null)}><X className="h-3 w-3" /></Button>
            </>
          ) : (
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => startEdit(field)}><Pencil className="h-3 w-3" /></Button>
          )}
        </div>
        {isEditing ? (
          <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className={`mt-1 text-sm ${mono ? "font-mono" : ""}`} rows={4} />
        ) : (
          <p className={`mt-1 ${mono ? "text-xs font-mono bg-secondary p-2 rounded text-foreground/70" : "text-foreground/80"} ${field === "tts" ? "italic" : ""}`}>
            {value}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <Card className={`border-border/50 ${scene.needs_review ? "border-warning/50 glow-gold" : ""}`}>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-display text-primary font-bold">{scene.scene_number}</span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{scene.scene_type}</Badge>
                  <Badge variant="outline" className="text-xs">{scene.historical_period}</Badge>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setSplitOpen(true)}>
                <Scissors className="h-3 w-3 mr-1" /> Split
              </Button>
              {scene.needs_review && (
                <Badge className="bg-warning/20 text-warning border-warning/30">
                  <AlertTriangle className="h-3 w-3 mr-1" />Review
                </Badge>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-xs text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Scene {scene.scene_number}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this scene and its generated assets. This cannot be undone.
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

          <div className="grid md:grid-cols-2 gap-4">
            {/* Image */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground"><ImageIcon className="h-4 w-4" /> Image</div>
                <StatusBadge status={scene.image_status} />
              </div>
              <div className="aspect-video rounded-md overflow-hidden bg-secondary border border-border">
                {imgUrl ? <img src={imgUrl} alt={`Scene ${scene.scene_number}`} className="w-full h-full object-cover" /> : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon className="h-8 w-8" /></div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleRegenImage} disabled={regenImage} className="text-xs">
                  {regenImage ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1">Regen Image</span>
                </Button>
                <span className="text-xs text-muted-foreground">{scene.image_attempts} attempt{scene.image_attempts !== 1 ? "s" : ""}</span>
              </div>
              {scene.image_error && <p className="text-xs text-destructive">{scene.image_error}</p>}
            </div>

            {/* Audio */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Volume2 className="h-4 w-4" /> Audio</div>
                <StatusBadge status={scene.audio_status} />
              </div>
              <div className="rounded-md bg-secondary border border-border p-3">
                {audioUrl ? <AudioPlayer src={audioUrl} label={`Scene ${scene.scene_number} narration`} /> : (
                  <div className="flex items-center justify-center py-6"><Volume2 className="h-8 w-8 text-muted-foreground" /></div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleRegenAudio} disabled={regenAudio} className="text-xs">
                  {regenAudio ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1">Regen Audio</span>
                </Button>
                <span className="text-xs text-muted-foreground">{scene.audio_attempts} attempt{scene.audio_attempts !== 1 ? "s" : ""}</span>
              </div>
              {scene.audio_error && <p className="text-xs text-destructive">{scene.audio_error}</p>}

              {/* Per-scene voice */}
              <div className="pt-1">
                <label className="text-xs text-muted-foreground">Voice:</label>
                <Select value={voiceId || ""} onValueChange={handleVoiceChange}>
                  <SelectTrigger className="h-7 text-xs mt-1">
                    <SelectValue placeholder="Global default" />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableVoices(loadProviderSettings()).map(v => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">
                        {v.name} — {v.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Editable text */}
          <div className="space-y-2 text-sm">
            {renderEditable("Script", "script", scene.script_text)}
            <div>
              <span className="text-muted-foreground font-medium">TTS:</span>
              <p className="mt-1 italic text-foreground/80">{scene.tts_text}</p>
            </div>
            {renderEditable("Image Prompt", "prompt", scene.image_prompt, true)}
          </div>
        </CardContent>
      </Card>

      <SplitSceneDialog
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        scriptText={scene.script_text}
        onSplit={handleSplit}
      />
    </>
  );
}
