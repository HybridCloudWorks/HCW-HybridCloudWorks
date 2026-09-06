# DATABASE-ROLLBACK-CHECKLIST

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** June 7, 2026
**Status:** Active (P3 safeguard)

## Objective

Provide a fast rollback sequence if model-simplification migration introduces regressions.

## Preconditions

- Migration batch scope and timestamps recorded.
- Snapshot/export available for affected document set.
- On-call owner assigned for rollback window.

## Phase A Schema Lock + CI Contract Checklist

Use this checklist before any read-convergence or backfill work starts.

- [ ] Confirm the canonical `content` public-read field set is still: `slug`, `type`,
      `cloudProvider`, `publishTarget`, `Live`, `contentStatus`, `Title`, `Summary`,
      `postContent|content`, `Published At`.
- [ ] Verify the legacy `blogs` paths are classified and tracked as fallback-only, dual-write, or
      dead/unreachable.
- [ ] Add or keep CI checks that fail when required public-read fields are missing from `content`
      fixtures or sample docs.
- [ ] Add or keep CI checks that fail when `blogs` write paths are introduced outside the approved
      publish/delete flow.
- [ ] Verify fallback precedence is stable: `content` wins for matching slugs/doc IDs, and `blogs`
      is read only when `content` is absent.
- [ ] Confirm admin live-page tooling defaults to `content` and only includes legacy `blogs` pages
      behind the explicit toggle.
- [ ] Keep the legacy-read telemetry counter enabled so Phase D can gate on actual usage.
- [ ] Confirm rollback still restores `blogs` fallback without schema changes.
- [ ] Record the signed-off schema contract in the roadmap notes before Phase B starts.

## Checklist

- [ ] Pause additional migration batches.
- [ ] Re-enable compatibility reads (`content` first with `blogs` fallback where applicable).
- [ ] Restore critical fields from snapshot/export for affected docs.
- [ ] Re-run `node functions/audit-content-model-readiness.js`.
- [ ] Smoke-test provider list/detail/admin publish paths.
- [ ] Confirm publish pipeline status transitions remain valid.
- [ ] Log incident summary and root cause in roadmap notes.

## Verification

Rollback is considered complete when:

- read-path regressions are resolved,
- publish flow behaves as pre-migration baseline,
- audit deltas are within expected threshold.

## Post-Rollback Actions

- document failed migration pattern,
- tighten backfill patching rules,
- rerun dry-run on narrowed scope before next apply.
