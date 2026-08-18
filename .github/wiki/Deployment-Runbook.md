# Deployment Runbook — Azure platform (infra/)

**Scope:** provisioning and operating the Azure platform from `infra/` in the
main repository. Migration and DNS cutover are covered by the
[Migration Runbook](Migration-Runbook); this page owns the Terraform
lifecycle: validate → plan → apply → verify → operate → (eventually) ALZ
absorption.

**Authority:** this runbook does not authorize anything. Production applies,
destructive changes, DNS cutover, and decommissioning each require the
explicit approvals listed in the root README and [Migration Runbook](Migration-Runbook)
roles table.

## System of record

| Concern | Where |
| --- | --- |
| Terraform source | `infra/` on `main` in HCW-HybridCloudWorks |
| State and variables | HCP Terraform Cloud — org `HybridCloudWorks`, workspace `hybridcloudworks-azure` |
| Required inputs (names, formats, consumers — never values) | `CHECKLIST.md` and `Variables.md` at the repository root |
| Deployment identity | User-assigned managed identity + GitHub OIDC federated credentials (`infra/oidc.tf`) — no static credentials exist |
| Working rules for the directory | `infra/README.md` |

## 1. Preflight (every change)

1. Branch from `main`; never push to `main` directly.
2. Local validation, no credentials needed:
   ```bash
   cd infra
   terraform fmt -recursive -check
   terraform init -backend=false -input=false
   terraform validate
   tflint --init && tflint
   ```
3. CI must be green: **IaC Validation** (fmt/validate/tflint/Trivy),
   Repository Policy, CI, CodeQL.
4. PR uses the infrastructure section of the template: plan linked, no
   unexpected destroy/create pairs, no address renames without `moved`
   blocks, tags on every new resource, `CHECKLIST.md` updated for any new
   required input.
5. If the change alters an accepted ADR, write the superseding ADR first
   ([register](Architecture-Decision-Records)).

## 2. Plan

Plans run in HCP Terraform Cloud, where the state and the workspace variables
live — not on laptops, not on GitHub-hosted runners holding tokens.

1. Open a run in the `hybridcloudworks-azure` workspace (VCS-triggered or
   CLI-triggered from the merged commit).
2. The infrastructure operator reviews the plan **in TFC**, checking:
   - zero destroy/create pairs on stateful resources (Cosmos, storage
     accounts, Key Vault carry `prevent_destroy` — a plan that wants to
     replace them fails; treat any attempt as a defect, not an obstacle);
   - every change traceable to the merged diff;
   - cost-relevant changes against the **USD 150/month ceiling**
     ([Cost analysis](Cost-Analysis)).
3. Anything surprising: discard the run, fix in a new PR.

## 3. Apply

1. Apply is confirmed in HCP Terraform by a human who is **not** the change
   author where role separation permits.
2. The GitHub delivery workflow (`deploy-infra.yml`) stays hard-disabled
   until production applies are authorized. When that authorization lands,
   enable it as designed: `workflow_dispatch`-only, `production-infra`
   GitHub Environment with required reviewers, TFC still holds the apply
   confirmation. Enabling is a two-step, reviewed change documented in the
   workflow header.
3. Record in the run description: PR number, approver, and (for anything
   touching data-bearing resources) the rollback decision point.

## 4. Post-apply verification

1. `terraform plan` again → **empty plan** (no immediate drift).
2. Smoke: from the repository root, `node scripts/smoke-deployed.mjs`
   (see script header for flags) — anonymous surface filtered, admin guards
   refusing, health endpoint answering. The credential-free half of this
   (DNS, TLS, frontend surface, smoke tier 1) is also runnable on demand as
   the **Validate Deployed Surface** workflow
   (`.github/workflows/validate-deployed.yml`, Actions → Run workflow);
   tiers 2–3 need credentials and stay operator-run.
3. Azure portal / CLI spot checks for the changed resources.
4. Application Insights: no new exception cluster in the 30 minutes after
   apply; budget alert configuration intact after any resource-group-level
   change.
5. Update `CHECKLIST.md` Validation Status (`Unverified` → `Verified`) for
   any input exercised for the first time.

## 5. Rollback

Terraform rollback is **roll-forward to the previous definition**:

1. Revert the merge commit in Git (`git revert`), PR it, merge.
2. Plan and apply the revert through the same gates (§2–§3).
3. `prevent_destroy` resources cannot be rolled back by replacement. If a
   bad change landed *inside* one (e.g. an indexing policy), the revert
   updates it in place. If the resource itself must go, that is a human
   decision recorded in REVIEW.md — remove the guard in a dedicated PR that
   says so in its title.
4. State surgery (`terraform state mv/rm`, imports) is a last resort:
   snapshot the state first (TFC keeps versions), record the commands run
   in the PR that motivated them.

## 6. Day-2 operations

| Concern | Mechanism | Where |
| --- | --- | --- |
| Cost | Budget alerts at resource-group scope; USD 150 ceiling | `azurerm_consumption_budget_resource_group` in `main.tf`, [Cost analysis](Cost-Analysis) |
| Drift | Periodic TFC plan (enable a scheduled speculative plan); investigate non-empty plans — portal edits are defects | TFC workspace settings |
| Computed properties | `heal-computed-properties.yml` re-applies `cp_sortDate` on relevant pushes and every 6 h | `.github/workflows/` |
| Secrets | Values live only in Key Vault, seeded manually during an `admin_ip_rules` window, then window closed. References in `CHECKLIST.md` | `infra/variables.tf` (`admin_ip_rules`), Key Vault |
| Purge protection | `purge_protection_enabled` **must be `true` before production secrets are written** — flip the TFC variable and apply; it is one-way | `infra/variables.tf` |
| CI runner outage | Flip repo variable `CI_RUNNER` to `'["self-hosted","aca"]'` | REVIEW.md §4.4, `infra/ci-runner.tf` |
| Dependency and action updates | Dependabot (npm + github-actions) with CI as the gate | `.github/dependabot.yml` |

## 7. ALZ absorption

The subscription is a standalone platform subscription today and is expected
to move under an Azure Landing Zone management-group hierarchy. Nothing in
`infra/` assumes tenant-root placement, so the move is administrative — but
policy inheritance is not, and it is where the friction will be.

Sequence, when the ALZ exists:

1. **Inventory in audit mode.** Ask the ALZ operators for the policy set of
   the target management group; run it in audit against this subscription.
   Expected friction points: public-network-access defaults on Cosmos and
   Storage (the static-first architecture deliberately serves public media
   through the Function App identity), Key Vault firewall shape, allowed
   regions, mandated diagnostic-settings destinations.
2. **Remediate or exempt, in-repo.** Every remediation is a normal PR
   through this runbook; every exemption is recorded as an ADR.
3. **Move the subscription** into the management group (ALZ operators).
4. **Verify survivors.** Budget, RBAC role assignments, and the OIDC
   deployment identities are subscription-scoped and should survive; run
   §4 verification plus a full plan to confirm zero drift.
5. **Re-point diagnostics** to the central Log Analytics workspace if the
   ALZ mandates one — additive diagnostic settings, not replacement of the
   local workspace.

Tags are already the ALZ contract (`workload`, `environment`, `owner`,
`costCenter`, `managedBy`, `criticality`, `dataClassification`); do not fork
the schema per-resource.

---

*Companion pages: [IaC Repository Standard](IaC-Repository-Standard) ·
[Migration Runbook](Migration-Runbook) · [Architecture](Architecture) ·
[Well-Architected assessment](Well-Architected-Assessment)*
