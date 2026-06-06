# Product Requirements Document (PRD)
## Project: Historia — Cinematic Historical Documentary Generator (Python Transition)

---

## 1. Executive Summary
**Historia** is a cinematic historical documentary generator. The application automates the video production pipeline by taking a written historical script, splitting it into visual scenes via AI, generating historically-accurate imagery and professional narration audio for each scene, and rendering these assets into a final synchronized documentary video using FFmpeg.

This document details the product and technical requirements for transitioning Historia from its current **React + Node.js (Express)** stack to a **Python-based** architecture, without modifying the existing codebase. The goals of this transition are to simplify the AI integration ecosystem (leveraging Python's dominant position in AI/ML SDKs), improve background task management for long-running video rendering jobs, and maintain a highly responsive, cinematic user experience.

---

## 2. Target Architecture (Python Stack)

Instead of the previous React + Express stack, the application will transition to a pure Python or Python-centric framework. 

### 2.1 Backend Layer: FastAPI
*   **Technology**: **FastAPI** (Python 3.11+)
*   **Rationale**: 
    *   High-performance asynchronous framework natively matching Node's async event loop.
    *   Automatic OpenAPI documentation generation.
    *   Excellent integration with modern async database drivers.
    *   Native compatibility with AI SDKs (Google Cloud Vertex AI, Anthropic, Groq, Inworld).
*   **Database ORM**: **SQLModel** or **SQLAlchemy (Async)** with **Alembic** for migrations (replacing Drizzle ORM).
*   **Database**: **PostgreSQL** (unchanged).

### 2.2 Frontend Layer: Reflex or FastAPI + HTMX
To satisfy the user requirement of using Python instead of React, we define two potential UI implementation paths:
1.  **Reflex (Recommended for Pure Python)**: An open-source, full-stack Python framework. Reflex allows writing the UI in pure Python using a React-like component model, which is then compiled to a Next.js/React frontend. This preserves the cinematic, modern feel of the original app (using Tailwind CSS and custom component definitions) without requiring Javascript maintenance.
2.  **FastAPI + HTMX + Jinja2 + Tailwind**: A lightweight server-driven architecture. The UI is built using Jinja2 templates styled with Tailwind CSS, using HTMX for real-time visual updates (e.g. generation progress bars, prompt edits, preview actions) without full-page reloads.

### 2.3 Task Queue Layer: Celery / RQ (Redis Queue)
*   **Technology**: **Celery** or **RQ** with Redis as a broker.
*   **Rationale**: In the existing Node.js app, clip rendering, Veo video animations, and script splitting jobs are run as simple in-memory promises that are lost if the server restarts. A Python task queue (Celery/RQ) will persist background jobs, support concurrency tuning, and provide robust retry mechanics for Vertex AI rate limits.

---

## 3. Core Features & Functional Requirements

All current features must be preserved identically in the Python-based architecture.

### 3.1 Script Splitting & AI Scene Generation (Pass 1 & Pass 2)
The application converts raw text scripts into fully defined scenes using a two-pass pipeline:
*   **Pass 1 (Scene Splitting & Timing)**: Chunks the historical script and splits it into natural narrative beats.
    *   *Smart Mode*: Splits at natural 2-3 sentence intervals.
    *   *Exact Mode*: Splits strictly at single sentences or paragraph boundaries.
    *   *Duration Mode*: Groups sentences by estimated speaking time (target: 2.5 words per second).
    *   *Two Mode*: Exactly 2 sentences per scene.
*   **Pass 2 (Visual Continuity Prompt Generation)**: Generates highly detailed image prompts for each scene. To ensure visual continuity across the documentary, it uses a *continuity anchor* (passing description parameters from prior scenes to maintain character/setting likeness).
*   **Supported LLM Providers**: 
    *   Groq API (Llama 3.3 70B)
    *   Anthropic API (Claude 3.5 Sonnet)
    *   Google Gemini API (Vertex AI)
*   **JSON Import**: Users can skip LLM script splitting by directly uploading a pre-structured JSON scene array: `[{"narration_text": "...", "visual_prompt": "..."}]`.

### 3.2 Visual Asset Generation (Google Vertex AI)
Historically accurate visuals are generated using Vertex AI image models:
*   **Selectable Models**:
    1.  `Imagen 4 Fast` (Default)
    2.  `Imagen 4`
    3.  `Imagen 4 Ultra`
    4.  `Gemini 2.5 Flash` (Gemini-based image generation)
    5.  `Gemini 3.1 Flash (Preview)`
*   **Aspect Ratio Options**: 16:9 Landscape or 9:16 Portrait.
*   **Concurrency Control**: Enforce a server-side semaphore (max 2 parallel tasks) to respect Vertex AI quota limitations.
*   **Safety Features**: Disable safety filters for Gemini models to prevent false positives when handling war, conflict, or historical battles.
*   **Fallback Prompts**: Generate 3 progressively simpler fallback prompts per scene. If Vertex AI rejects the primary prompt, retry with fallbacks automatically.
*   **Style Reference Anchor**: Prepend visual parameters (e.g. style reference image influence, medium description) to maintain consistent aesthetics.

### 3.3 Text-to-Speech Narration (Inworld AI)
*   **Technology**: Inworld TTS 1.5 Max/Mini or 1.0 Max/Standard.
*   **Narrators**: 6 built-in voice models (Dennis, Eleanor, James, Linda, Brian, Amy) plus support for custom voice IDs.
*   **Narrative Integrity**: Narration audio text must match the original script text exactly.
*   **Error Recovery**: Automatically retry failed TTS generations up to 3 times. Provide a manual "Retry Failed Audio" bulk command.
*   **Scene Overrides**: Allow users to assign different voices to individual scenes.

### 3.4 Veo 3.1 Lite Video Animation
*   **Technology**: Google Vertex AI Veo 3.1 Lite (`us-central1` only).
*   **Functionality**: Users can choose to animate selected scene images. The app generates short video clips from still images and motion prompts.
*   **Time-Syncing**: If the generated Veo clip is shorter than the scene's narration audio, apply slow-motion interpolation via FFmpeg to sync the visual duration with the audio.

### 3.5 Video Render and Merge Pipeline
A two-phase rendering engine built using FFmpeg commands:
*   **Phase 1: Scene Clip Generation**:
    *   Synthesize scene image and scene narration MP4.
    *   If still image: Apply Ken Burns panning/zooming effects. 6 movements (zoom-in, zoom-out, pan-right, pan-left, pan-up, pan-down) rotate sequentially across scenes.
    *   If Veo video: Scale and stitch audio.
*   **Phase 2: Documentary Merge**:
    *   Concatenate all scene clips.
    *   Inject 1-second `xfade` cross-dissolve transitions between each scene clip.
    *   Apply `loudnorm` audio normalization to match professional broadcasting standards.
    *   Export output files at selectable resolutions: 480p, 720p, 1080p, and 1440p (default: 1080p).
*   **Concurrency Settings**: Configurable parallel workers (default: 3) to prevent CPU starvation on the host server.

---

## 4. UI Pages and Views

The user interface should mirror the current pages using Reflex or FastAPI template layouts:

1.  **Dashboard / New Project Form (`/`)**: Main entry. Script input box, style image uploader, voice selection, split mode selector, and image model configuration.
2.  **Project List (`/projects`)**: Table/grid view of all projects with active generation status (`processing`, `completed`, `failed`, `partial`).
3.  **Project Status & Management (`/projects/:id`)**: Shows aggregate generation statistics (image/audio completion counts), detailed scene cards, and the "Files & Downloads" dashboard.
4.  **Cinematic Preview Player (`/projects/:id/preview`)**: Full-screen player featuring real-time synchronized audio and subtitles, video timeline navigation, render settings, and asset regeneration options.
5.  **JSON Import (`/json-to-video`)**: Plain text workspace for importing raw JSON scene lists.
6.  **Image Model Test (`/image-test`)**: Side-by-side comparative generation workspace. Evaluates all 5 Google Cloud image models using a single user prompt.
7.  **Settings (`/settings`)**: Input panel for API keys (stored securely on server or client `localStorage`), default project preferences, and system connection health checks.
8.  **Error Log (`/errors`)**: Aggregated fail workspace displaying failed scenes from all projects with quick bulk-retry tools.

---

## 5. Data Schema

The database schema maps directly to Python class definitions (SQLModel/SQLAlchemy):

### 5.1 `projects` Table
| Field | Type | Description |
|---|---|---|
| `id` | String (Primary Key) | Format: `proj_` followed by random hash |
| `title` | String | User-defined title |
| `mode` | String | Execution mode (default: `"history"`) |
| `status` | String | `created`, `processing`, `completed`, `partial`, `failed`, `stopped` |
| `settings` | JSONB | Voice config, model ID, split mode, TTS provider, aspect ratio |
| `style_summary` | JSONB | Generated palette, lighting instructions, mood, style image paths |
| `stats` | JSONB | Recalculated scene stats (completed/failed assets) |

### 5.2 `scenes` Table
| Field | Type | Description |
|---|---|---|
| `id` | Integer (Primary Key) | Autoincrementing ID |
| `project_id` | String (Foreign Key) | Cascade delete on project deletion |
| `scene_number` | Integer | 1-based index indicating sequence |
| `script_text` | Text | Subtitle and prompt-base text |
| `tts_text` | Text | Narrative text read by TTS engine |
| `image_prompt` | Text | Detailed visual generation prompt |
| `motion_prompt` | Text | Motion generation prompt for Veo (falls back to `image_prompt`) |
| `fallback_prompts` | JSONB | Array of 3 fallback strings |
| `image_status` | String | `pending`, `completed`, `failed` |
| `audio_status` | String | `pending`, `completed`, `failed` |
| `video_status` | String | `none`, `animating`, `completed`, `failed` |
| `image_file` | String | Storage filename of generated image |
| `audio_file` | String | Storage filename of narration audio |
| `video_file` | String | Storage filename of Veo clip |
| `needs_review` | Boolean | True if any asset generation fails |
| `voice_id` | String | Per-scene custom voice override |

---

## 6. Directory Layout for the Python App

The Python project directory should be structured as follows:

```
├── app/
│   ├── __init__.py
│   ├── config.py              # Configuration & Environment loading
│   ├── main.py                # FastAPI entrypoint
│   ├── db/
│   │   ├── __init__.py
│   │   ├── session.py         # SQLAlchemy async engine & session maker
│   │   └── models.py          # SQLModel schemas (Projects, Scenes, Admin)
│   ├── routes/
│   │   ├── auth.py            # JWT authentication, Login/Logout, Setup
│   │   ├── projects.py        # Project/Scene CRUD, scene creation hooks
│   │   ├── assets.py          # Static asset serving, file uploads, project zip exports
│   │   ├── proxy.py           # Vertex AI, Groq, Inworld, Claude API Proxies
│   │   ├── render.py          # FFmpeg rendering triggers, downloads
│   │   └── script.py          # Pass 1 & Pass 2 script-to-JSON pipeline jobs
│   ├── services/
│   │   ├── vertex.py          # Google Vertex AI SDK integration (Imagen, Veo)
│   │   ├── tts.py             # Inworld TTS API client
│   │   ├── llm.py             # Groq, Anthropic, Gemini client wrappers
│   │   └── ffmpeg.py          # FFmpeg command builder (Ken Burns, xfade, loudnorm)
│   ├── ui/                    # Frontend files (if using Reflex, contains python pages)
│   │   ├── pages/
│   │   └── components/
│   └── templates/             # Jinja2 templates (if using FastAPI + HTMX)
├── migrations/                # Alembic database migrations
├── uploads/                   # Asset folder matching the existing structure
│   └── {projectId}/
│       ├── style/
│       ├── images/
│       ├── audio/
│       ├── videos/
│       ├── clips/
│       └── render/
├── .env.example
├── alembic.ini
└── requirements.txt
```

---

## 7. Migration Plan

1.  **Environment Sync**: Transfer `.env` variables from Node to Python. Install Google Cloud SDK for Python (`google-cloud-aiplatform`) to replace command-line `gcloud` token fetches.
2.  **DB Migration**: Run Alembic to generate tables mirroring the structure of the existing Drizzle models. PostgreSQL data can be retained since field names and data types map directly.
3.  **Authentication**: Convert JWT generation and verification logic from Express to Python (using `PyJWT` or `python-jose`). Retain bcrypt password hashing compatibility (salt rounds 12).
4.  **FFmpeg Engine**: Rewrite the node-fluent-ffmpeg commands or bash scripts as native Python sub-process operations or using the `ffmpeg-python` library, maintaining exact filter parameters for Ken Burns animations, `xfade` dissolve transitions, and audio normalization.
