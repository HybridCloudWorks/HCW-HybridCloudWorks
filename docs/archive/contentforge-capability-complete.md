# ContentForge Capability Audit & Completion Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Version:** 1.0
**Maintainer:** KCS + FED + GHE + GDEF + AAI (Composite Review)
**Status:** Active
**Last Updated:** February 23, 2026 (P0+P1 complete + P2 Coder Corner rollout)

---

## Executive Summary (What Exists, What Is Missing, What Must Be Done)

### What Exists Today

- A working admin ingestion/review/publish pipeline centered on the `content` collection, with
  optional promotion to `blogs` during publish.
- Provider routing and listing coverage for News/Blog across all six providers (`aws`, `azure`,
  `gcp`, `finops`, `github`, `terraform`).
- Template-driven detail pages for Blog, Frameworks, and Architecture.
- Scheduled publish automation and slug-path metadata stamping (`curatedSubpagePath`) in Cloud
  Functions.

### What Is Missing or Incomplete

- **End-to-end parity remains partially incomplete only for P2/P3 scope** (notably Coder Corner);
  P0/P1 governance and visibility controls are now implemented.
- News cards now use provider-aware internal detail routing where resolvable, with explicit external
  fallback for legacy records.
- Framework/Architecture template submissions now ingest to `content` (`contentStatus: ingested`) to
  align with admin review controls.
- Coder Corner for GitHub/Terraform is now ContentForge-backed with submission, review queue,
  publish, and provider detail routing.

### Tasks Added to todo.md (See “P0/P1/P2/P3” in this document)

- P0: canonical data model + route resolution + publish contract alignment.
- P1: enforce listing visibility/status consistency and endpoint consistency.
- P2: ContentForge-backed Coder Corner and strategic platform hardening.
- P3: platform evolution tasks (scraping robustness, model abstraction, and long-horizon
  simplification).

---

## Scope and Required Outcome

This audit verifies whether HCW currently has complete, end-to-end creation flows for:

1. News Article + Blog Post creation for each provider (`aws`, `azure`, `gcp`, `finops`, `github`,
   `terraform`)
2. Frameworks Spotlight + Architecture Deep Dive for `aws`, `azure`, `gcp`, `finops`
3. Coder Corner for `github`, `terraform`
4. ContentForge-backed, template-driven subpage behavior

The intended outcome is a single source of truth for implementation reality, gaps, and remediation
plan.

---

## Persona-Led Assessment

### KCS (Documentation Integrity)

- Multiple docs describe an older `blogs`-centric single-collection model and `/admin/review` route
  assumptions.
- Current implementation uses `content` + `blogs` dual-collection patterns and queue-driven review
  at `/admin/queue/:blogId`.
- Canonical guidance is required to prevent engineering drift.

### FED (Frontend & Routing Integrity)

- Provider route dispatch exists in `src/App.jsx`, including blog detail path
  `/:provider/blog/:slug`.
- Framework and architecture detail dispatchers exist and support provider routing.
- News cards in `src/components/news/ArticlesBentoGrid.jsx` now resolve internal provider news
  detail routes first, then external URLs as fallback.

### GHE (Workflow & Delivery Integrity)

- Admin actions are wired through authenticated Cloud Function calls in `src/lib/api.js`.
- Queue/review/publish status handling now routes through `transitionContentStatus` for lifecycle
  state changes, with `updateContentItem` reserved for non-state metadata.
- Governance now uses a canonical `content` state-transition contract with auditable transitions.

### GDEF (Firebase/Data Integrity)

- Canonical workflow source is `content`, with `blogs` retained as a legacy render fallback:
  - `content`: admin-origin workflow lifecycle
  - `blogs`: promoted/curated entries and template-submission entries
- `useBlogData` and `useNewsData` now resolve from `content` first and only fall back to `blogs`
  when canonical records are absent.
- Framework/Architecture submission pages (`/templates/...`) now submit to `content` and enter the
  admin review queue model.

### AAI (ContentForge Backbone & Template Trigger Behavior)

- ContentForge functions support draft generation, image generation, and publish promotion.
- Publish path sets metadata for subpage path (`curatedSubpagePath`) and trigger reset logic.
- “Instant subpage creation” is metadata-triggered and route-resolved, not file generation; this
  must be documented as behavior-by-design.

---

## Current Implementation Evidence Map

### Core Routing and Templates

- Provider routing and dispatch: `src/App.jsx`
- Blog detail template: `src/components/templates/BlogDetailTemplate.jsx`
- Framework detail template: `src/components/templates/FrameworkDetailTemplate.jsx`
- Architecture detail template: `src/components/templates/ArchitectureDetailTemplate.jsx`

### Admin Workflow

- URL submit + draft/image flow: `src/pages/admin/SubmitUrlsPage.jsx`
- Queue: `src/pages/admin/QueuePage.jsx`
- Review: `src/pages/admin/ReviewPage.jsx`
- Publish panel: `src/pages/admin/PublishedPage.jsx`

### Backend ContentForge + Publish

- CRUD + publish endpoints: `functions/cms-functions.js`
- Scheduled publish + trigger stamping: `functions/index.js`

### Data Hooks (Canonical + Legacy Fallback)

- Blog data (`content` canonical, `blogs` fallback): `src/hooks/useBlogData.js`
- News data (`content` canonical, `blogs` fallback): `src/hooks/useNewsData.js`

### Coder Corner Surfaces

- GitHub code page: `src/pages/github/CodePage.jsx`
- Terraform code page: `src/pages/terraform/CodePage.jsx`

---

## Capability Matrix (Exhaustive)

Legend:

- **Fully Working**: complete create → review/governance → publish → discover → detail journey
  exists and is consistent
- **Partial**: major components exist but one or more mandatory journey links are
  inconsistent/missing
- **Missing**: no meaningful ContentForge-backed flow exists

### A) News Article Creation (All Providers)

| Provider  | Status  | Findings                                                                                                                             |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AWS       | Partial | News feed/listing works via merged collections and status filtering; cards now prefer internal detail routes with external fallback. |
| Azure     | Partial | Same pattern as AWS.                                                                                                                 |
| GCP       | Partial | Same pattern as AWS.                                                                                                                 |
| FinOps    | Partial | Same pattern as AWS.                                                                                                                 |
| GitHub    | Partial | Same pattern as AWS.                                                                                                                 |
| Terraform | Partial | Same pattern as AWS.                                                                                                                 |

### B) Blog Post Creation (All Providers)

| Provider  | Status  | Findings                                                                                                     |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| AWS       | Partial | Listing + detail route exist; dual-collection merge and slug/id resolution contract can cause mismatch risk. |
| Azure     | Partial | Same pattern as AWS.                                                                                         |
| GCP       | Partial | Same pattern as AWS.                                                                                         |
| FinOps    | Partial | Same pattern as AWS.                                                                                         |
| GitHub    | Partial | Same pattern as AWS.                                                                                         |
| Terraform | Partial | Same pattern as AWS.                                                                                         |

### C) Frameworks Spotlight (AWS/Azure/GCP/FinOps)

| Provider | Status  | Findings                                                                                                                            |
| -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| AWS      | Partial | Route + listing/detail exist; template submissions now enter `content` review lifecycle; broader single-source model still pending. |
| Azure    | Partial | Same pattern as AWS.                                                                                                                |
| GCP      | Partial | Same pattern as AWS.                                                                                                                |
| FinOps   | Partial | Dispatcher/page exists; lifecycle alignment improved, but broader model unification remains pending.                                |

### D) Architecture Deep Dive (AWS/Azure/GCP/FinOps)

| Provider | Status  | Findings                                                                                                                           |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AWS      | Partial | Route + listing/detail exist; submissions now flow into admin `content` review lifecycle; full model simplification still pending. |
| Azure    | Partial | Same pattern as AWS.                                                                                                               |
| GCP      | Partial | Same pattern as AWS.                                                                                                               |
| FinOps   | Partial | Route + detail path exist; lifecycle alignment improved, pending full contract unification.                                        |

### E) Coder Corner (GitHub/Terraform)

| Provider  | Status  | Findings                                                                                    |
| --------- | ------- | ------------------------------------------------------------------------------------------- |
| GitHub    | Partial | ContentForge-backed listing/detail flow now active; strategic automation guardrails remain. |
| Terraform | Partial | ContentForge-backed listing/detail flow now active; strategic automation guardrails remain. |

---

## End-to-End Verdict

**No, HCW does not currently have complete end-to-end creation parity across all requested
domains.**
Current state is best described as:

- **Operational core exists** (admin ingestion/review/publish + provider routing + templates)
- **Provider discoverability exists** (News/Blog/Framework/Architecture pages)
- **Governance and lifecycle consistency are incomplete** (dual model and status contract drift)
- **Strategic P2/P3 hardening remains** (automation guardrails + long-horizon simplification)

---

## Critical Gaps and Root Causes

### Gap 1 — Data Model Split Without Single Governance Contract

- Admin editorial workflow is `content`-first.
- Framework/Architecture template submissions are `blogs`-direct.
- Result: duplicated assumptions, inconsistent review controls, and mixed status behavior.

### Gap 2 — News Internal Detail Journey Not Standardized

- News card UX currently favors external links from article cards.
- Result: “template-driven instant subpage” cannot be claimed uniformly for News.

### Gap 3 — Blog Detail Resolution Contract Risk

- Blog detail route uses `/:provider/blog/:slug`, but data can be resolved via different field/id
  assumptions.
- Result: edge-case mismatches and brittle linking if slug/id conventions drift.

### Gap 4 — Coder Corner Requires Operational Hardening

- GitHub/Terraform code pages now run on ContentForge lifecycle, but need regression automation and
  additional quality guardrails.

### Gap 5 — Documentation Drift

- Legacy docs state single-collection assumptions and outdated route semantics.

---

## Canonical Remediation Plan

### P0 (Must Fix for End-to-End Claim)

1. **Adopt one authoritative content lifecycle contract** (preferred: `content` lifecycle, explicit
   promotion rules to `blogs` where needed).
2. **Harden blog detail resolution** so `:slug` always resolves deterministically (slug lookup +
   safe fallback strategy).
3. **Formalize News detail policy**:
   - Option A: keep external-only by design and update all docs/UX copy
   - Option B (recommended): implement internal news detail routes consistently and make cards route
     internally.
4. **Unify framework/architecture submission governance**:
   - route submissions into reviewable lifecycle state (or replicate equivalent moderation
     guarantees if staying direct-to-`blogs`).

Acceptance criteria (P0):

- Every provider blog/news entry opens valid target behavior consistently.
- Framework/Architecture create → review → publish path is documented and technically unified.
- Docs can truthfully claim end-to-end for covered domains.

### P1 (Stability and Policy Consistency)

1. Ensure all listing pages enforce published/live visibility rules consistently.
2. Normalize status transition patterns (state machine endpoint vs direct update endpoint usage
   policy).
3. Add audit checks for collection parity and publish metadata completeness.

Acceptance criteria (P1):

- No unpublished content leaks in public pages.
- Status transitions are auditable and policy-consistent.

### P2 (Strategic Completion)

1. ✅ Implement **ContentForge-backed Coder Corner** for GitHub/Terraform:

- ingest/create form
- review queue integration
- publish state + detail route/template

2. Add matrix-based automated validation docs/tests to prevent future drift.
3. Optional: consolidate to one render-source collection once migration is complete.

Acceptance criteria (P2):

- GitHub/Terraform Coder Corner has same lifecycle quality as Blog/Architecture/Framework targets.
- Automated checks enforce matrix parity.

---

## Contradictions Resolved by This Guide

This guide supersedes older assumptions that are no longer fully true:

- Single-collection `blogs`-only lifecycle
- `/admin/review` as primary route model
- Uniform “instant subpage creation” across all content categories

Current truth is now defined by this capability matrix and remediation plan.

---

## Documentation Consolidation Notes

Superseded/overlapping content has been consolidated into this canonical guide from:

- `documentation/content-types-pipeline.md`
- `documentation/process-contentforge-workflow.md`

These should remain archived for historical traceability only.

---

## Implementation Checklist (No-Question Closure)

- [x] Capability matrix includes every requested provider/content-type pair.
- [x] Current-vs-missing statement provided at top of document.
- [x] Persona-led review included (KCS, FED, GHE, GDEF, AAI).
- [x] Explicit P0/P1/P2/P3 tasks and acceptance criteria defined.
- [x] Contradictions and root causes documented.
- [x] Canonical documentation source established.
