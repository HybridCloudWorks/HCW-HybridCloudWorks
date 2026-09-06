# AI Integration Inventory

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** May 11, 2026 **Status:** Stage 6 of 7-stage AI Review complete — awaiting user
approval (see [TODO.md](../archive/legacy-frontend-todo.md)) **Owner:**
ContentForge / HCW **Scope:** All AI provider call sites in `functions/`, `src/`, and `scripts/` as
of commit `41bb824` (May 10, 2026 root cleanup).

This is a **reference catalog**. No model swaps happen until Stage 6 produces a recommendation set
the user explicitly approves. Treat this document as the source of truth that Stages 2–5 extend.

---

## 1. Architecture summary

All text + JSON model calls inside Cloud Functions go through a **single abstraction layer**:
[`functions/lib/ai-model-router.js`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js). The router supports three
providers selected by `CONTENTFORGE_AI_PROVIDER`:

- `vertex` (default) — Google Vertex AI Generative API via `@google-cloud/vertexai` SDK
- `openai` — direct REST to `api.openai.com/v1/chat/completions`
- `anthropic` — direct REST to `api.anthropic.com/v1/messages`

Image generation does **not** route through the abstraction — call sites use the `replicate` SDK
directly. There is also one orphan OpenAI direct-call script outside the router (see entry #5
below).

**No embeddings, no TTS, no STT/Whisper, no ElevenLabs, no Gemini direct (only via Vertex), no
Anthropic image generation in use today.** Search confirmed: zero hits for `text-embedding-*`,
`tts-1`, `whisper-`, `elevenlabs`, `gpt-image-1` anywhere in functions/scripts/src.

**Anthropic prompt caching:** NOT configured. The router's `callAnthropic` does not set
`cache_control` on any block. This is a Stage 5 finding to flag now (router code:
`functions/lib/ai-model-router.js:182-224`).

---

## 2. Call site inventory

| #   | File:line                                                                    | Function                     | Provider/SDK                    | Default model                                               | Purpose                                                                                                                                                     | Trigger                                                                                                     | Avg input tokens (est)                          | Avg output tokens (est)            | Calls/day (est)                              |
| --- | ---------------------------------------------------------------------------- | ---------------------------- | ------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| 1   | [`functions/cms-functions.js:1794`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1794)     | `generateArticleDraft`       | router → Vertex                 | `gemini-2.5-flash-lite` (`CONTENTFORGE_VERTEX_DRAFT_MODEL`) | Generate full blog draft JSON from source URL/markdown + optional PDF documents                                                                             | Admin submits a URL or uploaded doc via admin portal                                                        | 8K–20K (markdown + PDF base64)                  | 2K–4K (1000+ word post + metadata) | 0–10 pre-launch                              |
| 2   | [`functions/index.js:1507`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1507)                     | `analyzeArticleMetadata`     | router → Vertex                 | `gemini-2.5-flash` (`CONTENTFORGE_VERTEX_ANALYSIS_MODEL`)   | Extract title/summary/cloudProvider/keyTopics/visualTheme + 1000-word post body from scraped article markdown                                               | RSS / manual URL ingestion pipeline (`processIngestUrl`, `upsertRssItemsAsBlogs`, `ingestFirecrawlArticle`) | ~15K (`markdownContent.substring(0, 15000)`)    | ~2K (JSON metadata + body)         | 10–50 pre-launch (rises with RSS feed count) |
| 3   | [`functions/index.js:1571`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1571)                     | `analyzeArchitectureDiagram` | router → Vertex (multimodal)    | `gemini-2.5-flash` (`CONTENTFORGE_VERTEX_MULTIMODAL_MODEL`) | Multimodal image+text → architecture spec JSON (components, costs, Terraform, deployment steps)                                                             | Architecture submission flow (admin uploads diagram)                                                        | Prompt ~600 + image (typically 50K–500K base64) | ~1.5K (structured JSON)            | 0–5 pre-launch                               |
| 4a  | [`functions/index.js:1916`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1916)                     | `callReplicateApi`           | Replicate SDK                   | `google/imagen-4`                                           | Cover image, 16:9 / 2K PNG, content-safety `block_medium_and_above`                                                                                         | Per published article (post-draft, pre-publish)                                                             | Prompt ~500 chars                               | 1 PNG (~2–5 MB)                    | 5–30 pre-launch                              |
| 4b  | [`functions/cms-functions.js:1934`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1934)     | `generateImageByPrompt`      | Replicate SDK                   | `google/imagen-4`                                           | Same model + same params as 4a, **separate call site** that wraps the SDK with `useFileOutput: false` compat shim (PR #160 — replicate@1.x default changed) | Image-prompts admin tool / manual regen flow                                                                | Prompt ~500 chars                               | 1 PNG                              | 0–10 pre-launch                              |
| 5   | `scripts/generate-ai-covers.js:101` *(historical target unavailable)* | `generateImage`              | **OpenAI direct (raw `https`)** | **`dall-e-3`** ⚠️                                           | One-off bulk cover regeneration (1792×1024, hd, vivid)                                                                                                      | Manual script run, not in Cloud Functions                                                                   | Prompt ~500 chars                               | 1 PNG (~2–5 MB)                    | Manual / on-demand only                      |

### ⚠ Stale model in entry #5

`scripts/generate-ai-covers.js` uses `dall-e-3` directly via raw `https`. This is the only remaining
DALL·E reference in the repo and bypasses the router. It also bypasses the live image-gen path
(which is Replicate Imagen-4). This is the **single highest-priority Stage 2 finding** — `dall-e-3`
is superseded by `gpt-image-1`, and the script being divergent from the prod path means cover style
can drift from the live site. **No action in Stage 1; documented for Stage 2 mapping.**

---

## 3. Models defined in router lookup table

Defined in [`functions/lib/ai-model-router.js:12-31`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L12) —
lists every (provider × purpose) default the router falls back to when env override is unset.

| Provider  | Purpose    | Default model                | Env override                              |
| --------- | ---------- | ---------------------------- | ----------------------------------------- |
| vertex    | draft      | `gemini-2.5-flash-lite`      | `CONTENTFORGE_VERTEX_DRAFT_MODEL`         |
| vertex    | analysis   | `gemini-2.5-flash`           | `CONTENTFORGE_VERTEX_ANALYSIS_MODEL`      |
| vertex    | multimodal | `gemini-2.5-flash`           | `CONTENTFORGE_VERTEX_MULTIMODAL_MODEL`    |
| vertex    | general    | `gemini-2.5-flash-lite`      | `CONTENTFORGE_VERTEX_MODEL`               |
| openai    | draft      | `gpt-4o-mini`                | `CONTENTFORGE_OPENAI_DRAFT_MODEL`         |
| openai    | analysis   | `gpt-4o-mini`                | `CONTENTFORGE_OPENAI_ANALYSIS_MODEL`      |
| openai    | multimodal | `gpt-4o-mini`                | `CONTENTFORGE_OPENAI_MULTIMODAL_MODEL`    |
| openai    | general    | `gpt-4o-mini`                | `CONTENTFORGE_OPENAI_MODEL`               |
| anthropic | draft      | `claude-3-5-sonnet-latest` ⚠ | `CONTENTFORGE_ANTHROPIC_DRAFT_MODEL`      |
| anthropic | analysis   | `claude-3-5-sonnet-latest` ⚠ | `CONTENTFORGE_ANTHROPIC_ANALYSIS_MODEL`   |
| anthropic | multimodal | `claude-3-5-sonnet-latest` ⚠ | `CONTENTFORGE_ANTHROPIC_MULTIMODAL_MODEL` |
| anthropic | general    | `claude-3-5-sonnet-latest` ⚠ | `CONTENTFORGE_ANTHROPIC_MODEL`            |

Fallback when provider unrecognized: `gemini-2.5-flash-lite`
([line 32](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L32)).

### ⚠ Stale Anthropic defaults

All four Anthropic defaults are `claude-3-5-sonnet-latest`. Current Anthropic family (per knowledge
cutoff Jan 2026) is **Opus 4.7 / Sonnet 4.6 / Haiku 4.5**. Since `vertex` is the active provider,
this is **dormant** — no live calls hit these defaults — but they're a Stage 2 mapping target so an
emergency provider-switch (e.g. Vertex outage) doesn't fall through to Sonnet 3.5.

### OpenAI defaults note

All 4 OpenAI purposes default to `gpt-4o-mini`. Stage 2 should evaluate whether `gpt-4.1-mini` /
`gpt-4.1` is now cheaper/better for `analysis` and `multimodal`, and whether `o4-mini` makes sense
for `draft` (reasoning-heavy).

---

## 4. Environment variables (model selection + auth)

### Provider selection

- `CONTENTFORGE_AI_PROVIDER` — `vertex` | `openai` | `anthropic` (default `vertex`)

### Model overrides (router-aware)

- `CONTENTFORGE_VERTEX_DRAFT_MODEL` / `CONTENTFORGE_VERTEX_ANALYSIS_MODEL` /
  `CONTENTFORGE_VERTEX_MULTIMODAL_MODEL` / `CONTENTFORGE_VERTEX_MODEL`
- `CONTENTFORGE_OPENAI_DRAFT_MODEL` / `_ANALYSIS_MODEL` / `_MULTIMODAL_MODEL` /
  `CONTENTFORGE_OPENAI_MODEL`
- `CONTENTFORGE_ANTHROPIC_DRAFT_MODEL` / `_ANALYSIS_MODEL` / `_MULTIMODAL_MODEL` /
  `CONTENTFORGE_ANTHROPIC_MODEL`
- Legacy / shared (read by call sites before router fallback): `CONTENTFORGE_DRAFT_MODEL`,
  `CONTENTFORGE_ANALYSIS_MODEL`, `CONTENTFORGE_MULTIMODAL_MODEL`

### Vertex

- `GCLOUD_PROJECT` / `GCP_PROJECT` (defaults to `hybridcloudworks-61e8d`)
- `CONTENTFORGE_VERTEX_LOCATION` (default `us-central1`)
- Auth: ADC / service account (no API key)

### OpenAI

- `OPENAI_API_KEY` — used by router AND directly by `scripts/generate-ai-covers.js`

### Anthropic

- `ANTHROPIC_API_KEY` — used by router only (no live call sites yet, since provider is `vertex`)

### Replicate

- `REPLICATE_API_KEY` — Firebase Functions secret via `defineSecret`
  ([`functions/cms-functions.js:33`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L33),
  [`functions/index.js:34`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L34))

### Headless fallback (orchestration, not AI)

- `CONTENTFORGE_HEADLESS_FALLBACK_ENABLED` / `CONTENTFORGE_HEADLESS_FALLBACK_URL` — for
  hard-to-extract source URLs

---

## 5. Prompts (token sizing reference)

These are the prompts sent to the model. Sizes are character counts; tokens roughly char/4 for
English.

### Draft generation (`generateArticleDraft`)

- Built dynamically from `parts[]` — system text + each `Supporting document N` block + optional PDF
  base64 (`inlineData`).
- Largest realistic input: ~80–120 KB when a 5 MB PDF is attached (base64 inflates 4/3 ×).
- Output target: `postContent` >= 1000 words ≈ 6 KB ≈ 1.5–2K tokens.

### Article metadata + post body (`analyzeArticleMetadata`, [index.js:1480-1500](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1480))

- Prompt is fixed-shape JSON contract + truncated source: `markdownContent.substring(0, 15000)`.
- Static portion ~1.5 KB, dynamic source up to 15 KB → ~16.5 KB ≈ 4–5K tokens input.
- Output: 1 JSON object with `postContent` (1000+ word post) → ~6–8K chars ≈ 1.5–2K tokens.

### Architecture multimodal (`analyzeArchitectureDiagram`, [index.js:1531-1564](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1531))

- Static prompt ~2.4 KB ≈ 600 tokens.
- Image: PNG diagram inlined as base64 — multimodal token cost is per-image (Gemini 2.5: 258 tokens
  per 384×384 tile, scales with size).
- Output: ~1.5K tokens (architecture spec JSON with cost breakdown + Terraform).

### Image prompts (Replicate Imagen-4)

- Built by `buildPrompt(article)` ([index.js:1827-1891](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1827)) — fully
  templated, ~400–600 chars. Two variants (rich-metadata vs legacy fallback).
- No token cost — Imagen-4 pricing is per-image.

### Image prompts (DALL·E 3 — orphan script)

- `scripts/generate-ai-covers.js:88` — same Lego-character template, ~500 chars.
- Pricing per-image (1792×1024 hd vivid).

---

## 6. Caching status (preview for Stage 5)

| Call site                                        | Cache-eligible?                       | Configured? | Notes                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generateArticleDraft` (Vertex)                  | Vertex context caching is GA          | No          | Static instruction header is small (<1K tokens); not worth caching alone, but per-document repeats are unlikely so skip.                          |
| `analyzeArticleMetadata` (Vertex)                | Vertex context caching is GA          | No          | Static instruction block is ~1.5K tokens and runs on every ingest — **caching candidate**.                                                        |
| `analyzeArchitectureDiagram` (Vertex multimodal) | Vertex context caching is GA          | No          | Static prompt is ~600 tokens and image is unique per call — caching offers limited win.                                                           |
| Anthropic router path                            | `cache_control` ephemeral (5-min TTL) | **No**      | Router does not set `cache_control` anywhere. If provider switches to anthropic, large repeated system blocks would not benefit. **Stage 5 fix.** |
| OpenAI router path                               | OpenAI auto prompt caching at scale   | n/a         | Auto, no config. Low traffic = no hits.                                                                                                           |

---

## 7. Feature gaps (preview for Stage 4)

Items the site does **not** do today but new model capabilities make plausible:

- **Embeddings / semantic search** — none. Could enable better related-article suggestions, dedup
  tightening (currently URL+canonical+title-7d, see TODO.md "Dedup pipeline"), or RAG over published
  content.
- **TTS narration** for blog/architecture pages — none. The 3 audio pages today list episodes, not
  auto-narrate site content.
- **STT / Whisper** — none. Not currently a need.
- **Vision-on-ingest** — only multimodal architecture analysis uses image input. Article ingest does
  NOT auto-generate alt-text or extract diagrams from scraped HTML.
- **Reasoning models** for cost/architecture analysis — currently flash-tier; `gemini-2.5-pro` or
  `o4-mini` could improve `analyzeArchitectureDiagram` quality.

These are noted only — Stage 4 will evaluate effort vs. impact.

---

## 8. Stage 1 outputs / handoff

- ✅ Inventory captured for **5 call sites** across **3 providers** (Vertex / Replicate /
  OpenAI-direct).
- ✅ Router lookup table captured (12 default-model entries).
- ✅ Env vars enumerated (provider, models, auth, headless).
- ✅ Prompt sizes captured for token math in Stage 3.
- ✅ Caching status preview captured for Stage 5.
- ✅ Feature gap candidates captured for Stage 4.

---

## 9. Stage 2 — Efficiency, correctness, and model-fitness recommendations

**Updated:** May 10, 2026. Pricing snapshots verified against provider pages (Vertex / OpenAI /
Anthropic / Replicate) the same day.

This section evaluates each AI call against two questions:

1. **Is it firing at the right lifecycle stage?** (the user's "draft vs published, auto vs manual"
   rubric — automatic spend on a draft that will likely be discarded is bad spend; automatic spend
   post-publish or manual spend on a draft is good spend).
2. **Is the model the right cost/capability fit?** (using current real-world list pricing, not Feb
   2026 baselines).

### 9.1 Lifecycle audit per call site

| #       | Call site                                                                                                                           | Trigger reality                                                                                                                                                                                                                                                           | Lifecycle verdict                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | `generateArticleDraft`                                                                                                              | Admin POSTs URL/PDF via portal → draft is generated on demand                                                                                                                                                                                                             | ✅ **Correct** — manual, intentional                                                                                                                                                                                                                                                                                                                                                    |
| 2       | `analyzeWithGemini` (article metadata + body)                                                                                       | Auto on every URL ingest from RSS/manual/Firecrawl ([`inspectAndPopulateArticle`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1767))                                                                                                                                                           | ✅ **Acceptable** — small token cost ($0.30/$2.50 per 1M @ Gemini 2.5 Flash) and it's the only path that produces useful metadata. The 1000-word `postContent` field could be deferred to publish (see 9.4) but isn't a high-cost item.                                                                                                                                                 |
| 3       | `analyzeArchitectureDiagram`                                                                                                        | Per architecture submission                                                                                                                                                                                                                                               | ✅ **Correct** — manual, intentional                                                                                                                                                                                                                                                                                                                                                    |
| 4a + 4b | `callReplicateApi` / `generateImageByPrompt` (Imagen-4 covers) for `generateAiCoverOnTrigger` and `generateAiCoverOnContentTrigger` | **Auto-fires when `altCoverImageTrigger=true`. That flag is auto-set at the end of Stage-1 ingestion ([`buildInspectionUpdateData` index.js:1700](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1700))**, BEFORE any human review — unless caller explicitly passes `skipImageGeneration: true`. | 🚨 **BAD SPEND** — exactly the rubric example. Most ingested URLs never get published; we're paying ~$0.04 per draft to generate a cover the admin will then reject. The team's own [`pipeline-stage1-features.md:241-245`](../archive/pipeline-stage1-features.md) calls out the exact savings: "94 URLs × $0.04 = $3.76 vs. picking 15 to publish = $0.60." That's the 6× waste happening today. |
| 4c      | `generateImageByPrompt` via `generatePreviewImages` and `generateCuratedArticleImage` (admin tools)                                 | Admin-initiated POST                                                                                                                                                                                                                                                      | ✅ **Correct** — manual                                                                                                                                                                                                                                                                                                                                                                 |
| 5       | `scripts/generate-ai-covers.js` (`dall-e-3`)                                                                                        | Manual one-off bulk run                                                                                                                                                                                                                                                   | ⚠️ **Wrong tool** — script has drifted (uses DALL-E 3 while prod uses Imagen-4); style won't match. Also DALL-E 3 is now deprecated (see 9.3).                                                                                                                                                                                                                                          |

### 9.2 The headline finding: cover image at draft time

**Default behavior today:** ingestion writes `altCoverImageTrigger=true` automatically. The
Firestore trigger then spends ~$0.04 on Imagen-4 for a draft that may never be published.

**Defaulting it to false would invert the spend pattern correctly:**

- Drafts cost $0 in image spend.
- Cover image fires when admin clicks **Publish** (or explicitly clicks **Generate AI cover** in the
  editor).
- Estimated savings at current volume: 60–80% of monthly Imagen-4 spend.

The infrastructure is already built — `skipImageGeneration: true` exists
([`index.js:1699-1701`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1699)) and the documented "Phase 1: Create 94 URLs
with skipImageGeneration = true" workflow proves the team already discovered this is the right
pattern but didn't make it the default.

**Recommendation R1 (Tier 1, no API breakage):** Flip the conditional. Change the line at
[`index.js:1700`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1700) from "auto-set on by default" to "off by default;
require explicit opt-in via `autoGenerateImage: true`" — OR more conservatively, only auto-trigger
when the article is moved to `published` status. This is a config/policy change, not a model swap,
and is the single largest saver in this audit.

### 9.3 Pricing snapshot (May 10, 2026)

Verified against current provider pricing pages.

#### Image generation (per image)

| Model                                           | Provider  | Price       | Status                             |
| ----------------------------------------------- | --------- | ----------- | ---------------------------------- |
| `google/imagen-4` (current prod)                | Replicate | **$0.04**   | Active                             |
| `google/imagen-4-fast`                          | Replicate | **$0.02**   | Active — 50% cheaper               |
| `google/imagen-4-ultra`                         | Replicate | $0.06       | Active — quality variant           |
| `gpt-image-1` low                               | OpenAI    | $0.011      | Active — 73% cheaper than imagen-4 |
| `gpt-image-1` medium                            | OpenAI    | $0.042      | Active                             |
| `gpt-image-1` high                              | OpenAI    | $0.167      | Active                             |
| `flux-1.1-pro`                                  | Replicate | $0.04       | Active                             |
| `flux-schnell`                                  | Replicate | **$0.003**  | Active — 92% cheaper               |
| `dall-e-3` (in `scripts/generate-ai-covers.js`) | OpenAI    | $0.04–$0.12 | **DEPRECATED**                     |

#### Text/JSON (per 1M tokens)

| Model                                                   | Input                        | Output            | Notes                                           |
| ------------------------------------------------------- | ---------------------------- | ----------------- | ----------------------------------------------- |
| `gemini-2.5-flash-lite` (router draft default)          | $0.10                        | $0.40             | Active                                          |
| `gemini-2.5-flash` (router analysis/multimodal default) | $0.30                        | $2.50             | Active                                          |
| `gemini-2.5-pro`                                        | $1.25                        | $10.00            | Active                                          |
| `gemini-3-flash` (preview)                              | ~$0.25                       | ~$1.50–2.00       | Successor to 2.5-flash                          |
| `gpt-4o-mini` (router OpenAI default)                   | unable to confirm            | unable to confirm | Likely deprecated; pricing page no longer lists |
| `gpt-5-mini`                                            | $0.25                        | $2.00             | Active — successor                              |
| `gpt-5-nano`                                            | $0.05                        | $0.40             | Active — cheapest                               |
| `gpt-4.1-mini`                                          | $0.40                        | $1.60             | Active                                          |
| `claude-3-5-sonnet-latest` (router Anthropic default)   | not on current pricing table | —                 | **STALE**                                       |
| `claude-haiku-4-5`                                      | $1.00                        | $5.00             | Active                                          |
| `claude-sonnet-4-6`                                     | $3.00                        | $15.00            | Active                                          |
| `claude-opus-4-7`                                       | $5.00                        | $25.00            | Active                                          |

#### Anthropic prompt caching savings (5-min TTL)

- Cache write: 1.25× base input price (one-time)
- Cache hit (read): **0.10× base input price (90% discount)**
- Break-even: after the first cache hit
- Currently: **NOT configured** in
  [`functions/lib/ai-model-router.js`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L182). Dormant today
  (Vertex is active provider) but if provider ever flips to anthropic, this is a 90% miss on
  repeated system prompts.

### 9.4 Recommendations table

| ID      | Tier | Type           | Recommendation                                                                                                                                                                                                                                                    | Files                                                                                                                              | Est. monthly impact (pre-launch)                                                                                                                                        | Risk                                                                                                                  | Rollback                                                                                |
| ------- | ---- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **R1**  | 1    | Lifecycle      | Stop auto-setting `altCoverImageTrigger=true` after Stage-1 ingestion. Default OFF; require explicit opt-in flag (`autoGenerateImage: true`) OR fire on publish-status transition only.                                                                           | [`functions/index.js:1699-1701`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1699)                                                                      | **Largest item.** At current low volume, ~$1–3/mo savings; at 10× post-launch, $30–80/mo. More importantly: it stops paying for images on content that never publishes. | Low — `skipImageGeneration` already plumbed through; this is a policy/default flip, not new code.                     | One-line revert. Add admin-portal toggle to choose default per provider/feed if needed. |
| **R2**  | 1    | Model swap     | Migrate Replicate model from `google/imagen-4` ($0.04) → `google/imagen-4-fast` ($0.02). Same provider, same prompt, same SDK, 50% cheaper.                                                                                                                       | [`functions/index.js:1916`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1916), [`functions/cms-functions.js:1934`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1934) | 50% reduction on remaining Imagen spend.                                                                                                                                | Low — same Imagen-4 family; only difference is rendering speed/quality knob. Sample 5 covers visually before keeping. | Env-var-gate: introduce `CONTENTFORGE_IMAGE_MODEL` (default `imagen-4-fast`).           |
| **R3**  | 1    | Retire orphan  | Delete or rewrite `scripts/generate-ai-covers.js`. It uses deprecated `dall-e-3`, divergent from prod (which is Imagen-4), and is a manual one-off. Either delete or rewrite to call the same `generateImageByPrompt` path as the rest of the codebase.           | `scripts/generate-ai-covers.js` *(historical target unavailable)*                                                                | Eliminates the only DALL-E 3 cost in the repo (was ad-hoc, low spend).                                                                                                  | Low — confirm with user nobody has a workflow that depends on this script.                                            | Git history retains the file.                                                           |
| **R4**  | 2    | Model swap     | Update Anthropic router defaults from `claude-3-5-sonnet-latest` (stale, removed from Anthropic's current pricing table) → `claude-sonnet-4-6` for analysis/multimodal/draft general; `claude-haiku-4-5` for cheap fallback.                                      | [`functions/lib/ai-model-router.js:25-30`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L25)                                                | $0/mo today (Vertex is active), but eliminates fall-through risk if provider switches. Pricing parity ($3/$15 in/out for Sonnet 4.6 — same as 3.5-Sonnet was).          | Low — only takes effect on provider flip. Run admin tests with `CONTENTFORGE_AI_PROVIDER=anthropic` before/after.     | Revert single commit.                                                                   |
| **R5**  | 2    | Caching        | Add `cache_control: { type: 'ephemeral' }` to the system prompt in `callAnthropic`. The article-analysis prompt is ~600 tokens and runs on every ingest; caching pays back on the first hit within 5 min.                                                         | [`functions/lib/ai-model-router.js:182-224`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L182)                                             | $0/mo today; meaningful if provider flips. Independently a future-proofing investment for Stage 5.                                                                      | Very low — additive header field. Cache-miss path is unchanged.                                                       | Remove the field.                                                                       |
| **R6**  | 2    | Model swap     | Update OpenAI router defaults from `gpt-4o-mini` (deprecated/removed from current pricing) → `gpt-5-mini` ($0.25/$2.00) for general/draft/analysis; `gpt-5-nano` ($0.05/$0.40) for `general` if cost-priority.                                                    | [`functions/lib/ai-model-router.js:19-24`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js#L19)                                                | $0/mo today (Vertex active); eliminates fall-through risk. Pricing roughly halved vs. legacy gpt-4o tier.                                                               | Low — same chat-completions API shape.                                                                                | Revert single commit.                                                                   |
| **R7**  | 2    | Model swap     | If Imagen-4 quality becomes a concern post-R2, evaluate `flux-schnell` ($0.003/image — 92% cheaper than current) for low-stakes thumbnails. Keep Imagen-4 / Imagen-4-Ultra for hero covers.                                                                       | [`functions/index.js:1916`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1916)                                                                           | Could cut image budget another 80% on slot images.                                                                                                                      | Medium — visually different style from Imagen; needs sample comparison.                                               | Per-slot env var (`CONTENTFORGE_IMAGE_MODEL_HERO`, `_THUMB`).                           |
| **R8**  | 3    | Capability gap | The 1000-word `postContent` field is generated during ingest (`analyzeWithGemini`) but most articles will never be published. Defer `postContent` generation to a later stage (manual editor click or publish) and keep ingest cheap (just title/summary/topics). | [`functions/index.js:1480-1500`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1480)                                                                      | Modest text-token savings (~30-50% on Gemini analysis spend). Aligns with the same "draft vs published" rubric as R1.                                                   | Medium — needs prompt split into "metadata-only" and "metadata+body" variants and a UI button to trigger the body.    | Keep both prompts in code; flag-gate.                                                   |
| **R9**  | 4    | Architecture   | Add minimal token + cost logging to the router so post-deploy we can validate every recommendation's projected impact. Currently we have no per-purpose, per-model spend attribution.                                                                             | [`functions/lib/ai-model-router.js`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/lib/ai-model-router.js)                                                          | Enables Stage 3 cost-analysis with real numbers instead of estimates.                                                                                                   | Low — additive logging.                                                                                               | Remove.                                                                                 |
| **R10** | 4    | Architecture   | Add `image_size` quality knob to the Replicate prompt (currently hardcoded `"2K"` in `callReplicateApi`). Imagen-4 covers are 2K; thumbnails or low-priority slots could downgrade to 1K and save $.                                                              | [`functions/index.js:1904`](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1904)                                                                           | Small per-image savings (~30%) on non-hero slots.                                                                                                                       | Low.                                                                                                                  | Constant flip.                                                                          |

### 9.5 Suggested rollout order

1. ~~**Ship R1 first**~~ ✅ **SHIPPED May 11, 2026** — commit `cbf9b81`. Inverted the
   `buildInspectionUpdateData` default: `altCoverImageTrigger` no longer fires automatically at
   inspection. Two explicit opt-ins preserved (`generateAiCoverOnInspect=true` and legacy
   `skipImageGeneration` field). New helper `applyPublishTimeCoverTrigger` in `publishNewBlog` sets
   the trigger at publish time, skipping when a cover already exists or when a generation is in
   flight. Same lifecycle rubric as F2 in the Firebase audit.
2. **Then R3** — delete or rewrite the orphan dall-e-3 script (housekeeping; closes a documented
   drift).
3. **Then R2** — Imagen-4 → Imagen-4-fast swap, gated behind env var, with sample comparison.
4. **Then R5** — Anthropic prompt caching wiring (future-proofing, no live impact today but clean to
   land).
5. **R4 + R6** — bundled router-default refresh (Anthropic + OpenAI). Dormant impact but eliminates
   fall-through risk.
6. **R9** — observability before R7/R8, so we can measure those.
7. **R7 / R8** — capability/model swaps that need sampling and quality validation.
8. **R10** — image-size knob refinement.

### Approval gate

Per TODO.md §AI Review: **no model swaps ship until the user signs off per item.** R1 (the lifecycle
fix) is the single highest-leverage change and is a behavior policy change, not a model swap — it's
still gated on user approval but should be the first decision.

---

## 10. Stage 3 — Cost Analysis

**Added:** May 11, 2026. **Prerequisite:** Stage 1 (token sizing) + Stage 2 (pricing snapshot)
complete. **Constraint:** No in-app token logging exists today (R9 is a future item). All figures
below are computed from Stage 1 token estimates × Stage 2 pricing. Replace the "Est. volume" column
with real call counts once you pull billing actuals (see §10.4).

---

### 10.1 Per-call cost breakdown

Mid-range token estimates from Stage 1 × list pricing from §9.3.

| #   | Call site                             | Model                   | Input tokens (mid)         | Output tokens (mid) | Input $/M | Output $/M | **Per-call cost** |
| --- | ------------------------------------- | ----------------------- | -------------------------- | ------------------- | --------- | ---------- | ----------------- |
| 1   | `generateArticleDraft`                | `gemini-2.5-flash-lite` | 14,000                     | 3,000               | $0.10     | $0.40      | **$0.0026**       |
| 2   | `analyzeArticleMetadata`              | `gemini-2.5-flash`      | 15,000                     | 2,000               | $0.30     | $2.50      | **$0.0095**       |
| 3   | `analyzeArchitectureDiagram`          | `gemini-2.5-flash`      | 2,664 (text + image tiles) | 1,500               | $0.30     | $2.50      | **$0.0045**       |
| 4a  | `callReplicateApi` — covers (post-R1) | `google/imagen-4`       | —                          | 1 PNG               | —         | —          | **$0.04 flat**    |
| 4b  | `generateImageByPrompt` — curated     | `google/imagen-4`       | —                          | 1 PNG               | —         | —          | **$0.04 flat**    |

**Token math detail:**

- **#1** `generateArticleDraft`: 14K in × ($0.10/1M) = $0.0014 + 3K out × ($0.40/1M) = $0.0012 →
  **$0.0026**
- **#2** `analyzeArticleMetadata`: 15K in × ($0.30/1M) = $0.0045 + 2K out × ($2.50/1M) = $0.0050 →
  **$0.0095**
- **#3** `analyzeArchitectureDiagram`: prompt ~600 tokens + 1 image tile block (~2,064 tokens at
  Gemini 2.5 tile pricing for a typical diagram) = ~2,664 in × ($0.30/1M) = $0.0008 + 1.5K out ×
  ($2.50/1M) = $0.0038 → **$0.0045** _(Image tile count scales with diagram resolution; 2,064 is a
  mid estimate for a 1024×1024 PNG.)_
- **#4a / #4b**: Replicate Imagen-4 is flat-rate per image — no token component.

---

### 10.2 Monthly projections — current vs. proposed

| Call site                             | Est. volume               | **Current/mo** | Proposed change             | **Proposed/mo** | **10× proposed/mo** |
| ------------------------------------- | ------------------------- | -------------- | --------------------------- | --------------- | ------------------- |
| `generateArticleDraft`                | 150/mo (5/day)            | $0.39          | No change                   | $0.39           | $3.90               |
| `analyzeArticleMetadata`              | 900/mo (30/day)           | $8.55          | No change                   | $8.55           | $85.50              |
| `analyzeArchitectureDiagram`          | 60/mo (2/day)             | $0.27          | No change                   | $0.27           | $2.70               |
| Imagen-4 covers (post-R1, at publish) | 450/mo (15 publishes/day) | $18.00         | R2: `imagen-4-fast` ($0.02) | $9.00           | $90.00              |
| Imagen-4 curated (RSS admin tool)     | 150/mo (5/day)            | $6.00          | R2: `imagen-4-fast` ($0.02) | $3.00           | $30.00              |
| **Total**                             |                           | **~$33.21/mo** |                             | **~$21.21/mo**  | **~$212/mo**        |

**Pre-R1 reference (baseline before May 11, 2026):**

Before R1 shipped, `altCoverImageTrigger=true` fired automatically on every ingest — approximately
94 URLs/day. At $0.04/image:

- 94/day × $0.04 = **$3.76/day → ~$113/mo** on image generation alone.
- Post-R1, image spend is capped to actual publishes (~15/day) + curated admin calls (~5/day) =
  **~$24/mo**.
- **R1 alone reduced image spend by ~80%** ($113/mo → $24/mo).

Applying R2 (`imagen-4-fast` swap) on top of R1 would bring image spend to ~$12/mo — a further 50%
reduction from the post-R1 baseline.

---

### 10.3 Top 3 cost drivers

Ranked by share of current monthly spend (~$33.21/mo):

| Rank  | Call site                                   | Monthly cost | % of total | Notes                                                          |
| ----- | ------------------------------------------- | ------------ | ---------- | -------------------------------------------------------------- |
| **1** | Imagen-4 covers (post-R1)                   | $18.00       | **54%**    | Fixed per-image; scales with publish volume, not ingest volume |
| **2** | `analyzeArticleMetadata` (Gemini 2.5 Flash) | $8.55        | **26%**    | Scales linearly with RSS ingest rate; 30/day mid-estimate      |
| **3** | Imagen-4 curated RSS images                 | $6.00        | **18%**    | Fixed per-image; scales with admin-tool usage                  |

Text generation (`generateArticleDraft` + `analyzeArchitectureDiagram`) = **$0.66/mo combined
(<2%)** — effectively negligible at current volume.

---

### 10.4 Image vs. token cost flag

**Image generation (Replicate Imagen-4) accounts for ~72% of total spend at current volume** ($24.00
/ $33.21).

At 10× post-R2 volume, image spend is still the plurality (~57%: $120 / $212) but token costs begin
to matter — `analyzeArticleMetadata` reaches **$85.50/mo** and would rival image spend if ingest
volume scales faster than publish volume.

Key implication: image and token costs **scale differently**:

- **Image costs** track publish + admin-tool invocation counts. R1 already decoupled image spend
  from ingest volume. R2 can halve the remaining image spend cheaply.
- **Token costs** track ingest volume. R8 (defer `postContent` body generation to publish) is the
  only lever that could materially reduce token spend at scale — by eliminating the 1000-word output
  on articles that never get published.

At 10×, if R8 is NOT shipped: metadata analysis alone = $85.50/mo, rising to the #1 cost driver and
reversing the current image-dominance pattern.

---

### 10.5 Actual spend placeholders

Replace these once you pull 30-day billing actuals (see §10.6):

| Provider      | 30-day actual spend              | Notes                                                                                                 |
| ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GCP Vertex AI | **[ACTUAL — pull from billing]** | Should map mostly to `analyzeArticleMetadata` + `generateArticleDraft` + `analyzeArchitectureDiagram` |
| Replicate     | **[ACTUAL — pull from billing]** | Should map mostly to Imagen-4 cover + curated image calls                                             |
| OpenAI        | **[ACTUAL — pull from billing]** | Expected ~$0 (Vertex is active provider; `generate-ai-covers.js` is manual only)                      |
| Anthropic     | **[ACTUAL — pull from billing]** | Expected ~$0 (Vertex is active provider)                                                              |

Once actuals are in hand:

1. Reconcile total Vertex AI spend against
   `(analyzeArticleMetadata calls × $0.0095) + (generateArticleDraft calls × $0.0026) + (analyzeArchitectureDiagram calls × $0.0045)`.
2. If actuals diverge >20% from projections, re-check token estimates in §5 — the metadata
   `substring(0, 15000)` cap is the most likely source of variance.
3. Replicate actuals confirm R1 impact: pre-R1 should show the ~$3.76/day rate; post-R1 should show
   the ~$0.80/day rate.

---

### 10.6 Billing retrieval guide (real 30-day actuals)

No in-app logging exists today (R9 is deferred). Pull manually from each provider dashboard:

| Provider          | Dashboard path                                                                                                           | What to capture                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **GCP Vertex AI** | [console.cloud.google.com](https://console.cloud.google.com) → Billing → Reports → filter SKU "Vertex AI" → last 30 days | Total spend + per-SKU breakdown (text input tokens, text output tokens, image input tokens if any) |
| **Replicate**     | replicate.com/billing → Spending → last 30 days                                                                          | Total spend; filter by model if UI allows (`google/imagen-4` vs. others)                           |
| **OpenAI**        | platform.openai.com/usage → last 30 days                                                                                 | Total spend (expected ~$0; confirms `generate-ai-covers.js` has not been run)                      |
| **Anthropic**     | console.anthropic.com/settings/billing → Usage                                                                           | Total spend (expected ~$0; confirms no provider-flip has occurred)                                 |

Once actuals are available, update §10.5 and reconcile against the per-call math in §10.1.

---

## 11. Stage 4 — Feature gaps & upgrade candidates

**Added:** May 11, 2026. Cross-references §7 (Stage 1 gap preview). Each category answers three
questions: (1) what exists today, (2) what the gap or weak-link is, (3) which model addresses it and
at what effort/impact ratio.

---

### 11.1 Image generation — weak-link evaluation

**Today:** Both production call sites (`callReplicateApi` #4a, `generateImageByPrompt` #4b) use
`google/imagen-4` at $0.04/image via Replicate. Style is consistent: Lego-character themed covers in
a templated prompt.

#### Candidate models evaluated

| Model                       | Provider  | Price/image | vs. current | Style notes                                              | Content policy           |
| --------------------------- | --------- | ----------- | ----------- | -------------------------------------------------------- | ------------------------ |
| `google/imagen-4` (current) | Replicate | $0.04       | —           | Photorealistic + illustration; strong text rendering     | `block_medium_and_above` |
| `google/imagen-4-fast`      | Replicate | $0.02       | **−50%**    | Same family, slightly lower fidelity at close inspection | Same                     |
| `google/imagen-4-ultra`     | Replicate | $0.06       | +50%        | Higher fidelity; noticeable on large hero crops          | Same                     |
| `gpt-image-1` low           | OpenAI    | $0.011      | **−73%**    | Different aesthetic; Lego prompt may render differently  | OpenAI moderation        |
| `gpt-image-1` medium        | OpenAI    | $0.042      | +5%         | Similar to current                                       | Same                     |
| `google/imagen-3`           | Replicate | ~$0.03      | −25%        | Predecessor to Imagen-4; lower prompt adherence          | Same                     |
| `flux-1.1-pro`              | Replicate | $0.04       | flat        | Different aesthetic; strong stylization                  | Replicate moderation     |
| `flux-schnell`              | Replicate | $0.003      | **−92%**    | Noticeable quality drop; best for low-stakes thumbnails  | Same                     |

#### Identified weak-link spots

1. **Style drift between prod and orphan script.** `scripts/generate-ai-covers.js` still uses
   `dall-e-3` (deprecated) — any bulk regen via that script produces covers that don't match the
   Imagen-4 aesthetic. R3 (retire/rewrite) is the fix; no new model needed.

2. **$0.04 flat rate locks every cover to the same quality tier.** No gradient today: hero covers
   (top-of-feed, social share) and low-traffic article thumbnails all cost $0.04. A two-tier model
   (`imagen-4-fast` for drafts/thumbnails + `imagen-4` or `imagen-4-ultra` for published hero
   covers) would reduce average cost without sacrificing visible quality.

3. **No fallback on Replicate outage.** Single-provider; if Replicate is down, cover generation
   silently fails. `gpt-image-1` medium ($0.042) is nearly cost-neutral and would serve as a cold
   standby if the router is extended to image generation.

#### Verdict

- **R2 (`imagen-4-fast`)** remains the correct next step — same family, −50%, near-zero visual risk.
  Sample 5 published covers side-by-side before flipping.
- **`gpt-image-1` low** is worth a sampling comparison post-R2. At $0.011 it's the cheapest viable
  option, but Lego-character prompts may not transfer cleanly to OpenAI's image aesthetic.
- **`flux-schnell`** deferred to R7 (§9.4) — quality too variable for hero covers; keep as a future
  option for low-stakes slot images if a second image size tier is introduced (R10).
- **`imagen-4-ultra`** is a quality upgrade, not a cost upgrade. Relevant only if cover quality
  becomes a brand concern — no action now.

---

### 11.2 Audio — new capability evaluation

**Today:** The site has three audio pages (AWS, Azure, GCP `AudioArchitecture` routes). These are
**listing pages** — they display episode metadata from Firestore, not AI-generated audio. No TTS, no
STT, no audio generation pipeline exists anywhere in `functions/`, `src/`, or `scripts/`.

#### Candidate models evaluated

| Model                                | Provider   | Pricing                        | Latency                | Quality                                      |
| ------------------------------------ | ---------- | ------------------------------ | ---------------------- | -------------------------------------------- |
| `gpt-4o-mini-tts`                    | OpenAI     | ~$0.015/1K chars (est.)        | ~300 ms first-chunk    | Natural, conversational                      |
| `gpt-4o-tts`                         | OpenAI     | ~$0.06/1K chars (est.)         | ~400 ms first-chunk    | Higher fidelity                              |
| `ElevenLabs Flash v2.5`              | ElevenLabs | ~$0.18/1K chars (Starter tier) | ~75–150 ms first-chunk | Studio quality; voice cloning                |
| `Google Chirp 3`                     | GCP        | ~$0.006/1K chars               | ~200 ms                | Neural; supports 100+ languages              |
| `Vertex AI TTS` (Chirp 3 via Vertex) | GCP        | same as Chirp 3                | In-region              | Integrates cleanly with existing Vertex auth |

#### Gap analysis

| Gap                                                                                                      | Use case                                                                       | Effort                                                                 | Impact                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Blog post narration** — no "listen" button on article pages                                            | Auto-narrate `postContent` field at publish time; cache MP3 to Cloud Storage   | Medium (new Cloud Function + Storage write + frontend player)          | Medium — adds engagement; differentiates from plain text competitors   |
| **Architecture diagram voiceover** — `analyzeArchitectureDiagram` output is JSON, not narrated           | Generate a spoken summary from the structured JSON spec                        | Medium (post-process the analysis output)                              | Low-medium — niche; architecture-literate audience may prefer text     |
| **Episode generation from scraped articles** — audio pages list third-party episodes, not generated ones | Auto-generate short (90-sec) episode summaries using TTS from article metadata | High (needs script generation stage + audio storage + feed generation) | High if the goal is original audio content; significant scope increase |

#### Verdict

None of the three audio gaps are low-effort. All require: (a) a new Cloud Function, (b) Cloud
Storage for audio files, (c) frontend audio player integration, and (d) CDN/caching strategy for
MP3s. **Recommended deferral** — audio generation is a Stage 4 _candidate_, not a Stage 6
recommendation. Re-evaluate post-launch once the core content pipeline is stable.

If prioritized, **`Vertex AI TTS` (Chirp 3)** is the natural first choice — it shares the existing
GCP project auth (no new secret), supports 100+ languages, and is the cheapest option. Use for blog
narration pilot before committing to ElevenLabs or OpenAI TTS.

---

### 11.3 Text & reasoning models — upgrade candidates

**Today:** `gemini-2.5-flash-lite` (draft) and `gemini-2.5-flash` (analysis + multimodal) via
Vertex. All three text call sites use the chat/generation endpoint — no reasoning / extended
thinking configured.

#### Where reasoning models could add value

| Call site                         | Current model           | Reasoning candidate              | Rationale                                                                                                                 | Per-call cost delta                                 |
| --------------------------------- | ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `analyzeArchitectureDiagram` (#3) | `gemini-2.5-flash`      | `gemini-2.5-pro` or `o4-mini`    | Complex structured extraction from a diagram image; flash-tier occasionally misses nested dependencies or cost breakdowns | +$0.038/call (`gemini-2.5-pro` at $1.25/$10 per 1M) |
| `generateArticleDraft` (#1)       | `gemini-2.5-flash-lite` | `gemini-2.5-flash` (one tier up) | Draft quality; flash-lite can produce shallower analysis on complex technical topics                                      | +$0.003/call (negligible)                           |
| `analyzeArticleMetadata` (#2)     | `gemini-2.5-flash`      | No upgrade needed                | Output is a fixed JSON schema — reasoning depth adds no value; flash is correct                                           | —                                                   |

#### Evaluated candidates

| Model                               | Provider  | Input $/M | Output $/M  | Best fit                                                                                                                |
| ----------------------------------- | --------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `gemini-2.5-pro`                    | Vertex    | $1.25     | $10.00      | `analyzeArchitectureDiagram` — complex multimodal reasoning                                                             |
| `gemini-3-flash` (preview)          | Vertex    | ~$0.25    | ~$1.50–2.00 | Potential successor to 2.5-flash for analysis; evaluate when GA                                                         |
| `o4-mini`                           | OpenAI    | ~$1.10    | ~$4.40      | Architecture analysis if provider flips to OpenAI; strong structured-output reasoning                                   |
| `claude-opus-4-7` extended thinking | Anthropic | $5.00     | $25.00      | Highest capability ceiling; overkill for current call sites; relevant only for future RAG or multi-step agent scenarios |

#### Verdict

- **`analyzeArchitectureDiagram` is the only call site where a reasoning upgrade has visible quality
  payoff.** The output (components, costs, Terraform, deployment steps) requires inferring
  relationships that don't always survive as discrete tokens in the diagram image. A
  `gemini-2.5-pro` swap adds ~$0.04/call but only fires at ~2/day — **~$2.40/mo incremental cost**
  for meaningfully better architecture specs. Mark as R-new (Tier 2, after R3–R6).
- **`generateArticleDraft` one-tier-up** (`flash-lite` → `flash`) is worth a quality comparison
  before any commit. Cost impact is negligible ($0.39/mo → ~$1.17/mo). Gate behind
  `CONTENTFORGE_VERTEX_DRAFT_MODEL` env override — no code change needed to test.
- **`claude-opus-4-7` extended thinking** deferred — no current call site warrants it. Re-evaluate
  if a multi-step agent or deep research pipeline is added.

---

### 11.4 Vision — gap analysis

**Today:** `analyzeArchitectureDiagram` is the only call site that accepts image input. Article
ingest (`analyzeArticleMetadata`, `generateArticleDraft`) is text-only — scraped markdown with no
image handling.

#### Identified gaps

| Gap                                      | Current behavior                                                                                                         | Model/capability needed                                                              | Effort                                                                               | Impact                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **Auto alt-text on article ingest**      | None — images in scraped HTML are dropped or left with empty/generic alt text                                            | Multimodal call (Gemini 2.5 Flash) per image in scraped HTML                         | Medium — needs image extraction from Firecrawl output + per-image API call at ingest | Medium — accessibility + SEO; alt text improves search indexing of article images             |
| **Diagram extraction from article HTML** | None — diagrams embedded in source articles are not analyzed                                                             | Same multimodal path as `analyzeArchitectureDiagram`                                 | High — needs image URL resolution, download, and base64 encoding mid-ingest          | Low-medium — only valuable for architecture-heavy source articles                             |
| **Cover image content validation**       | None — Replicate returns the PNG without any safety double-check beyond `block_medium_and_above`                         | Vision safety pass on generated cover (GPT-4o vision or Gemini 2.5 Flash multimodal) | Low — one extra API call post-generation                                             | Low — Imagen-4's own content filter is already solid; adds latency and cost for marginal gain |
| **OCR on uploaded PDF diagrams**         | Partial — PDFs sent to `generateArticleDraft` are base64-inlined; Gemini handles OCR natively within the multimodal call | No new model needed — already covered by Gemini multimodal                           | None                                                                                 | —                                                                                             |

#### Verdict

- **Auto alt-text** is the highest-value vision gap. It's a direct accessibility and SEO win, and
  the tooling is already in place (`gemini-2.5-flash` multimodal, same router path as #3). Estimated
  incremental cost: ~$0.0008/image (~600 tokens in, ~100 tokens out). Most articles have 1–3 images
  → ~$0.002/article. At 900 articles/mo: **~$1.80/mo**. Mark as new candidate (Tier 2, low risk).
- **Diagram extraction** deferred — high implementation effort, low payoff given that most source
  articles are text-heavy blog posts not diagram-heavy specs.
- **Cover validation pass** deferred — Imagen-4's built-in filter is sufficient at current volume.

---

### 11.5 Embeddings — gap analysis

**Today:** Zero embedding calls anywhere in `functions/`, `src/`, or `scripts/` (confirmed via Stage
1 search: no `text-embedding-*` hits). All dedup logic is heuristic: URL + canonical URL +
title-7-day window ([`index.js` dedup pipeline](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js)).

#### Evaluated embedding models

| Model                     | Provider     | Dimensions | Price/1M tokens | Notes                                               |
| ------------------------- | ------------ | ---------- | --------------- | --------------------------------------------------- |
| `text-embedding-3-small`  | OpenAI       | 1,536      | $0.020          | Best cost/quality balance for semantic search       |
| `text-embedding-3-large`  | OpenAI       | 3,072      | $0.130          | Higher recall; use if small misses related articles |
| `textembedding-gecko@003` | Vertex (GCP) | 768        | ~$0.025         | Native to existing GCP project; simpler auth        |
| `text-embedding-005`      | Vertex (GCP) | 768        | ~$0.025         | Gecko successor; better multilingual                |

#### Identified gaps

| Gap                             | Current approach                  | Embedding-enabled approach                                                                                | Effort                                                                                                                     | Impact                                                                    |
| ------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Semantic dedup on ingest**    | URL + canonical + title-7d window | Cosine similarity on article title + summary embeddings; catch near-duplicate stories with different URLs | High (requires vector store — Firestore doesn't support ANN queries natively; needs Vertex AI Matching Engine or pgvector) | Medium — reduces duplicate articles in feeds; currently a known TODO item |
| **Related article suggestions** | None                              | KNN on published article embeddings → surface 3–5 related posts per article page                          | High (same vector store requirement)                                                                                       | High — direct engagement/page-depth win                                   |
| **RAG over published content**  | None                              | Embed published `postContent`; allow admin portal to query ("find articles about EKS autoscaling")        | High (full RAG pipeline: chunking + embeddings + retrieval + generation)                                                   | Medium — admin workflow improvement, not user-facing                      |

#### Verdict

All three embedding use cases are blocked on the same infrastructure gap: **no vector store**.
Firestore does not natively support approximate nearest-neighbor (ANN) queries. Options:

1. **Vertex AI Vector Search** (Managed, on GCP — aligns with existing project) — production-grade,
   but adds infrastructure complexity and a standing index cost.
2. **Firestore with manual cosine similarity** — only viable for small corpora (<1K articles); reads
   all embeddings and computes similarity in-process. Temporary solution.
3. **pgvector on Cloud SQL** — would require introducing a second database; significant scope
   increase.

**Recommendation:** defer embeddings until post-launch. The heuristic dedup is good enough for
pre-launch. Add a TODO item to revisit when published article count exceeds ~200 (the point where
semantic dedup and related-article suggestions generate clear user value). When ready, start with
`text-embedding-005` on Vertex (native GCP auth) + Firestore in-process similarity for the first 200
articles, then migrate to Vertex AI Vector Search when corpus grows.

---

### 11.6 Stage 4 summary — gap registry

| #   | Gap                                                     | Category       | Priority | Effort | Recommended action                                                                     |
| --- | ------------------------------------------------------- | -------------- | -------- | ------ | -------------------------------------------------------------------------------------- |
| G1  | Two-tier image quality (draft/thumbnail vs. hero cover) | Image          | P1       | Low    | Bundle with R2; env-var flag per slot type                                             |
| G2  | Fallback image provider on Replicate outage             | Image          | P2       | Medium | Extend router to image path; `gpt-image-1` medium as cold standby                      |
| G3  | `analyzeArchitectureDiagram` reasoning upgrade          | Text/reasoning | P2       | Low    | Env-var swap `CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-pro`; sample 10 diagrams |
| G4  | `generateArticleDraft` quality one-tier-up              | Text/reasoning | P3       | Low    | A/B compare flash-lite vs. flash on 5 drafts; flip env var if better                   |
| G5  | Auto alt-text on article image ingest                   | Vision         | P2       | Medium | New sub-call in `analyzeArticleMetadata`; multimodal path already exists               |
| G6  | Blog post narration (TTS)                               | Audio          | P3       | High   | Defer post-launch; pilot with Vertex TTS (Chirp 3)                                     |
| G7  | Semantic dedup via embeddings                           | Embeddings     | P3       | High   | Defer until >200 published articles; use `text-embedding-005` + Vertex Vector Search   |
| G8  | Related article suggestions via embeddings              | Embeddings     | P3       | High   | Same dependency as G7; bundle                                                          |
| G9  | Style drift fix (orphan `dall-e-3` script)              | Image          | P1       | Low    | Already captured as R3 — retire/rewrite `scripts/generate-ai-covers.js`                |

P1 = ship with current release cycle. P2 = next sprint post-launch. P3 = backlog / post-scale.

---

## 12. Stage 5 — Prompt caching audit

**Added:** May 11, 2026. Code inspected: `functions/lib/ai-model-router.js` (full),
`functions/index.js:1476–1598` (`analyzeWithGemini`, `analyzeArchitectureDiagram`),
`functions/cms-functions.js:271,1764–1835` (`DEFAULT_DRAFT_INSTRUCTION_PROMPT`,
`generateDraftWithGemini`).

---

### 12.1 Router structure — what's actually sent per provider

#### Vertex (`callVertex`, router:77–92)

```
generativeModel.generateContent({
  contents: [{ role: 'user', parts: requestParts }]
})
```

- **No `systemInstruction` parameter.** The Vertex SDK supports a top-level `systemInstruction`
  field that is separately tokenized and eligible for context caching. It is not used — the full
  prompt (static instructions + dynamic article content) is concatenated into a single `user` part.
- **No `cachedContent` reference.** Vertex context caching requires pre-loading content via the
  Caching API and passing the cache name in the request. Not configured.

#### Anthropic (`callAnthropic`, router:182–224)

```
{
  model, max_tokens: 4096, temperature: 0.2,
  messages: [{ role: 'user', content: [...parts] }],
  system: 'Return only valid JSON...'   // only when expectJson=true
}
```

- **`system` field present only on JSON calls** — ~22 tokens ("Return only valid JSON. Do not
  include markdown code fences, prose, or extra commentary."). Well below the 1,024-token minimum
  for Anthropic `cache_control: ephemeral`.
- **No `cache_control` block anywhere** in the router or call sites. The full prompt including the
  large dynamic article content is sent in `messages[0].content` as a single unsegmented block.

#### OpenAI (`callOpenAi`, router:121–149)

```
{ model, messages: [{ role: 'user', content }], temperature: 0.2 }
```

- **No explicit caching headers.** OpenAI applies automatic prompt caching for requests where the
  first 1,024+ tokens of a prompt are identical to a recent request (within the cache TTL).
- No `seed` or `store` parameters set; no Predicted Outputs configured.

---

### 12.2 Static content size per call site

The cache-eligibility threshold for each provider:

| Provider  | Minimum cacheable tokens            | Cache type                                              |
| --------- | ----------------------------------- | ------------------------------------------------------- |
| Vertex AI | **32,768** (per Google Vertex docs) | Context caching — pre-load via Caching API              |
| Anthropic | **1,024** per block                 | `cache_control: { type: 'ephemeral' }` on content block |
| OpenAI    | **1,024** (auto, no config)         | Automatic on identical prompt prefix                    |

Measured static portions of each call site (everything except dynamic URL + article content):

| Call site                         | Static content                                                             | Approx. chars | Approx. tokens | Vertex eligible? | Anthropic eligible? | OpenAI eligible? |
| --------------------------------- | -------------------------------------------------------------------------- | ------------- | -------------- | ---------------- | ------------------- | ---------------- |
| `generateArticleDraft` (#1)       | `DEFAULT_DRAFT_INSTRUCTION_PROMPT` + JSON key list + `Instructions:` block | ~1,100 chars  | ~275 tokens    | ❌ (<32K)        | ❌ (<1,024)         | ❌ (<1,024)      |
| `analyzeArticleMetadata` (#2)     | `You are a technical content analyst...` + JSON schema + Rules             | ~1,650 chars  | ~413 tokens    | ❌ (<32K)        | ❌ (<1,024)         | ❌ (<1,024)      |
| `analyzeArchitectureDiagram` (#3) | `You are a Senior Cloud Architect...` + JSON schema + Rules                | ~2,450 chars  | ~613 tokens    | ❌ (<32K)        | ❌ (<1,024)         | ❌ (<1,024)      |

**Finding: none of the three static instruction blocks meets any provider's minimum cache threshold
in their current form.** All are 275–613 tokens; the Anthropic minimum is 1,024, the Vertex minimum
is 32,768.

---

### 12.3 OpenAI auto-caching assessment

OpenAI automatically caches when the first ≥1,024 tokens of a prompt are identical across requests
within the cache TTL (~5–10 minutes).

The analysis prompt (`analyzeArticleMetadata`) starts with ~413 static tokens before the dynamic
article content. Since the total prompt is typically 15,000+ tokens, the **first 1,024 tokens would
include both the static header (~413 tokens) and the beginning of the article markdown** — which
differs per call. Therefore:

- The first 1,024 tokens are **not identical** across calls.
- OpenAI auto-caching provides **zero benefit** unless the prompt is restructured to put all static
  content first (as a system message or large static block), followed by dynamic content.

At current volume (30/day ≈ 2/hour for metadata), even a restructured prompt would rarely hit the
cache within the TTL before expiry.

**OpenAI auto-caching verdict: not applicable at current prompt structure or volume.**

---

### 12.4 Predicted Outputs (OpenAI) assessment

Predicted Outputs allow providing a `prediction` field with the expected output structure to reduce
latency. Useful when output format is highly predictable (e.g., filling in a template).

The `analyzeArticleMetadata` output is a fixed JSON schema, which is structurally predictable.
However:

- The active provider is Vertex, not OpenAI.
- Predicted Outputs are a latency optimization, not a cost optimization.
- The JSON body fields (`postContent`, `summary`) are fully variable — only the key names are
  predictable. This limits the token saving to the key names only (~50 tokens), below the threshold
  where Predicted Outputs deliver meaningful speedup.

**Predicted Outputs verdict: not worth configuring for current call sites.**

---

### 12.5 Updated caching status table

Extends the §6 preview table with precise token counts and eligibility findings from code
inspection.

| Call site                                     | Provider (active)   | Static tokens | Cache type available      | Configured? | Eligible now?                          | Notes                                                                                                                   |
| --------------------------------------------- | ------------------- | ------------- | ------------------------- | ----------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `generateArticleDraft`                        | Vertex              | ~275          | Context caching           | No          | **No** — 275 << 32,768 threshold       | Threshold reachable only with multi-doc PDF mode (~14K static) — see §12.6                                              |
| `analyzeArticleMetadata`                      | Vertex              | ~413          | Context caching           | No          | **No** — 413 << 32,768 threshold       | Could reach threshold if prompt were padded with a large static corpus (e.g., brand style guide), but that's a redesign |
| `analyzeArchitectureDiagram`                  | Vertex (multimodal) | ~613          | Context caching           | No          | **No** — 613 << 32,768 threshold       | Each diagram image is unique; image tokens are dynamic, not static                                                      |
| `analyzeArticleMetadata` (if → Anthropic)     | Anthropic           | ~413          | `cache_control` ephemeral | No          | **No** — 413 < 1,024 minimum           | Would need prompt expansion to ~1,024+ static tokens to be eligible                                                     |
| `analyzeArchitectureDiagram` (if → Anthropic) | Anthropic           | ~613          | `cache_control` ephemeral | No          | **Borderline** — 613 < 1,024 but close | Adding a preamble (provider context, brand voice ~200 tokens) would push over threshold                                 |
| `callAnthropic` system prompt                 | Anthropic           | ~22           | `cache_control` ephemeral | No          | **No** — 22 << 1,024                   | System prompt is a one-liner; expand to full instruction block to make cacheable                                        |
| `callOpenAi` (any call site)                  | OpenAI              | —             | Auto (no config)          | Auto        | Structurally blocked                   | Static tokens are not the first 1,024 of the full prompt; auto-cache never triggers                                     |

---

### 12.6 Highest-leverage caching opportunity

**Today, with the active (Vertex) provider: zero caching wins available.** All static blocks are
below the 32,768-token Vertex minimum.

**The one exception — `generateArticleDraft` with multiple PDFs attached:**

When `supportingDocuments` includes 2–5 large PDFs (`base64Data`, `mimeType: application/pdf`), the
total input can reach 80–120KB ≈ 20,000–30,000 tokens. At 5 × 18KB text docs (~22,500 tokens)

- static instructions (~275 tokens), the combined `parts` array approaches — but does not reliably
  exceed — the 32,768 Vertex threshold. This is an edge-case trigger, not a steady-state
  opportunity.

**The path to caching that actually works:**

Caching becomes viable under one of two conditions:

1. **Provider switches to Anthropic** + static instruction blocks are restructured to ≥1,024 tokens.
   - `analyzeArticleMetadata`: add ~611 tokens of brand/style/editorial context to the static
     header. This is legitimate added value (brand voice, content standards, output examples) not
     just padding — the model quality would also improve.
   - `analyzeArchitectureDiagram`: add ~411 tokens of provider-specific context (e.g., AWS vs. Azure
     architectural best practices) to the static header.
   - Savings: on `analyzeArticleMetadata` at 900/mo, the 1.5K-token static header would cache on
     first hit and reduce each subsequent input cost by ~0.15K tokens × $3.00/1M × 90% discount =
     ~$0.0004/call saved = **~$0.36/mo**. Modest today; better at 10×.

2. **A large, stable reference document is added to `generateArticleDraft`** that exceeds 32,768
   tokens (e.g., a full technical style guide or knowledge base). At that scale, Vertex context
   caching would reduce repeated document costs by the standard cache-hit discount.

**Caching recommendation (R5 from §9.4, now with precise context):**

R5 (add `cache_control: ephemeral` to `callAnthropic`) remains the correct long-term action, but it
requires expanding the static system prompt to ≥1,024 tokens first, otherwise the cache write will
be rejected by the API. Update R5 scope: "expand static instruction blocks to ≥1,024 tokens (add
brand voice + editorial guidelines), then wire `cache_control`."

---

### 12.7 Cache hit rate logging

**No token or cache hit logging exists anywhere** in the router or call sites (R9 is the future
fix).

If caching is enabled for the Anthropic path, cache hit/miss data appears in the API response under
`usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`. The router's
`callAnthropic` function discards the full response object after extracting `content[].text` — it
does not capture or log `response.data.usage`. Adding a single debug log on this object (behind a
flag) would be the minimum viable cache observability:

```js
// router:221 — after const blocks = response.data?.content || [];
if (process.env.CONTENTFORGE_LOG_TOKEN_USAGE === 'true') {
  const usage = response.data?.usage || {};
  logger.info('[ai-model] anthropic token usage', { ...usage, model: selectedModel, purpose });
}
```

The same pattern applies to `callVertex` (Vertex returns `usageMetadata` on the response) and
`callOpenAi` (OpenAI returns `usage` on `response.data`). This is the R9 implementation target.
