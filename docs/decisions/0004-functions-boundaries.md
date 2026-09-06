# ADR 0004: Separate API, worker, and labs Function Apps

**Status:** Superseded by [ADR 0019](../decisions/0019-single-function-app.md) (2026-08-18)
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The source combines public APIs, privileged integrations, schedules, AI/media processing, and
semi-trusted lab job coordination. One Function App would give all code one identity and credential
boundary.

## Purpose and decision drivers

Apply least privilege, independent scaling, smaller blast radius, and clearer ownership.

## Decision

Use three Functions Flex Consumption applications: API, worker, and labs broker. Each gets its own
managed identity, host storage, deployment artifact, telemetry component, and permission set.

## Consequences and accepted risks

- More deployment and monitoring configuration is required.
- Flex starts with zero always-ready instances and has no stable deployment slots.
- Storage Queues and idempotency records coordinate asynchronous work.
- Hostinger remains an external labs dependency.

## Alternatives considered

- One Function App: rejected due to identity and blast-radius coupling.
- Functions Premium: rejected initially because of fixed cost.
- Container Apps: rejected because the workload already maps well to event-driven Functions.

## Validation and revisit triggers

Validate that RBAC and secrets differ per component and that workloads scale independently. Revisit if
operational overhead exceeds the measured isolation benefit.

## Related decisions and references

- [ADR 0012](../decisions/0012-asynchronous-workflows.md)
- [Azure Functions Well-Architected guide](https://learn.microsoft.com/azure/well-architected/service-guides/azure-functions)
