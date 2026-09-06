# AI-STACK-REPORT

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 23, 2026
**Status:** Active Review (Cost-first baseline)

## Scope

Review current ContentForge AI stack, enforce Gemini 2.5 minimum, and recommend model allocation
with cost as primary priority and performance as secondary.

## Current Stack (Code Reality)

- AI router: `functions/lib/ai-model-router.js`
- Active provider switch: `CONTENTFORGE_AI_PROVIDER`
- Current AI entry points:
  - Draft generation: `functions/cms-functions.js` (`generateArticleDraft`)
  - Article metadata analysis: `functions/index.js`
  - Architecture multimodal analysis: `functions/index.js`
- Supported providers: Vertex, OpenAI, Anthropic

## Gemini 2.5 Cost Signals (Vertex pricing page)

From Google Vertex AI Generative AI pricing (retrieved February 23, 2026):

- **Gemini 2.5 Flash Lite** (lowest cost in Gemini 2.5 family)
  - Input (text/image/video): **$0.10 / 1M tokens**
  - Output text: **$0.40 / 1M tokens**
- **Gemini 2.5 Flash**
  - Input (text/image/video): **$0.30 / 1M tokens**
  - Output text: **$2.50 / 1M tokens**
- **Gemini 2.5 Pro**
  - Input: **$1.25 / 1M tokens**
  - Output text: **$10.00 / 1M tokens**

Pricing may change; verify on the Vertex pricing page before final capacity commitments.

## Decision (Cost First, Performance Next)

### Default Allocation

- **Draft generation** → `gemini-2.5-flash-lite`
  - Rationale: highest volume path and most token-sensitive workload.
- **Article analysis** → `gemini-2.5-flash`
  - Rationale: better quality/consistency than Lite with moderate cost.
- **Multimodal architecture analysis** → `gemini-2.5-flash`
  - Rationale: image+text analysis reliability at lower cost than Pro.

### Escalation Rule

Use `gemini-2.5-pro` only for targeted high-stakes workflows where quality gain is validated and
budget-approved.

## Implementation Completed

- Updated Vertex default models in `functions/lib/ai-model-router.js`:
  - `draft` default → `gemini-2.5-flash-lite`
  - `analysis` default → `gemini-2.5-flash`
  - `multimodal` default → `gemini-2.5-flash`
  - generic fallback default → `gemini-2.5-flash-lite`

This enforces Gemini 2.5 minimum for default Gemini usage.

## Recommended Runtime Configuration

```env
CONTENTFORGE_AI_PROVIDER=vertex
CONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-flash-lite
CONTENTFORGE_VERTEX_ANALYSIS_MODEL=gemini-2.5-flash
CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-flash
```

## Follow-up Monitoring

- Track per-endpoint token and cost spend by purpose (`draft`, `analysis`, `multimodal`).
- Sample quality checks weekly for draft and architecture paths.
- Promote to Pro only where measured quality delta justifies cost.

## Deployment Readiness Additions

- New admin endpoint: `aiStackReadiness` (Cloud Functions)
- New script: `functions/check-ai-stack-readiness.js`
- Deployment runbook: `documentation/pipeline-ai-deployment.md`
