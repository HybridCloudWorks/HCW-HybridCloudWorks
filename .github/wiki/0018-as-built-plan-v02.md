# ADR 0018: Supersede plan v0.1 with the as-built v0.2 plan

**Status:** Accepted
**Decision date:** 2026-08-18
**Owners:** Workload owner and architecture owner

## Context

The 2026-08-18 resource validation pass ([Resource-Validation-Report](Resource-Validation-Report))
found that `.azure/infrastructure-plan.json` v0.1 (approved 2026-07-22) and the live Terraform in
`infra/*.tf` had diverged into two independently-evolved documents: roughly 40% of planned resources
implemented, structural boundaries changed, security controls the plan required left off, and material
resources present that the plan never mentioned. Repository CI enforces that the plan "must remain
approved" — a check that had become an assertion about a document, not the system. The environment is
live and carries migrated production data, so structural reconciliation toward v0.1 would be state
surgery with real cost.

## Purpose and decision drivers

- Restore a single truthful source of record for what the platform is, before ALZ absorption audits it.
- Distinguish *decisions* (which deserve ratification and ADRs) from *debt* (which must stay visibly
  unratified until remediated).
- Cost ceiling (ADR-0015) and live-state safety over plan conformance for its own sake.

## Decision

Supersede plan v0.1 with **v0.2-as-built** (`.azure/infrastructure-plan.json`, version `0.2-as-built`),
which describes the implemented environment. Deviations are dispositioned exactly one of two ways:

**Ratified (decision recorded):**

| Deviation | Recorded in |
| --- | --- |
| One Function App instead of the API/worker/labs split | [ADR 0019](0019-single-function-app) (supersedes ADR 0004) |
| Flat native `azurerm` root module instead of AVM composition | [ADR 0020](0020-native-terraform-root-module) (supersedes ADR 0005's module clause) |
| Container Apps self-hosted CI runner (unplanned) | [ADR 0021](0021-container-apps-ci-runner) |
| LRS instead of ZRS on both storage accounts | This ADR (amends ADR 0014); revisit trigger below |
| No compute zone redundancy | This ADR (amends ADR 0011's compute posture); recovery is redeploy-from-code |
| As-built resource names retained; CAF `-9x7k` scheme abandoned | This ADR; renaming live resources is destroy/create for zero risk reduction |
| 71-container Cosmos design | This ADR; v0.1's container-design gate is satisfied by the migration manifest's per-container query-contract evidence |
| Azure OpenAI provisioned (v0.1/ADR-0013 feature-gated it) | This ADR ratifies provisioning retroactively; keyless hardening is debt (T-506), and AI stays non-critical-path per ADR 0013 |
| Plan/apply separation via HCP Terraform instead of a read-only GitHub plan identity | This ADR; revisit if delivery leaves TFC |

**Remediation debt (NOT ratified — tracked until closed):**

| Gap | Tracker |
| --- | --- |
| Cosmos: no network firewall, key auth enabled, periodic backup | TODO **T-504** (+ REVIEW §0.2 rotation decision) |
| Functions host storage publicly reachable | TODO **T-503** |
| Observability layer: action group, alert rules, diagnostic settings, budget thresholds 50/75/90/100 + forecast alert, Log Analytics daily cap | TODO **T-505** |
| Azure OpenAI keyed access + key exported as a Terraform output | TODO **T-506** |
| Key Vault purge protection defaulting off | Deployment Runbook §6 — flip before first secret |

## Consequences and accepted risks

- The structure validator's "plan must remain approved" check is truthful again.
- Accepted risk: LRS means a zonal storage incident loses in-region redundancy; mitigated while the
  Firebase source retains the authoritative copy (ADR 0016).
- Accepted risk: single shared App Insights and one app identity concentrate blast radius — the
  explicit trade of ADR 0019.
- The debt table is a commitment: items there may not be silently re-classified as accepted posture.

## Alternatives considered

- **Reconcile the implementation toward v0.1** — rejected: three-app split, ZRS migration, and CAF
  renames on a live environment cost real money and state surgery for marginal risk reduction at this
  scale.
- **Leave both documents standing** — rejected: that is the audit finding this ADR exists to close.

## Validation and revisit triggers

- Validated by the 2026-08-18 parity comparison; final confirmation is an empty `terraform plan`
  against the `hcw-azure` workspace (operator, Runbook §4).
- **Revisit LRS→ZRS** when Firebase decommission removes the second copy, or when media becomes
  irreproducible.
- **Revisit zone redundancy** if measured availability misses the static-first expectations of ADR 0007.
- **Revisit the TFC plan/apply model** if delivery moves out of HCP Terraform.
- ALZ absorption re-audits this plan; any policy exemption negotiated then gets its own ADR.

## Related decisions and references

- Supersedes plan v0.1; amends [ADR 0011](0011-single-region-recovery), [ADR 0013](0013-ai-provider-strategy), [ADR 0014](0014-storage-and-media)
- [ADR 0019](0019-single-function-app) · [ADR 0020](0020-native-terraform-root-module) · [ADR 0021](0021-container-apps-ci-runner)
- [Resource-Validation-Report](Resource-Validation-Report) · REVIEW.md §8.2 · [Deployment Runbook](Deployment-Runbook)
