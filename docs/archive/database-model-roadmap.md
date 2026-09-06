# DATABASE-MODEL-ROADMAP

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** June 7, 2026
**Status:** Finalized (P3 roadmap complete; execution tracked via runbook)

## Objective

Converge on a single render-source content model while preserving publish reliability and rollback
safety.

## Current State

- Canonical editorial workflow uses `content`.
- Public hooks and public pages are now content-first by default.
- Only a small set of intentional legacy paths still read `blogs`:
  - admin live-page fallback toggle,
  - admin recent-content fallback,
  - backend publish/delete/rollback maintenance helpers.

## Target State

- `content` is the single source for authoring, review, publish, and public read paths.
- `blogs` becomes compatibility-only, then archived/deprecated.
- All provider pages, detail pages, and admin tools read from one normalized model.

## Proposed Phases

### Phase A — Schema Lock and Compatibility Contract

- Freeze required fields for `content` public-read support:
  - `slug`, `type`, `cloudProvider`, `publishTarget`, `Live`, `contentStatus`,
  - `Title`, `Summary`, `postContent|content`, `Published At`.
- Formalize fallback precedence for legacy fields.
- Add contract checks in CI where possible.

### Phase B — Read Path Convergence

- Update all frontend public hooks/pages to resolve from `content` first.
- Keep `blogs` only where the legacy toggle or rollback path explicitly requires it.
- Add telemetry counters for fallback usage by route/provider.

### Phase C — Backfill + Incremental Migration

- Backfill missing normalized fields in `content` from legacy documents.
- Migrate remaining read paths that still depend on `blogs`.
- Ensure all write operations target `content` only.

### Phase D — Deprecation Gate

- Confirm fallback usage is near-zero for a defined observation window.
- Disable fallback in staged environments first.
- Archive or freeze legacy write paths.

## Rollback Strategy

- Preserve compatibility reads until Phase D sign-off.
- Keep migration idempotent and batched.
- Snapshot key collections before each migration phase.
- Rollback switch:
  - Re-enable `blogs` fallback in readers.
  - Restore previous publish mapper behavior.

## Validation Gates

- Route-level parity checks for provider/content matrix.
- Status lifecycle regression checks.
- Publish metadata validation checks remain green.
- Manual smoke test set:
  - list pages,
  - detail pages,
  - admin review/editor/publish flow.

## Deliverables

- Migration runbook: `documentation/database-migration-runbook.md`.
- Backfill scripts (idempotent):
  - `functions/audit-content-model-readiness.js`
  - `functions/backfill-content-normalized-fields.js`
- Rollback checklist: `documentation/database-rollback-checklist.md`.

## Validation State

- Roadmap and phase gates: finalized; Phase B is now in progress.
- Migration scripts: implemented and ready for controlled execution.
- Rollback procedure: documented and ready for incident use.
- Production migration execution: tracked operationally via `database-migration-runbook.md`.
