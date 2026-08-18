# ADR 0021: Container Apps self-hosted CI runner failover

**Status:** Accepted
**Decision date:** 2026-08-18
**Owners:** Workload owner and architecture owner

## Context

`infra/ci-runner.tf` provisions a Container Apps environment and a scale-to-zero job running a
self-hosted GitHub Actions runner from a repository-built image (`infra/runner-image/`), selectable
per-workflow via the `CI_RUNNER` repository variable (REVIEW §4.4). Plan v0.1 never mentioned it —
Container Apps appears there only as a rejected alternative for the Functions plan — so the 2026-08-18
validation flagged it as an unratified trust surface: a runner that executes repository workflow code
inside the production subscription.

## Purpose and decision drivers

- A GitHub-hosted-runner outage otherwise halts every gate in the repository — CI, repository policy,
  IaC validation, wiki sync — with no code-change-free recovery path.
- Cost ceiling: a scale-to-zero Consumption job costs nothing idle.

## Decision

Ratify the Container Apps runner as the CI failover path, with its boundaries stated:

- **Failover, not default.** `CI_RUNNER` stays unset (GitHub-hosted) in normal operation; flipping it
  is an operator action under REVIEW §4.4's runbook.
- The runner job's identity holds no data-plane roles beyond what executing CI requires; it must never
  be granted the deploy identity's permissions.
- The runner image is built from the pinned Dockerfile in-repo by `build-runner-image.yml`; no
  third-party runner images.

## Consequences and accepted risks

- Workflow code executed on the runner runs inside the subscription's network fabric — a stronger
  position than a GitHub-hosted runner. Mitigated by scale-to-zero (off unless invoked), the
  failover-only posture, and the repository's no-secrets CI doctrine (validation workflows hold no
  cloud credentials to steal).
- A new budget line item when active; negligible at failover duty cycle.

## Alternatives considered

- **No failover** — rejected: it converts a GitHub incident into a full delivery freeze.
- **A VM-based runner** — rejected: standing cost and patch surface for an occasionally-used path.
- **Larger GitHub plan with priority runners** — does not exist as a failover product.

## Validation and revisit triggers

- Validated by the documented `CI_RUNNER` failover switch present in every workflow.
- **Revisit** if the runner starts being used routinely (it then needs the full hardening pass:
  egress restriction, image signing), or if CI ever requires cloud credentials — at that point this
  ADR's risk analysis is void and must be redone.

## Related decisions and references

- [ADR 0018](0018-as-built-plan-v02) · REVIEW §4.4 (failover runbook)
- `infra/ci-runner.tf`, `infra/runner-image/`, `.github/workflows/build-runner-image.yml`
