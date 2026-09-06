# ADR 0011: Use single-region, zone-aware recovery

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The workload must be production-ready but cost-conscious. A multiregion data and compute footprint is
not compatible with the initial budget and Cosmos Serverless cannot add regions.

## Purpose and decision drivers

Provide credible zone and data recovery without funding a mission-critical multiregion topology.

## Decision

Use one primary Azure region, zone-aware Flex/Cosmos settings where available, ZRS Storage, Cosmos
continuous backup, Blob versioning/soft delete, immutable artifacts, and tested restore/rollback.
Initial targets are RTO within four hours and RPO within one hour for mutable editorial state.

## Consequences and accepted risks

- A regional outage can exceed targets and require platform restoration.
- Published static content can remain available at the edge during backend failure.
- Restore drills are mandatory; configured backup alone is not evidence.
- Multiregion requires a new data/compute decision and additional cost.

## Alternatives considered

- Active-active multiregion: rejected due to cost and complexity.
- LRS-only storage: rejected for content/runtime state where zone durability has value.
- No formal targets: rejected because recovery could not be evaluated.

## Validation and revisit triggers

Run quarterly restore and artifact rollback exercises. Revisit after business criticality, traffic,
revenue, or RTO/RPO requirements increase.

## Related decisions and references

- [ADR 0003](../decisions/0003-cosmos-serverless.md)
- [ADR 0014](../decisions/0014-storage-and-media.md)
