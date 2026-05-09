import { createContext, useContext, useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { regenerateAssetFrontend } from "./api";
import { toast } from "sonner";

interface QueueItem {
  sceneNumber: number;
  type: "image" | "audio";
  voiceId?: string;
}

export interface GenerationState {
  projectId: string | null;
  trigger: "image" | "retry" | null;
  current: number | null;
  done: number;
  total: number;
  isRunning: boolean;
}

interface GenerationContextValue {
  state: GenerationState;
  startImageGeneration: (projectId: string, scenes: Array<{ scene_number: number }>) => void;
  startRetry: (projectId: string, scenes: Array<{ scene_number: number; image_status: string; audio_status: string; voice_id?: string | null }>) => void;
  stopGeneration: () => void;
}

const STORAGE_KEY = "historia_gen_queue";

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GenerationState>({
    projectId: null,
    trigger: null,
    current: null,
    done: 0,
    total: 0,
    isRunning: false,
  });

  const stopRef = useRef(false);
  const runningRef = useRef(false);

  const saveQueue = (projectId: string, queue: QueueItem[], total: number, trigger: "image" | "retry") => {
    if (queue.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId, queue, total, trigger }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const runQueue = useCallback(async (
    projectId: string,
    initialQueue: QueueItem[],
    total: number,
    doneStart: number,
    trigger: "image" | "retry"
  ) => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;

    let remaining = [...initialQueue];
    let done = doneStart;

    setState({ projectId, trigger, current: null, done, total, isRunning: true });

    for (const item of initialQueue) {
      if (stopRef.current) break;

      setState(s => ({ ...s, current: item.sceneNumber }));

      await regenerateAssetFrontend(projectId, item.sceneNumber, item.type, item.voiceId).catch((e) => {
        console.error(`Scene ${item.sceneNumber} ${item.type} failed:`, e);
      });

      done++;
      remaining = remaining.slice(1);
      saveQueue(projectId, remaining, total, trigger);
      setState(s => ({ ...s, done, current: null }));
    }

    localStorage.removeItem(STORAGE_KEY);
    runningRef.current = false;
    setState(s => ({ ...s, isRunning: false, current: null }));
  }, []);

  // Resume from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const { projectId, queue, total, trigger } = JSON.parse(saved) as {
        projectId: string; queue: QueueItem[]; total: number; trigger: "image" | "retry";
      };
      if (projectId && Array.isArray(queue) && queue.length > 0) {
        const done = total - queue.length;
        toast.info(`Resuming generation — ${queue.length} scene${queue.length !== 1 ? "s" : ""} remaining`);
        runQueue(projectId, queue, total, done, trigger ?? "image");
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [runQueue]);

  const startImageGeneration = useCallback((projectId: string, scenes: Array<{ scene_number: number }>) => {
    if (runningRef.current) return;
    const queue: QueueItem[] = scenes.map(s => ({ sceneNumber: s.scene_number, type: "image" as const }));
    if (queue.length === 0) return;
    saveQueue(projectId, queue, queue.length, "image");
    runQueue(projectId, queue, queue.length, 0, "image");
  }, [runQueue]);

  const startRetry = useCallback((
    projectId: string,
    scenes: Array<{ scene_number: number; image_status: string; audio_status: string; voice_id?: string | null }>
  ) => {
    if (runningRef.current) return;
    const queue: QueueItem[] = [];
    for (const scene of scenes) {
      if (scene.image_status === "failed")
        queue.push({ sceneNumber: scene.scene_number, type: "image" });
      if (scene.audio_status === "failed")
        queue.push({ sceneNumber: scene.scene_number, type: "audio", voiceId: scene.voice_id || undefined });
    }
    if (queue.length === 0) return;
    saveQueue(projectId, queue, queue.length, "retry");
    runQueue(projectId, queue, queue.length, 0, "retry");
  }, [runQueue]);

  const stopGeneration = useCallback(() => {
    stopRef.current = true;
    runningRef.current = false;
    localStorage.removeItem(STORAGE_KEY);
    setState(s => ({ ...s, isRunning: false, current: null }));
  }, []);

  return (
    <GenerationContext.Provider value={{ state, startImageGeneration, startRetry, stopGeneration }}>
      {children}
    </GenerationContext.Provider>
  );
}

export function useGeneration() {
  const ctx = useContext(GenerationContext);
  if (!ctx) throw new Error("useGeneration must be used within GenerationProvider");
  return ctx;
}
