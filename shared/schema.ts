import { pgTable, text, integer, boolean, timestamp, jsonb, uuid, serial } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("history"),
  status: text("status").notNull().default("created"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  style_summary: jsonb("style_summary").notNull().default(sql`'{}'::jsonb`),
  stats: jsonb("stats").notNull().default(sql`'{"sceneCount":0,"imagesCompleted":0,"audioCompleted":0,"imagesFailed":0,"audioFailed":0,"needsReviewCount":0}'::jsonb`),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  project_id: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  scene_number: integer("scene_number").notNull(),
  scene_type: text("scene_type").notNull().default("location"),
  historical_period: text("historical_period"),
  visual_priority: text("visual_priority").default("environment"),
  script_text: text("script_text").notNull(),
  tts_text: text("tts_text").notNull(),
  image_prompt: text("image_prompt").notNull(),
  fallback_prompts: jsonb("fallback_prompts").notNull().default(sql`'[]'::jsonb`),
  image_file: text("image_file"),
  audio_file: text("audio_file"),
  image_status: text("image_status").notNull().default("pending"),
  audio_status: text("audio_status").notNull().default("pending"),
  image_attempts: integer("image_attempts").notNull().default(0),
  audio_attempts: integer("audio_attempts").notNull().default(0),
  image_error: text("image_error"),
  audio_error: text("audio_error"),
  motion_prompt: text("motion_prompt"),
  video_status: text("video_status").notNull().default("none"),
  video_error: text("video_error"),
  needs_review: boolean("needs_review").notNull().default(false),
  voice_id: text("voice_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const admin = pgTable("admin", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  password_hash: text("password_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
