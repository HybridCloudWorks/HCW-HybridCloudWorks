# AI Recommendations — Single Source of Truth

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Created:** May 11, 2026 **Status:** Stage 6 of 7-stage AI Review — **awaiting user approval per
item** **Source:** Consolidated from `AI-Integration-Inventory.md` Stages 1–5 **Owner:**
ContentForge / HCW

> **Approval gate:** No item in Tiers 1–4 ships until the user explicitly marks it approved below.
> Mark each item `[ ] Approved`, `[ ] Deferred`, or `[ ] Rejected` in the approval table (§5).
> Approved items move to Stage 7 (implementation). Deferred/rejected items stay here with reason.

---

## Already shipped

| ID     | Change                                                                                                         | Shipped      | Commit    |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------ | --------- |
| **R1** | Stop auto-firing Imagen-4 at ingest — `altCoverImageTrigger` default OFF; image now fires at publish time only | May 11, 2026 | `cbf9b81` |

R1 cut Imagen-4 spend from ~$113/mo (94 images/day at ingest) to ~$24/mo (20 images/day at publish

- admin). No further action needed.

---

## Tier 1 — Low risk, high savings

> No API breakage. No quality risk. These can ship in a single PR each.

---

### R2 — Swap Imagen-4 → Imagen-4-fast

**Change:** In both Replicate call sites, change the hardcoded model string from `google/imagen-4`
to `google/imagen-4-fast`. Gate behind a new env var so it can be flipped without a deploy.

**Files:**

- [`functions/index.js:1916`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1916) — `callReplicateApi`
- [`functions/cms-functions.js:1934`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1934) — `generateImageByPrompt`

**Plain-English change:**

```
// Before (both files):
model: 'google/imagen-4'

// After:
model: process.env.CONTENTFORGE_IMAGE_MODEL || 'google/imagen-4-fast'
```

**Cost delta:** −$12/mo at current volume (450 covers + 150 curated = 600 images/mo × $0.02 saved).
At 10×: −$120/mo.

**Risk:** Low. Same Imagen-4 model family — identical API shape, same `block_medium_and_above`
content policy, same output format. "Fast" variant trades marginal rendering speed for 50% cost
reduction. Visually indistinguishable at typical web display sizes.

**Rollout:** Sample 5 published cover images with `imagen-4-fast` before committing. If visual
quality is acceptable, set `CONTENTFORGE_IMAGE_MODEL=google/imagen-4-fast` in Firebase Functions
config and deploy.

**Rollback:** `unset CONTENTFORGE_IMAGE_MODEL` (reverts to `imagen-4-fast` default) or set
`CONTENTFORGE_IMAGE_MODEL=google/imagen-4` to restore original.

**Source:** §9.4 R2, §10.2, §11.1

---

### R3 — Retire orphan `scripts/generate-ai-covers.js`

**Change:** Delete `scripts/generate-ai-covers.js` or rewrite it to call `generateImageByPrompt`
(the same path prod uses) instead of DALL-E 3 via raw `https`.

**Files:**

- `scripts/generate-ai-covers.js` *(historical target unavailable)* — delete or rewrite

**Plain-English change:** The script uses `dall-e-3` (deprecated by OpenAI), calls
`api.openai.com/v1/images/generations` directly (bypasses router), and produces 1792×1024 images in
a style that does not match Imagen-4 covers on the live site. If anyone runs this script to bulk
regen covers, the output won't match the live site aesthetic.

Simplest resolution: delete the file. Git history preserves it. If a bulk-regen script is ever
needed again, it should call the Firebase Function (`generatePreviewImages` admin endpoint) rather
than the model directly.

**Cost delta:** Eliminates the only `OPENAI_API_KEY` usage in the production codebase. Negligible
direct savings (script is manual/on-demand), but closes the drift and removes a confusing dead end.

**Risk:** Low. Confirm no team member has an active workflow that depends on this script before
deleting.

**Rollout:** `git rm scripts/generate-ai-covers.js`. One commit.

**Rollback:** `git revert` or `git checkout <sha> -- scripts/generate-ai-covers.js`.

**Source:** §9.4 R3, §11.1 G9

---

## Tier 2 — Medium risk

> Require prompt restructuring, schema changes, or UI work. Low quality risk but need testing.

---

### R4 — Refresh Anthropic router defaults

**Change:** Update the four `anthropic` entries in `DEFAULT_MODEL_TABLE`
([`functions/lib/ai-model-router.js:25-30`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L25)) from
`claude-3-5-sonnet-latest` (no longer on Anthropic's current pricing table) to current models.

**Plain-English change:**

```js
// Before:
anthropic: {
  draft:      ['CONTENTFORGE_ANTHROPIC_DRAFT_MODEL',      'claude-3-5-sonnet-latest'],
  analysis:   ['CONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL',   'claude-3-5-sonnet-latest'],
  multimodal: ['CONTENTFORGE_ANTHROPIC_MULTIMODAL_MODEL', 'claude-3-5-sonnet-latest'],
  general:    ['CONTENTFORGE_ANTHROPIC_MODEL',            'claude-3-5-sonnet-latest'],
},

// After:
anthropic: {
  draft:      ['CONTENTFORGE_ANTHROPIC_DRAFT_MODEL',      'claude-sonnet-4-6'],
  analysis:   ['CONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL',   'claude-sonnet-4-6'],
  multimodal: ['CONTENTFORGE_ANTHROPIC_MULTIMODAL_MODEL', 'claude-sonnet-4-6'],
  general:    ['CONTENTFORGE_ANTHROPIC_MODEL',            'claude-haiku-4-5'],
},
```

**Cost delta:** $0/mo today (Vertex is active provider, Anthropic path is dormant). Eliminates
fall-through risk if `CONTENTFORGE_AI_PROVIDER` is ever flipped to `anthropic`.

**Risk:** Low. Only takes effect on provider flip. Before flipping, test with
`CONTENTFORGE_AI_PROVIDER=anthropic` against the admin portal to verify output quality.

**Rollout:** Single commit to `ai-model-router.js`. No deploy needed until provider flip.

**Rollback:** Revert the commit. Env-var overrides (`CONTENTFORGE_ANTHROPIC_*_MODEL`) take
precedence over defaults at runtime.

**Source:** §9.4 R4, §3 stale Anthropic defaults

---

### R6 — Refresh OpenAI router defaults

**Change:** Update the four `openai` entries in `DEFAULT_MODEL_TABLE`
([`functions/lib/ai-model-router.js:19-24`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L19)) from
`gpt-4o-mini` (removed from current OpenAI pricing page) to current models.

**Plain-English change:**

```js
// Before:
openai: {
  draft:      ['CONTENTFORGE_OPENAI_DRAFT_MODEL',      'gpt-4o-mini'],
  analysis:   ['CONTENTFORGE_OPENAI_ANALYSIS_MODEL',   'gpt-4o-mini'],
  multimodal: ['CONTENTFORGE_OPENAI_MULTIMODAL_MODEL', 'gpt-4o-mini'],
  general:    ['CONTENTFORGE_OPENAI_MODEL',            'gpt-4o-mini'],
},

// After:
openai: {
  draft:      ['CONTENTFORGE_OPENAI_DRAFT_MODEL',      'gpt-5-mini'],
  analysis:   ['CONTENTFORGE_OPENAI_ANALYSIS_MODEL',   'gpt-5-mini'],
  multimodal: ['CONTENTFORGE_OPENAI_MULTIMODAL_MODEL', 'gpt-5-mini'],
  general:    ['CONTENTFORGE_OPENAI_MODEL',            'gpt-5-nano'],
},
```

**Cost delta:** $0/mo today (Vertex active). Pricing of new defaults is roughly equivalent or
cheaper: `gpt-5-mini` ($0.25/$2.00) vs. last-known `gpt-4o-mini` pricing.

**Risk:** Low. Same chat-completions API shape — no breaking change in request/response format.

**Rollout:** Bundle with R4 in a single "router defaults refresh" commit.

**Rollback:** Revert commit or set env-var overrides.

**Source:** §9.4 R6, §3 OpenAI defaults note

---

### G3 — Architecture diagram reasoning upgrade

**Change:** Switch `analyzeArchitectureDiagram` from `gemini-2.5-flash` to `gemini-2.5-pro` for
better structured extraction from complex diagrams. Gate behind existing
`CONTENTFORGE_VERTEX_MULTIMODAL_MODEL` env var — no code change required.

**Files:** None (env-var only)

**Plain-English change:** Set in Firebase Functions config:

```
CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-pro
```

The call site already reads this override at runtime. No deploy needed beyond config update.

**Cost delta:** +$0.038/call (from $0.0045 → $0.0423 per diagram). At ~60/mo: **+$2.27/mo**.
Acceptable for meaningfully better architecture spec quality (components, cost breakdown, Terraform
accuracy).

**Risk:** Low-medium. Quality improvement expected but not guaranteed — sample 10 diagrams
side-by-side before committing. Latency increases (~10–20s vs. ~5s for flash). No schema change.

**Rollout:**

1. Set `CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-pro` in staging config.
2. Submit 10 architecture diagrams via admin portal.
3. Compare JSON output quality (component count, Terraform correctness, cost estimates).
4. If acceptable, promote to production config.

**Rollback:** `unset CONTENTFORGE_VERTEX_MULTIMODAL_MODEL` (reverts to `gemini-2.5-flash`).

**Source:** §11.3 G3

---

### G4 — Draft model one-tier-up A/B test

**Change:** Test `gemini-2.5-flash` (analysis tier) for `generateArticleDraft` instead of the
current `gemini-2.5-flash-lite` (draft tier). Gate behind `CONTENTFORGE_VERTEX_DRAFT_MODEL` env var
— no code change required.

**Files:** None (env-var only)

**Plain-English change:**

```
CONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-flash
```

**Cost delta:** +$0.003/call (from $0.0026 → ~$0.0056). At 150/mo: **+$0.45/mo** — negligible.

**Risk:** Low. Env-var only; zero code change. Quality uplift on complex technical drafts is the
only variable to validate.

**Rollout:** Generate 5 draft articles with `flash-lite` and 5 with `flash` on the same source URLs.
Compare `postContent` quality (depth, accuracy, structure). If better, keep the override.

**Rollback:** `unset CONTENTFORGE_VERTEX_DRAFT_MODEL`.

**Source:** §11.3 G4

---

### R8 — Defer `postContent` body generation to publish time

**Change:** Split `analyzeWithGemini` into two prompts: a fast "metadata-only" pass (title, summary,
cloudProvider, keyTopics, targetAudience, visualTheme — no `postContent`) for all ingests, and a
"metadata+body" pass triggered manually (editor UI button or on publish).

**Files:**

- [`functions/index.js:1477-1500`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1477) — `analyzeWithGemini` prompt
- Admin portal — new "Generate post body" button in article editor

**Plain-English change:**

- Ingest path runs the metadata-only prompt (~500 tokens output instead of ~2,000). Faster and
  ~30–50% cheaper per analysis call.
- New Cloud Function endpoint (or existing draft endpoint repurposed) accepts an article ID and runs
  the full `metadata+body` prompt, writing `postContent` back to Firestore.
- Admin portal adds a "Generate post body" button in the article editor that calls this endpoint.

**Cost delta:** −$2.57–$4.28/mo at current volume (saves ~2K output tokens/call on 900 ingest
calls/mo). At 10×: −$25–$43/mo. Aligns with the same "draft vs. published" rubric as R1.

**Risk:** Medium. Requires:

- A new Cloud Function or endpoint (moderate effort).
- Schema change: articles ingested after this change will have no `postContent` until triggered.
  Articles already in Firestore are unaffected.
- Admin portal UI change (button + loading state).

**Rollout:**

1. Add `CONTENTFORGE_METADATA_ONLY=true` flag to `analyzeWithGemini` to select prompt variant.
2. Add Cloud Function `generatePostContent(articleId)`.
3. Wire admin portal button.
4. Set flag in production after UI ships.

**Rollback:** `unset CONTENTFORGE_METADATA_ONLY` (reverts to full prompt including `postContent`).

**Source:** §9.4 R8, §11.3

---

## Tier 3 — Capability upgrades

> New features, not optimizations. Each requires meaningful new code. Evaluate post-launch.

---

### G1 — Two-tier image quality (draft thumbnail vs. hero cover)

**Change:** Extend R2 with a second env var for hero covers at full quality. Introduce
`CONTENTFORGE_IMAGE_MODEL_HERO` (default `google/imagen-4`) for publish-time covers and keep
`CONTENTFORGE_IMAGE_MODEL` (default `google/imagen-4-fast`) for admin-tool / curated calls.

**Files:**

- [`functions/index.js:1916`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1916) — `callReplicateApi`
- [`functions/cms-functions.js:1934`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1934) — `generateImageByPrompt`

**Cost delta:** Net neutral vs. R2 alone — hero covers stay at $0.04, curated/admin at $0.02. Adds
quality differentiation without increasing average spend.

**Risk:** Low. Two env vars; model lookup is straightforward.

**Rollout:** Bundle after R2 is validated.

**Rollback:** Set both vars to the same model.

**Source:** §11.1 G1

---

### G2 — Fallback image provider on Replicate outage

**Change:** Add `gpt-image-1` (medium, $0.042/image) as a cold standby in a new `callImageFallback`
wrapper. If `callReplicateApi` throws after retries, automatically retry via OpenAI Images API.

**Files:**

- [`functions/index.js`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js) — new `callImageFallback` wrapper around
  `callReplicateApi`
- New env var: `CONTENTFORGE_IMAGE_FALLBACK_PROVIDER` (`none` | `openai`) — default `none`

**Cost delta:** $0 normally. On Replicate outage: ~$0.002 premium per fallback image (OpenAI medium
$0.042 vs. Imagen-4 $0.04).

**Risk:** Medium. OpenAI Images API response format differs from Replicate (URL vs. base64);
requires adapter. Test fallback path in staging before enabling.

**Rollout:** Implement after R2 and R3 are stable. Enable with
`CONTENTFORGE_IMAGE_FALLBACK_PROVIDER=openai`.

**Rollback:** `CONTENTFORGE_IMAGE_FALLBACK_PROVIDER=none`.

**Source:** §11.1 G2

---

### G5 — Auto alt-text on article image ingest

**Change:** After `analyzeArticleMetadata` extracts article metadata, add a second sub-call for each
image URL found in the scraped HTML: pass the image to `gemini-2.5-flash` multimodal and request a
concise alt-text string (≤125 chars). Store results in a `imageAltTexts` map on the article
Firestore document.

**Files:**

- [`functions/index.js`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js) — new `generateAltTexts(imageUrls)` helper called
  from `inspectAndPopulateArticle`

**Cost delta:** ~$0.0008/image × ~2 images/article × 900 articles/mo = **~$1.44/mo**. High-value
return: direct accessibility and SEO improvement for a negligible token cost.

**Risk:** Low-medium. Additive — no existing fields are changed. Needs image URL extraction from
Firecrawl markdown output (images are present as `![]()` syntax or as raw URLs).

**Rollout:**

1. Implement `generateAltTexts(imageUrls[])` using the existing multimodal path.
2. Call from `inspectAndPopulateArticle`, gated behind `CONTENTFORGE_ALT_TEXT_ENABLED=true`.
3. Render `imageAltTexts` values in the article page `<img alt="">` attributes.

**Rollback:** `CONTENTFORGE_ALT_TEXT_ENABLED=false` (disables the sub-call; existing `imageAltTexts`
field is simply not read on the frontend until re-enabled).

**Source:** §11.4 G5

---

### G6 — Blog post narration (TTS)

**Change:** At publish time, generate a narrated MP3 of `postContent` using Vertex AI TTS (Chirp 3)
and store to Cloud Storage. Render a `<audio>` player on article pages.

**Deferred.** High effort (new Cloud Function + Storage write + CDN caching + frontend player
component). Re-evaluate post-launch once core pipeline is stable.

**Preferred model when ready:** `Vertex AI TTS` (Chirp 3, ~$0.006/1K chars) — same GCP project auth,
no new secret.

**Source:** §11.2 G6

---

### G7 + G8 — Semantic dedup and related articles via embeddings

**Change:** Embed `title + summary` for each article using `text-embedding-005` (Vertex, ~$0.025/1M
tokens). Use cosine similarity for (G7) dedup on ingest and (G8) related article surfacing on
article pages.

**Deferred.** Blocked on infrastructure gap: no vector store. Re-evaluate when published article
count exceeds ~200. When ready: start with Firestore in-process similarity (sufficient for <200
articles), migrate to Vertex AI Vector Search at scale.

**Source:** §11.5 G7, G8

---

## Tier 4 — Architectural

> Observability, caching wiring, model routing improvements. Enable measurement before optimization.

---

### R9 — Token and cost logging in router

**Change:** Add a lightweight token usage log to each provider's call function, behind a feature
flag. Captures per-call token counts and inferred cost, written to Cloud Logging.

**Files:**

- [`functions/lib/ai-model-router.js`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js) — add to `callVertex`
  (line ~91), `callOpenAi` (line ~148), `callAnthropic` (line ~221)

**Plain-English change (per provider):**

```js
// Vertex — after result.response is received:
if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
  const usage = result.response?.usageMetadata || {};
  logger.info('[ai-model] vertex token usage', { ...usage, model: selectedModel, purpose });
}

// OpenAI — after response.data is received:
if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
  const usage = response.data?.usage || {};
  logger.info('[ai-model] openai token usage', { ...usage, model: selectedModel, purpose });
}

// Anthropic — after response.data is received:
if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
  const usage = response.data?.usage || {};
  logger.info('[ai-model] anthropic token usage', { ...usage, model: selectedModel, purpose });
}
```

Vertex `usageMetadata` fields: `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. OpenAI
`usage` fields: `prompt_tokens`, `completion_tokens`, `total_tokens`. Anthropic `usage` fields:
`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.

**Cost delta:** $0 direct. Enables validation of all cost projections in §10 with real numbers, and
gives accurate baseline before shipping R7, R8, or any future model swap.

**Risk:** Low. Feature-flagged; no behavior change when flag is off.

**Rollout:** Ship early — ideally before G3 or R8. Set `CONTENTFORGE_LOG_TOKEN_USAGE=true` in
Firebase Functions config. Query Cloud Logging for `[ai-model] vertex token usage` after 24h of
production traffic.

**Rollback:** `CONTENTFORGE_LOG_TOKEN_USAGE=false`.

**Source:** §9.4 R9, §12.7

---

### R5 — Anthropic prompt caching

**Change (revised scope per Stage 5 findings):** Before adding `cache_control`, first expand the
static instruction blocks in `analyzeWithGemini` and `analyzeArchitectureDiagram` to ≥1,024 tokens
by adding brand voice, editorial standards, and output examples. Then wire
`cache_control: { type: 'ephemeral' }` on those blocks in `callAnthropic`.

**Files:**

- [`functions/lib/ai-model-router.js:182-224`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L182) —
  `callAnthropic` — split `messages[0].content` into a cacheable static block + dynamic content
  block; add `cache_control` to the static block
- [`functions/index.js:1477-1500`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1477) — `analyzeWithGemini` — expand
  static instruction header to ≥1,024 tokens
- [`functions/index.js:1541-1574`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1541) — `analyzeArchitectureDiagram` —
  expand static instruction header to ≥1,024 tokens

**Note:** Currently dormant — Vertex is the active provider. This only takes effect if
`CONTENTFORGE_AI_PROVIDER=anthropic`. Land R4 first to ensure Anthropic defaults are current, then
wire caching.

**Cost delta:** At 900 analysis calls/mo on Anthropic (`claude-sonnet-4-6`, $3.00/$15.00 per 1M):
static block cache write: 1× at 1,024 tokens × $3.75/1M = $0.004. Cache hits (within 5-min TTL): ~5%
hit rate at 2/hr volume → ~45 hits/mo × 1,024 tokens × $0.30/1M = ~$0.01/mo saved. **Not meaningful
at current volume** — worth doing for correctness and future-proofing, not immediate ROI.

**Risk:** Very low. Cache-miss path is identical to today. Additive `cache_control` field. API
rejects cache writes below 1,024 tokens (returns error, falls through to uncached call gracefully).

**Rollout:** After R4. Expand static blocks, add `cache_control`, test with
`CONTENTFORGE_AI_PROVIDER=anthropic` in staging.

**Rollback:** Remove `cache_control` field.

**Source:** §9.4 R5, §12.5, §12.6

---

### R10 — Image size quality knob

**Change:** Add `CONTENTFORGE_IMAGE_SIZE` env var (default `"2K"`) to `callReplicateApi`. This
allows downgrading non-hero images to `"1K"` for a ~30% per-image cost reduction when Replicate
pricing scales with resolution.

**Files:**

- [`functions/index.js:1904`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1904) — `callReplicateApi`

**Cost delta:** Minimal at current volume. Relevant if thumbnail/preview slots are added at scale.

**Risk:** Low. Env-var controlled; existing behavior unchanged if var is unset.

**Rollout:** Bundle with G1 (two-tier image quality). Set per-slot via
`CONTENTFORGE_IMAGE_SIZE_HERO=2K` and `CONTENTFORGE_IMAGE_SIZE_THUMB=1K`.

**Rollback:** Unset both vars.

**Source:** §9.4 R10

---

### R7 — Flux-schnell evaluation for thumbnails

**Change:** Evaluate `flux-schnell` ($0.003/image — 92% cheaper than Imagen-4) for low-stakes
thumbnail or slot images if a second image size tier is introduced.

**Deferred.** Visually different style from Imagen-4 (strong stylization vs. photorealistic). Do not
mix models on the same page without a style comparison. Re-evaluate after G1 (two-tier) is live and
there is a clear "thumbnail" slot that is visually separate from hero covers.

**Source:** §9.4 R7, §11.1

---

## Rollout order (recommended)

Ordered by impact × ease. Earlier items unblock later ones.

| Step | Item               | Why now                                                                       |
| ---- | ------------------ | ----------------------------------------------------------------------------- |
| 1    | **R2**             | Largest immediate saving (−$12/mo); zero risk; single env var                 |
| 2    | **R3**             | Closes the only code drift before anything else changes image gen             |
| 3    | **R9**             | Token logging before any model swaps — validates cost projections             |
| 4    | **R4 + R6**        | Bundle as "router defaults refresh"; dormant but eliminates fall-through risk |
| 5    | **G3**             | Env-var only; quality win on architecture diagrams; +$2.27/mo acceptable      |
| 6    | **G4**             | Env-var only A/B; validate draft quality; decide keep or revert               |
| 7    | **G5**             | Auto alt-text; ~$1.44/mo; accessibility + SEO win with existing tooling       |
| 8    | **R8**             | Deferred `postContent`; meaningful savings at 10×; needs UI work              |
| 9    | **G1 + R10**       | Two-tier image quality; bundle after R2 validated                             |
| 10   | **R5**             | Anthropic caching; after R4 + static block expansion                          |
| 11   | **G2**             | Fallback image provider; resilience item; after core path stable              |
| 12   | **G6, G7, G8, R7** | Post-launch backlog                                                           |

---

## §5 — Approval gate

**Instructions:** For each item below, replace the status with one of:

- `APPROVED` — ship in Stage 7
- `DEFERRED` — not now; add reason
- `REJECTED` — will not do; add reason

| ID  | Tier | Summary                                  | Est. $/mo delta | Status     | Notes                                                                     |
| --- | ---- | ---------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------- |
| R2  | 1    | Imagen-4 → Imagen-4-fast (env var)       | −$12/mo         | `APPROVED` | Shipped Stage 7                                                           |
| R3  | 1    | Delete orphan dall-e-3 script            | ~$0             | `APPROVED` | Shipped Stage 7                                                           |
| R4  | 2    | Refresh Anthropic router defaults        | $0 (dormant)    | `APPROVED` | Shipped Stage 7                                                           |
| R6  | 2    | Refresh OpenAI router defaults           | $0 (dormant)    | `APPROVED` | Shipped Stage 7                                                           |
| G3  | 2    | Architecture diagram → gemini-2.5-pro    | +$2.27/mo       | `APPROVED` | Env-var only; set CONTENTFORGE_VERTEX_MULTIMODAL_MODEL in Firebase config |
| G4  | 2    | Draft model A/B (flash-lite → flash)     | +$0.45/mo       | `APPROVED` | Env-var only; set CONTENTFORGE_VERTEX_DRAFT_MODEL in Firebase config      |
| R8  | 2    | Defer postContent to publish time        | −$2.57–4.28/mo  | `APPROVED` | Shipped Stage 7                                                           |
| G1  | 3    | Two-tier image quality (hero vs. thumb)  | ~$0 net         | `APPROVED` | Shipped Stage 7                                                           |
| G2  | 3    | Fallback image provider (OpenAI standby) | ~$0 normally    | `APPROVED` | Shipped Stage 7                                                           |
| G5  | 3    | Auto alt-text on article images          | +$1.44/mo       | `APPROVED` | Shipped Stage 7                                                           |
| G6  | 3    | Blog post narration / TTS                | TBD             | `DEFERRED` | Re-evaluate post-launch                                                   |
| G7  | 3    | Semantic dedup via embeddings            | TBD             | `DEFERRED` | Re-evaluate at >200 articles                                              |
| G8  | 3    | Related articles via embeddings          | TBD             | `DEFERRED` | Re-evaluate at >200 articles                                              |
| R9  | 4    | Token + cost logging in router           | $0              | `APPROVED` | Shipped Stage 7                                                           |
| R5  | 4    | Anthropic prompt caching                 | ~$0 today       | `APPROVED` | Shipped Stage 7                                                           |
| R10 | 4    | Image size quality knob                  | small           | `APPROVED` | Shipped Stage 7                                                           |
| R7  | 4    | Flux-schnell for thumbnails              | TBD             | `DEFERRED` | Re-evaluate after G1                                                      |
