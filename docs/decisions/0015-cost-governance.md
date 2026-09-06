# ADR 0015: Enforce a USD 150 monthly design ceiling

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The Azure workload has no actual billing baseline. Cost must be governed before deployment instead of
being optimized only after resources exist.

## Purpose and decision drivers

Keep the platform financially sustainable without weakening the agreed security and recovery baseline.

## Decision

Use a USD 150 resource-group budget with 50/75/90/100 percent notifications, required allocation tags,
serverless/consumption SKUs, zero always-ready instances, AI quotas, telemetry caps, storage lifecycle,
and plan review for every fixed-cost feature.

## Consequences and accepted risks

- The current USD 42–146 range is a planning envelope, not a quote.
- Selective Private Link consumes meaningful contingency.
- Budget alerts do not automatically stop production.
- Actual billed/effective cost replaces list estimates after deployment.

## Alternatives considered

- Lowest-cost architecture without private data access: rejected as an unacceptable security trade.
- Automatic budget shutdown: rejected because it could create uncontrolled outages.
- Commitments/reservations now: rejected until stable usage exists.

## Validation and revisit triggers

Refresh the Azure Pricing Calculator before apply and review actual burn at 7, 14, and 30 days.
Revisit any SKU or feature when the 75 percent forecast alert fires or service quality violates targets.

## Related decisions and references

- [ADR 0002](../decisions/0002-cloudflare-edge.md)
- [ADR 0008](../decisions/0008-selective-private-link.md)
- [FinOps assessment](../architecture/cost-analysis.md)
