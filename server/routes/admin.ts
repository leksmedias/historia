import { Router, Request, Response } from "express";
import { db } from "../db";
import { projects, scenes } from "../../shared/schema";
import { eq, or } from "drizzle-orm";
import path from "path";
import fs from "fs";

const router = Router();

function scanDir(dirPath: string): { files: number; bytes: number } {
  if (!fs.existsSync(dirPath)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) { files++; bytes += stat.size; }
      } catch (_e) { /* skip unreadable entry */ }
    }
  } catch (_e) { /* skip unreadable dir */ }
  return { files, bytes };
}

function purgeDir(dirPath: string): { files: number; bytes: number } {
  if (!fs.existsSync(dirPath)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          bytes += stat.size;
          fs.unlinkSync(fullPath);
          files++;
        }
      } catch (_e) { /* skip unreadable/locked file */ }
    }
  } catch (_e) { /* skip unreadable dir */ }
  return { files, bytes };
}

function getProjectDirs(uploadsDir: string): string[] {
  if (!fs.existsSync(uploadsDir)) return [];
  try {
    return fs.readdirSync(uploadsDir).filter(d => {
      try { return fs.statSync(path.join(uploadsDir, d)).isDirectory(); } catch { return false; }
    });
  } catch {
    return [];
  }
}

// GET /api/admin/storage — scan uploads/ and return file counts + sizes
router.get("/storage", (_req: Request, res: Response) => {
  try {
    const uploadsDir = "uploads";
    const projectDirs = getProjectDirs(uploadsDir);

    const totals = {
      projectCount: projectDirs.length,
      images:  { files: 0, bytes: 0 },
      audio:   { files: 0, bytes: 0 },
      videos:  { files: 0, bytes: 0 },
      renders: { files: 0, bytes: 0 },
    };

    for (const projDir of projectDirs) {
      const base = path.join(uploadsDir, projDir);

      const addTo = (bucket: { files: number; bytes: number }, sub: string) => {
        const r = scanDir(path.join(base, sub));
        bucket.files += r.files;
        bucket.bytes += r.bytes;
      };

      addTo(totals.images,  "images");
      addTo(totals.audio,   "audio");
      addTo(totals.videos,  "videos");
      // renders = clips (per-scene Ken Burns) + render (merged output.mp4)
      addTo(totals.renders, "clips");
      addTo(totals.renders, "render");
    }

    res.json(totals);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/admin/purge — delete files by scope and reset DB statuses
// scope: "images" | "audio" | "videos" | "renders" | "all"
router.post("/purge", async (req: Request, res: Response) => {
  try {
    const { scope } = req.body as { scope: string };
    const valid = ["images", "audio", "videos", "renders", "all"];
    if (!valid.includes(scope)) {
      return res.status(400).json({ error: `Invalid scope — must be one of: ${valid.join(", ")}` });
    }

    const uploadsDir = "uploads";
    const projectDirs = getProjectDirs(uploadsDir);
    let totalFiles = 0;
    let totalBytes = 0;

    for (const projDir of projectDirs) {
      const base = path.join(uploadsDir, projDir);
      const del = (sub: string) => {
        const r = purgeDir(path.join(base, sub));
        totalFiles += r.files;
        totalBytes += r.bytes;
      };

      if (scope === "images"  || scope === "all") del("images");
      if (scope === "audio"   || scope === "all") del("audio");
      if (scope === "videos"  || scope === "all") del("videos");
      // "renders" = clips + render output; "videos" and "all" also clear these
      if (scope === "renders" || scope === "videos" || scope === "all") {
        del("clips");
        del("render");
      }
    }

    // Reset scene statuses to match purged files
    if (scope === "images" || scope === "all") {
      await db.update(scenes).set({ image_status: "pending", image_file: null, image_error: null });
    }
    if (scope === "audio" || scope === "all") {
      await db.update(scenes).set({ audio_status: "pending", audio_file: null, audio_error: null });
    }
    if (scope === "videos" || scope === "all") {
      await db.update(scenes).set({ video_status: "none", video_error: null });
    }

    // Reset project status for projects that had content-bearing assets deleted
    if (scope === "images" || scope === "audio" || scope === "all") {
      await db.update(projects)
        .set({ status: "partial" })
        .where(or(
          eq(projects.status, "completed"),
          eq(projects.status, "failed"),
          eq(projects.status, "stopped"),
        ));
    }

    res.json({ deleted: { files: totalFiles, bytes: totalBytes } });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
