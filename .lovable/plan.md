

## Plan: Fix Whisk API Integration Using Correct Endpoints

The current image generation is broken because:
1. **Upload endpoint** uses `?batch=1` which returns "Batching is not enabled on the server"
2. **Upload payload** is missing required fields (`workflowId`, `caption`)
3. **Recipe generation** uses wrong field names (`additionalInput` vs `userInstruction`, `modelNameType` vs `imageModel`)
4. **No captioning step** — Whisk requires captioning images before uploading them as references
5. **AI vision analysis is unnecessary** — Whisk handles style matching natively via style reference uploads

### Correct Whisk Flow (from `@rohitaryal/whisk-api`):
1. **Create a Whisk project** → `media.createOrUpdateWorkflow` → get `workflowId`
2. **Caption each style image** → `backbone.captionImage` → get caption text
3. **Upload style images** → `backbone.uploadImage` (NO `?batch=1`) with `workflowId`, `caption`, `mediaCategory`, `rawBytes`
4. **Generate with references** → `whisk:runImageRecipe` with `userInstruction`, `recipeMediaInputs` (including `caption` per ref), `imageModel: "GEM_PIX"`

### Changes

**1. `supabase/functions/whisk-proxy/index.ts`** — Update proxy actions:
- Fix `upload` action: remove `?batch=1` from URL, accept new payload format
- Add `create-project` action: proxy to `media.createOrUpdateWorkflow`
- Add `caption-image` action: proxy to `backbone.captionImage`
- Fix `generate-recipe` action: keep as-is (payload built client-side)
- Remove the old batched upload format

**2. `src/lib/providers.ts`** — Rewrite `generateWhiskImage`:
- Add helper: `createWhiskProject(cookie)` → creates workflow, returns `workflowId`
- Add helper: `captionWhiskImage(base64, category, workflowId, cookie)` → returns caption
- Fix `uploadToWhisk`: use correct payload with `workflowId`, `caption`, `mediaCategory`, `rawBytes`
- Fix `generateWhiskImage`: 
  - Create project first
  - For each style ref: fetch blob → base64 → caption → upload → get mediaId
  - Build `recipeMediaInputs` with captions
  - Use `userInstruction` instead of `additionalInput`
  - Use `imageModel` instead of `modelNameType`

**3. `src/lib/api.ts`** — Remove AI vision:
- Remove the `analyze-style` edge function call (step 3)
- Remove the `DEFAULT_STYLE_SUMMARY` constant (no longer needed for vision)
- Keep style_summary in DB for the Groq prompt generation (derived from user's style description or defaults)

**4. Delete `supabase/functions/analyze-style/index.ts`** — No longer needed

### Files to modify:
- `supabase/functions/whisk-proxy/index.ts` — add/fix proxy actions
- `src/lib/providers.ts` — fix Whisk API calls
- `src/lib/api.ts` — remove AI vision step

### Files to delete:
- `supabase/functions/analyze-style/index.ts`

