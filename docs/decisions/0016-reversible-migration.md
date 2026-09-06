# ADR 0016: Use reversible migration and explicit decommission gates

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The complete production workload remains in Firebase/GCP, and the Azure prototype covers only part of
its code, data, integrations, and operational contracts. Premature cutover or cleanup could lose data,
external synchronization, or rollback capability.

## Purpose and decision drivers

Preserve production continuity and evidence while each domain moves to Azure.

## Decision

Migrate by contract domain with full copy, reconciliation, incremental delta, parallel verification,
rollback-ready DNS cutover, and a stabilization window. Firebase decommissioning and old-repository
archival require separate explicit approvals.

## Consequences and accepted risks

- Temporary dual-platform operation adds complexity and cost.
- Dual writes are avoided unless a conflict policy is tested.
- Read-only checks do not validate external mutation propagation.
- Source secrets and identities remain until their Azure replacements and rollback window are verified.

## Alternatives considered

- Big-bang rewrite/cutover: rejected due to scope and rollback risk.
- Archive the source repo immediately: rejected because it remains the implementation truth during
  migration.
- Decommission after a successful smoke test: rejected because full operating cycles are required.

## Validation and revisit triggers

Use route, data, media, auth, editorial, async, integration, labs, recovery, cost, and DNS gates from
the migration inventory and runbook. Supersede this ADR only when Azure is the verified source of truth
and decommissioning has been approved.

## Related decisions and references

- [ADR 0001](../decisions/0001-single-repository.md)
- [ADR 0012](../decisions/0012-asynchronous-workflows.md)
- [Migration inventory](../history/migration-inventory.md)
- [Cutover runbook](../history/cutover-runbook.md)
