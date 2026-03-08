## Plan: Scene Preview Player Page

Based on the reference image, this creates a cinematic preview player for viewing scenes as a slideshow with synchronized audio, plus simplifies editing to image prompts only (using Groq for regeneration).

### What gets built

**1. New Preview Player Page (`/projects/:projectId/preview`)**
A full-screen-style player matching the reference image:

- **Large scene image viewer** with subtitle text (the `script_text`) overlaid at the bottom
- **Audio player controls bar**: previous scene, play/pause, next scene, seek slider, time display (`0:00 / 0:36`), volume slider
- **Horizontal scene timeline** below: row of scene thumbnails with duration labels (e.g. `10.5s`, `7.9s`), active scene highlighted with a blue border
- Clicking a thumbnail jumps to that scene; play button auto-advances through scenes when each audio finishes

**2. Simplify editing: Image prompt only (via Groq)**

- Remove `tts_text` editing from `SceneCard.tsx` (keep it read-only display)
- Keep `script_text` and `image_prompt` editable
- Add a "Regenerate Prompt" button on `SceneCard` that calls Groq to generate a new `image_prompt` from the scene's `script_text` + style summary, so users can get a fresh AI-generated prompt before regenerating the image

**3. Update Timeline component**

- Enhance existing `Timeline.tsx` to show audio duration per scene (fetched from audio metadata)
- Match the reference styling: dark cards, duration badge overlay, blue highlight on active

---

### Technical Details

**New file**: `src/pages/ProjectPreview.tsx`

- Fetches project + scenes via `getProject()`
- Manages `activeSceneIndex` state; loads scene image + audio
- Uses an `<audio>` element; on `ended` event, auto-advances to next scene
- Subtitle overlay uses absolute positioning over the image
- Duration per scene: load each audio file's metadata to get duration, store in local state map

**Route**: Add `/projects/:projectId/preview` in `App.tsx`

**Modified files**:

- `App.tsx` — add preview route
- `ProjectStatus.tsx` — add "Preview" button linking to the preview page
- `SceneCard.tsx` — remove `tts` from `renderEditable`, add "Regenerate Prompt via AI" button
- `Timeline.tsx` — add duration display, update styling to match reference (dark bg, blue active border, duration badge)

**Groq prompt regeneration** (in `api.ts` or `providers.ts`):

- New function `regenerateImagePrompt(scriptText, styleSummary, groqApiKey)` that calls Groq with a focused prompt to produce a single `image_prompt` string from the scene's script text  
  
also add place like a small side bar wher ei can edit the prompt and generate the image prompt or replce it again