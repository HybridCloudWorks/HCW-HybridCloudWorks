# ADR 0011: Use single-region, zone-aware recovery

**Status:** Accepted — amended 2026-10-06 (objectives and as-built posture, see Amendment)
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

> **Read the Amendment before the Decision.** The targets and the zone
> posture below are what was planned in July 2026. The objectives were reset
> on 2026-08-30 (#231, ADR 0028 §6) and the zone settings were decided
> against on cost; until 2026-10-06 this page, ADR 0028, the architecture
> page and `TODO.md` carried three different versions of the same numbers.
> The estate review of that date (finding PLAT-1) found the contradiction,
> and the Amendment is the one record now.

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

## Amendment 2026-10-06 — the objectives, the as-built posture, and the drill

**Objectives (one pair, everywhere).** RPO **24 hours** and RTO **8 hours**
for mutable editorial state, the owner's decision of 2026-08-30 on #231,
recorded in [ADR 0028 §6](0028-cosmos-out-of-account-export.md). The July
targets above (four hours / one hour) are superseded. The architecture page's
reliability model and `docs/runbooks/cosmos-restore.md` say the same pair.

**As built.** The decision above said "zone-aware Flex/Cosmos settings where
available, ZRS Storage". None of that was built, each for cost, and the record
is here so the page stops describing controls that do not exist:

- Cosmos DB: `zone_redundant = false` (`infra/cosmos.tf`), continuous backup
  with 30-day retention, plus the nightly out-of-account export of ADR 0028.
- Function App: Flex Consumption without zone redundancy (`infra/functionapp.tf`).
- Storage: content storage `RAGRS`, host storage `GRS` (`infra/storage.tf`);
  geo-redundant, not zone-redundant. Blob versioning and soft delete as decided.

**The drill.** "Restore drills are mandatory" stood above while no drill had
been run. On 2026-09-09 the owner closed #231 and #455 with the decision that
the first export run and the reads confirming it were the tests needed, and
that no drill was wanted; `TODO.md` carried that as an accepted risk. On
2026-10-06 the owner approved the estate review's critical list, which runs
the drill once: `docs/runbooks/cosmos-restore.md` has the procedure, measures
RPO and RTO, and its Drills table is where the result lands. After that, the
quarterly cadence ADR 0028 names.

**Regional loss.** Everything above is same-region: continuous backup restores
into the same region, and the runbook's drill restores into a scratch account
in the same region. A regional loss has no rehearsed procedure; the runbook's
"A regional loss" section says what exists (geo-replicated storage holding
the exports, Terraform for the compute) and in what order it would be used,
and estimates the result against the 8-hour RTO honestly: it is not inside it.

## Related decisions and references

- [ADR 0003](../decisions/0003-cosmos-serverless.md)
- [ADR 0014](../decisions/0014-storage-and-media.md)
- [ADR 0028](../decisions/0028-cosmos-out-of-account-export.md) — the export, the objectives, the drill
