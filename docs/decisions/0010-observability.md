# ADR 0010: Centralize bounded observability

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The workload spans public delivery, APIs, queues, schedules, data, AI, external integrations, and a
remote lab agent. Unbounded telemetry can exceed the budget, while sparse telemetry prevents safe
cutover and incident response.

## Purpose and decision drivers

Provide correlated operational evidence with explicit ingestion and retention controls.

## Decision

Use one Log Analytics workspace and separate workspace-based Application Insights components for API,
worker, and labs. Apply adaptive sampling, sensitive-data filtering, 30-day retention, a 0.25 GB/day
cap, pre-cap alerts, diagnostic settings, and one operations action group.

## Consequences and accepted risks

- Sampling can hide low-frequency detail if configured poorly.
- A hard daily cap can reduce incident telemetry.
- Correlation IDs and safe logging are application requirements.
- Prompt bodies, tokens, credentials, and sensitive content are never logged.

## Alternatives considered

- One Application Insights component: rejected because component ownership becomes ambiguous.
- Separate workspaces: rejected due to cost and query fragmentation.
- No cap: rejected due to budget risk.

## Validation and revisit triggers

Run synthetic public/admin journeys, alert tests, correlation queries, and ingestion-cost reviews.
Revisit sampling/caps after real incident and usage data exists.

## Related decisions and references

- [ADR 0004](../decisions/0004-functions-boundaries.md)
- [ADR 0015](../decisions/0015-cost-governance.md)
