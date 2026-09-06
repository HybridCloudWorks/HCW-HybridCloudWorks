# ADR 0012: Use queues and idempotent workers for side effects

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

Publishing, AI, media, Publer, Plaud, Telegram, Klaviyo, Linkie, GitHub, and other integrations can be
slow, rate-limited, partially successful, and duplicated by trigger retries.

## Purpose and decision drivers

Make external side effects observable, retry-safe, bounded, and recoverable without holding open HTTP
requests.

## Decision

Use Storage Queues, poison queues, operation IDs, conditional state transitions, stable external IDs,
bounded exponential retries, explicit terminal state, and scheduled reconciliation. Workers own
external mutations.

## Consequences and accepted risks

- Storage Queues provide at-least-once delivery; the application owns idempotency.
- Ordering is not assumed unless encoded in the domain contract.
- Operators require queue age/depth and poison alerts.
- A controlled disposable record is required for external mutation verification.

## Alternatives considered

- Synchronous side effects: rejected due to timeout and partial-failure risk.
- Service Bus Standard: deferred because advanced broker features do not justify baseline cost yet.
- Cosmos change feed alone: insufficient for every externally retried operation and poison workflow.

## Validation and revisit triggers

Test duplicate delivery, out-of-order arrival, retry exhaustion, poison handling, reconciliation, and
partial provider failure. Revisit if ordering, sessions, transactions, or broker-level DLQ requires
Service Bus.

## Related decisions and references

- [ADR 0004](../decisions/0004-functions-boundaries.md)
- [ADR 0016](../decisions/0016-reversible-migration.md)
