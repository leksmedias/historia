import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ImageIcon, Volume2, RefreshCw, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface ErrorEntry {
  id: string;
  project_id: string;
  project_title: string;
  scene_number: number;
  type: "image" | "audio";
  error: string;
  attempts: number;
  updated_at: string;
}

export default function ErrorLog() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio">("all");

  const fetchErrors = async () => {
    setLoading(true);
    try {
      const allProjects: any[] = await fetch("/api/projects").then(r => r.json());
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

  const imageFails = errors.filter(e => e.type === "image").length;
  const audioFails = errors.filter(e => e.type === "audio").length;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Error Log</h1>
          <p className="text-sm text-muted-foreground">All failed asset generations across projects</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchErrors} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
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
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="image">Images only</SelectItem>
            <SelectItem value="audio">Audio only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Error table */}
      <Card>
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Scene</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead className="w-[40%]">Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    {loading ? "Loading…" : "No errors found 🎉"}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(e.updated_at), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[150px] truncate">
                      {e.project_title}
                    </TableCell>
                    <TableCell className="text-sm">#{e.scene_number}</TableCell>
                    <TableCell>
                      <Badge variant={e.type === "image" ? "secondary" : "outline"} className="text-xs">
                        {e.type === "image" ? <ImageIcon className="h-3 w-3 mr-1" /> : <Volume2 className="h-3 w-3 mr-1" />}
                        {e.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{e.attempts}</TableCell>
                    <TableCell className="text-xs text-destructive font-mono max-w-[300px] truncate" title={e.error}>
                      {e.error}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>
    </div>
  );
}
