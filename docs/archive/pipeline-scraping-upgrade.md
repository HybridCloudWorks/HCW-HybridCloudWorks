# PIPELINE-SCRAPING-UPGRADE

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 23, 2026
**Status:** Foundation Complete (headless service deployment optional/pending)

## Goal

Increase extraction success for JavaScript-heavy or protected content sources while preserving
current reliability for standard HTML pages.

## Current State

- Primary extractor: Axios + Cheerio + Turndown in Cloud Functions.
- Strength: Fast and low-cost for static and semi-static pages.
- Gap: Some pages require client-side rendering or anti-bot handling.
- Validated now: direct + reader fallback + telemetry + optional headless route hooks.

## Upgrade Path

### Phase 1 — Safe Fallback Envelope

- Keep current extractor as default path.
- Add extraction telemetry fields:
  - `scrapeMode` (`direct_html`, `reader_fallback`, `headless`)
  - `scrapeFailureReason`
  - `scrapeLatencyMs`
- Add fallback trigger criteria:
  - Direct scrape returns low text density.
  - Essential metadata missing (title/date/content body).

### Phase 2 — Reader Fallback (Low Ops)

- Optional fallback through a reader-style extraction endpoint for difficult pages.
- Enable with env flag and strict timeout budget.
- Use as an intermediate tier before headless.

### Phase 3 — Headless Browser Fallback

- Deploy isolated fallback service (Cloud Run recommended) using Playwright/Puppeteer.
- Route only failed/low-confidence documents to headless path.
- Enforce request budgets and concurrency controls.
- **Implemented foundation:** `CONTENTFORGE_HEADLESS_FALLBACK_ENABLED` +
  `CONTENTFORGE_HEADLESS_FALLBACK_URL` support in:
  - `functions/index.js` (`scrapeArticle`)
  - `functions/cms-functions.js` (`scrapeUrlForDraft`)

### Phase 4 — Quality Gate

- Add regression benchmark dataset (known difficult URLs).
- Measure:
  - extraction success rate,
  - structured metadata completeness,
  - average processing latency,
  - cost per 100 documents.

## Operational Controls

- Feature flags:
  - `CONTENTFORGE_SCRAPE_FALLBACK_ENABLED`
  - `CONTENTFORGE_HEADLESS_FALLBACK_ENABLED`
- Kill switch: disable fallback in runtime config without redeploying UI.
- Alerting: threshold alerts for fallback spikes and error bursts.

## Acceptance Criteria

- Success rate on difficult source set improves over baseline.
- No regression on easy/static source set.
- End-to-end processing latency remains within agreed SLA.
- Cost impact documented and approved.

## Benchmark Script

- `functions/test-scrape-fallback.js`
- Purpose: compare effective scrape modes (`direct_html`, `reader_fallback`, `headless_fallback`)
  and success rate against a target URL set.
