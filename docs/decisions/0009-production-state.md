# ADR 0009: Use one production workload state

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The current workload is operated by a small team and only one persistent production environment is
required. State must still be remote, locked, recoverable, and isolated from bootstrap trust.

## Purpose and decision drivers

Avoid environment and cost sprawl while preserving safe infrastructure concurrency and recovery.

## Decision

Maintain one production workload state. State/OIDC bootstrap has a separate administrative lifecycle
and cannot be destroyed or privilege-expanded by routine workload apply. Pull-request previews and
local/emulator tests provide nonpersistent validation.

## Consequences and accepted risks

- There is no persistent staging environment with production fidelity.
- State backend and OIDC bootstrap require documented recovery and break-glass procedures.
- Production applies are serialized and environment-protected.
- A future staging state is a deliberate new decision.

## Alternatives considered

- Dev/stage/prod states now: rejected due to cost and operational need.
- Local state: rejected due to concurrency, recovery, and secret risk.
- One state including its own mutable trust: rejected because routine apply could endanger recovery.

## Validation and revisit triggers

Test locking, version recovery, access separation, and reviewed-plan application. Revisit when change
volume, contributors, or release risk justifies persistent staging.

## Related decisions and references

- [ADR 0005](../decisions/0005-github-terraform-delivery.md)
- [ADR 0011](../decisions/0011-single-region-recovery.md)
