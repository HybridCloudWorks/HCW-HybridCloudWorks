# ADR 0021: Container Apps self-hosted CI runner failover

**Status:** Superseded — deferred 2026-08-18 (see *Deferral* below). The resources remain in `infra/ci-runner.tf`, gated off by `ci_runner_enabled = false`.
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

---

## Deferral (2026-08-18)

Ratified and deferred the same day, on facts the original decision did not
check. Not a reversal of the reasoning — a correction of its inputs.

**The cost driver did not exist.** "Cost ceiling: a scale-to-zero Consumption
job costs nothing idle" answers a question nobody asked. This repository is
**public**, so GitHub-hosted runners are unlimited and free. There was no
runner cost to avoid, and therefore no saving to weigh the trust surface
against.

**The failover path cannot run.** All three prerequisites are absent
(CHECKLIST §7): `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, and the GitHub App id
and private key that mint the short-lived registration token. The image cannot
be pushed and a runner cannot register. The failover has never been exercised
because it has never been executable.

**What it protects against is smaller than it looks.** A GitHub-hosted runner
outage stops the gates — CI, repository policy, IaC validation, wiki sync —
for the duration of the incident. The delivery workflows are `if: ${{ false }}`
and gated on a protected Environment, so nothing production-facing is blocked.
The exposure is merge friction, measured in hours, not a delivery freeze.

Against that: a Container Apps environment and job, a Docker Hub account and
push token, a GitHub App holding `Administration: Read & write` tenant-wide,
an image build pipeline — and this ADR's own accepted risk, *"workflow code
executed on the runner runs inside the subscription's network fabric"*.

### Decision

`ci_runner_enabled` defaults to `false`. `infra/ci-runner.tf` is retained in
full and gated, so reviving this is one variable, not an archaeology exercise.
`CI_RUNNER` remains unset across all seven workflows, which was already the
steady state.

The original **revisit trigger stands unchanged**: if the runner is needed
routinely, this ADR's risk analysis is void and must be redone — with the full
hardening pass (egress restriction, image signing) and the three secrets
provisioned, in that order.
