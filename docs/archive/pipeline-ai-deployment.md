# PIPELINE-AI-DEPLOYMENT

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 23, 2026
**Status:** Active (Pre-deploy + post-deploy runbook)

## Executive Summary

This runbook covers end-to-end AI deployment for ContentForge: configuration, key requirements,
readiness validation, and post-deployment verification.

## What was requested earlier and now implemented

- Provider-agnostic model routing (Vertex/OpenAI/Anthropic) — implemented.
- Gemini minimum baseline 2.5+ with cost-first defaults — implemented.
- Scrape fallback chain (direct → reader → optional headless) — implemented foundation.
- Deployment/readiness surface for AI stack — implemented via endpoint + local script.

## Remaining non-code dependency from prior requests

- Headless fallback service itself (Cloud Run/Playwright endpoint) still needs deployment if you
  want `headless_fallback` mode active in production.

## Required Keys / APIs

### Required for default path

- Google Cloud project with Vertex AI enabled
- Firebase Functions deployment permissions
- `REPLICATE_API_KEY` (for publish-time hero covers, preview image slots, and curated article
  images)
- A deployed/runtime environment that can resolve Vertex ADC credentials

### Required only if provider switched

- `OPENAI_API_KEY` when `CONTENTFORGE_AI_PROVIDER=openai`
- `ANTHROPIC_API_KEY` when `CONTENTFORGE_AI_PROVIDER=anthropic`

### Required for Firecrawl-based ingestion

- `FIRECRAWL_API_KEY`

### Required only if headless fallback enabled

- `CONTENTFORGE_HEADLESS_FALLBACK_ENABLED=true`
- `CONTENTFORGE_HEADLESS_FALLBACK_URL=https://<your-cloud-run-service>/scrape`

## Recommended Runtime Configuration

```env
CONTENTFORGE_AI_PROVIDER=vertex
CONTENTFORGE_VERTEX_LOCATION=us-central1
CONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-flash-lite
CONTENTFORGE_VERTEX_ANALYSIS_MODEL=gemini-2.5-flash
CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-flash
CONTENTFORGE_IMAGE_MODEL=google/imagen-4-fast
CONTENTFORGE_IMAGE_MODEL_HERO=google/imagen-4-fast
CONTENTFORGE_METADATA_ONLY=true
CONTENTFORGE_LOG_TOKEN_USAGE=true
CONTENTFORGE_ALT_TEXT_ENABLED=false
CONTENTFORGE_IMAGE_FALLBACK_PROVIDER=none
CONTENTFORGE_SCRAPE_FALLBACK_ENABLED=true
CONTENTFORGE_HEADLESS_FALLBACK_ENABLED=false
```

### Local runtime file

Create `functions/.env` for non-secret runtime configuration. Firebase Functions v2 will read this
for local emulator/deploy workflows, and standalone local validation can use:

```bash
cd functions
node --env-file=.env check-ai-stack-readiness.js
```

Do **not** store secrets in `functions/.env`. Keep API keys in Firebase Functions secrets.

## Pre-Deploy Validation

### Local env snapshot

```bash
cd functions
npm run readiness:local
```

### Optional remote readiness (after deploy)

```bash
cd functions
set CONTENTFORGE_ADMIN_BEARER=<firebase-id-token>
npm run readiness:remote
```

The remote helper derives the endpoint from the Firebase project and region. To target a different
deployment, override the defaults:

```bash
cd functions
node check-ai-stack-readiness.js --remote --project <project-id> --region <region> --token "<firebase-id-token>"
```

### Browser-backed remote readiness (auto token)

If you already have a valid admin browser session, the repo can restore that session and mint a
fresh Firebase ID token automatically:

```bash
npm run readiness:remote:auto
```

If this is the first run on the smoke profile, capture storage state once first:

```bash
npm run smoke:auth:capture
npm run readiness:remote:auto
```

From `functions/`, the same helper is available as:

```bash
npm run readiness:remote:auto
```

Exit code `2` means configuration is incomplete.

## Deploy

```bash
cd functions
npm run deploy
```

## Post-Deploy Verification

1. Trigger and validate draft generation endpoint.
2. Trigger and validate preview image generation endpoint.
3. Check `aiStackReadiness` endpoint as admin.
4. Run scrape benchmark script against representative URLs:

```bash
cd functions
node test-scrape-fallback.js --endpoint "https://<region>-<project>.cloudfunctions.net/generateArticleDraft" --url "https://example.com/article-1" --url "https://example.com/article-2"
```

5. Confirm scrape mode distribution (`direct_html`, `reader_fallback`, `headless_fallback`).

## Secret setup

```bash
cd functions
firebase functions:secrets:set REPLICATE_API_KEY --project hybridcloudworks-61e8d
firebase functions:secrets:set FIRECRAWL_API_KEY --project hybridcloudworks-61e8d
```

Optional only if used:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project hybridcloudworks-61e8d
firebase functions:secrets:set ANTHROPIC_API_KEY --project hybridcloudworks-61e8d
```

## Readiness expectations

- `vertex.ready` should be `true` in the readiness output.
- `REPLICATE_API_KEY` is required for the default article pipeline because image generation remains
  Replicate-backed even when text generation stays on Vertex.
- `controls.metadataOnly=true` is the recommended restart posture to reduce ingest-time spend.

## Persona-Informed Art of Possible

- **AAI**: Add quality-gated automatic model escalation (`flash-lite` → `flash` → `pro`) based on
  confidence score and budget envelopes.
- **CKAD**: Deploy headless fallback as autoscaled Cloud Run service with strict timeout/cost caps.
- **GHE**: Add CI gate to fail PR when readiness script returns missing required keys for target
  env.
- **KCS**: Emit weekly AI ops report from readiness + scrape benchmark outputs.
