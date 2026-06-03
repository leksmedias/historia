CREATE TABLE "admin" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'history' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{"sceneCount":0,"imagesCompleted":0,"audioCompleted":0,"imagesFailed":0,"audioFailed":0,"needsReviewCount":0}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"scene_number" integer NOT NULL,
	"scene_type" text DEFAULT 'location' NOT NULL,
	"historical_period" text,
	"visual_priority" text DEFAULT 'environment',
	"script_text" text NOT NULL,
	"tts_text" text NOT NULL,
	"image_prompt" text NOT NULL,
	"fallback_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_file" text,
	"audio_file" text,
	"image_status" text DEFAULT 'pending' NOT NULL,
	"audio_status" text DEFAULT 'pending' NOT NULL,
	"image_attempts" integer DEFAULT 0 NOT NULL,
	"audio_attempts" integer DEFAULT 0 NOT NULL,
	"image_error" text,
	"audio_error" text,
	"motion_prompt" text,
	"video_status" text DEFAULT 'none' NOT NULL,
	"video_error" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"voice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;