# IaC Repository Standard

The standard every HybridCloudWorks infrastructure repository conforms to.
HCW-HybridCloudWorks is the reference implementation; the
`iac-repo-standardizer` agent (`.claude/agents/` in the main repository)
applies this standard to new or existing repositories. When the standard and
the agent drift, this page wins — update the agent.

## Principles

1. **The repository is the deployment source of truth.** If it isn't in Git,
   it isn't real; if it's in the portal but not in Git, it's drift.
2. **Credential-free by default.** Validation never needs secrets; delivery
   uses OIDC federation or remote execution. Static cloud credentials are
   prohibited everywhere, including CI secrets.
3. **Additive over restructuring.** Against a live environment, structure
   follows state: no address renames without `moved` blocks, no plan with
   destroy/create pairs on stateful resources.
4. **Documentation has exactly three homes.** Narrative → Wiki. Review state
   → the four SOP root documents. Tooling docs → next to the tooling,
   allowlisted by the structure validator.
5. **Landing-zone absorbable.** Workload repos never create management
   groups, subscription-level policy, or deny assignments; they carry the
   tag contract and survive being moved under an ALZ.

## Required surface

### Root
| Item | Requirement |
| --- | --- |
| `README.md` | Status, documentation authority, layout table, delivery guardrails; updated with every structural or status change (CI-enforced) |
| `TODO.md` / `REVIEW.md` / `CHANGELOG.md` | Code Review SOP documents, exact casing, CI-enforced. REVIEW Part 4 holds input references and formats, never values |
| `.gitignore` | `*.tfstate*`, `*.tfplan`, `.terraform/`, real `*.tfvars`, `.env*`, build output |
| `.editorconfig` | LF, UTF-8, consistent indentation |
| Structure validator | Script + CI workflow enforcing the root allowlist and Markdown policy |

### `.github/`
| Item | Requirement |
| --- | --- |
| `CODEOWNERS` | Infra and workflow paths require infra review |
| `CONTRIBUTING.md`, `SECURITY.md` | Contribution rules; private vulnerability reporting |
| PR template | Infrastructure section: plan linked, no unexpected destroys, no unmoved renames, no secrets, tags preserved, CHECKLIST updated |
| Issue templates | Bug report + infrastructure change request (blast radius, cost, rollback) |
| `dependabot.yml` | `github-actions` + every package ecosystem present |
| Workflows | Least-privilege `permissions:`; actions pinned (SHA preferred); credential-free CI + IaC validation on every PR; delivery gated by `workflow_dispatch` + protected Environment; never auto-apply on push |

### Terraform root (`infra/`)
| Item | Requirement |
| --- | --- |
| `README.md` | Posture, layout, local validation commands, guardrails, ALZ notes |
| File split | `backend.tf`, `providers.tf` (pinned versions), `variables.tf` (descriptions, `sensitive`, validations), `outputs.tf`, committed `.terraform.lock.hcl` |
| `.tflint.hcl` | terraform-recommended preset + provider ruleset |
| `terraform.tfvars.example` | Placeholders only |
| Stateful resources | `lifecycle { prevent_destroy = true }` |
| Tags | One `var.tags` on every resource: `workload`, `environment`, `owner`, `costCenter`, `managedBy`, `criticality`, `dataClassification` |
| Naming | CAF-style prefixes for new resources; never rename live resources to chase convention |
| State | Remote backend (HCP Terraform or locked+versioned azurerm backend), never Git |
| Identity | OIDC-federated deployment identity, subject-scoped to repo + ref/environment |
| Secrets | Values never transit Terraform state; seeded out-of-band, referenced in CHECKLIST |

### Wiki
| Page | Holds |
| --- | --- |
| `Deployment-Runbook` | Validate → plan → apply → verify → rollback → day-2 → ALZ absorption |
| `IaC-Repository-Standard` | This page |
| ADR register | One ADR per irreversible or material decision, written before implementation |

### Variable naming

| Rule | Example |
| --- | --- |
| **Max 2 words** (3 only when 2 is genuinely ambiguous) | `CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `APP_HOSTNAME` |
| **Casing follows the language; the word count does not.** UPPER_SNAKE for GitHub, lower_snake for HCL | `CLIENT_ID` (GitHub) ↔ `client_id` (Terraform output) |
| No provider prefixes — the repo targets one platform; say what the value *is* | `client_id`, not `github_deploy_client_id` |
| Third word only to break a real collision | `app_principal_id` vs `deploy_principal_id`; `FUNCTIONS_STORAGE_ACCOUNT` vs the content account |
| An output that feeds a GitHub variable mirrors its name | output `app_hostname` → variable `APP_HOSTNAME` |
| Contractual names are exempt and never renamed | `VITE_*`, `GITHUB_TOKEN`, `process.env` app settings, provider-required attributes |
| Apply at creation; renaming a *set* variable is a coordinated one-PR change across setting + consumers | — |

Applies to GitHub Actions variables and secrets, Terraform variables **and
outputs**, and app settings the repository controls. Outputs count because
they are operator-facing — someone reads them off the state backend's
Outputs tab and pastes the value somewhere.

Sweeps cover **every** file that declares a name, not a curated list:
`output` blocks live in feature files (`ci-runner.tf`, `oidc.tf`), not only
`outputs.tf`. Each name sorts into exactly one bucket — **safe now**
(outputs; unset variables), **coordinated** (variables already set in the
state backend or GitHub — report, never rename silently), or
**contractual** (never touched). The `iac-repo-standardizer` agent enforces
this on every standardization run, and also flags duplicate outputs for
consolidation.

## The bootstrap identity

Every credential-free repository has exactly one credential it cannot create:
the one the Terraform runner authenticates with. A configuration cannot
provision the identity it needs in order to provision anything. Repositories
routinely ship without this written down, because each file is individually
correct and only the join between them is missing — the standard therefore
makes the join a required artefact.

| Rule | Why |
| --- | --- |
| A runnable bootstrap script exists in `scripts/`, idempotent, with a preflight that reports what is missing rather than failing on it | It runs once, years apart, usually by someone who has not read the repo |
| The bootstrap identity is **excluded from Terraform state** and lives in its own resource group | If Terraform manages the credential it authenticates with, a destroy or bad plan locks the workspace out with no way back |
| The provider block's *lack* of credentials carries a comment saying where they come from | Otherwise the next reader "fixes" it by adding a client secret |
| The runbook's first section is bootstrap, and states plainly that nothing below it works until bootstrap is done | Ordering is the whole message |
| Where two OIDC handshakes exist (runner→cloud and CI→cloud), the runbook tables them side by side | They are both called "the OIDC setup" and only one is in the repository; confusing them is the default failure |
| The runner's own credentials are inventoried in CHECKLIST alongside application inputs | An unrecorded input is an input nobody provisions |
| Prefer federating a **user-assigned managed identity** over an app registration | App registrations need Entra directory roles; cloud-resource Owner does not grant them. Managed identities are ordinary resources and federate to arbitrary external issuers |

The preflight is what makes the script worth writing. Assume the operator has
a directory created minutes ago and no resources anywhere: check the CLI, the
sign-in, the tenant match, the subscription's visibility, the role assignments
actually held, and the resource providers registered — and when one fails, say
which command fixes it. In particular, detect the case where the operator
administers the directory but holds no resource-plane RBAC at all; that is the
normal state of a fresh tenant and it produces error messages that suggest the
wrong fix.

## ALZ-readiness checklist

- [ ] No management groups, subscription-level policy assignments, or deny
      assignments created in-repo
- [ ] Tag contract applied to every resource
- [ ] Diagnostics routed through a workspace that can be re-pointed
- [ ] Region explicit in a variable
- [ ] Runbook documents the absorption sequence (audit-mode policy inventory
      → remediate/exempt via PR + ADR → move subscription → verify RBAC,
      budget, OIDC, zero-drift plan)

## Standardization run — definition of done

1. Branch with additive changes; `fmt`, `validate`, tflint, and the
   structure validator all green.
2. SOP documents updated: CHANGELOG entry, TODO items for deferred work,
   REVIEW items for human decisions.
3. Draft PR listing what was added, what was deliberately left alone and
   why, and the remaining gaps ranked by deploy-readiness impact.
4. Wiki pages created or updated to match.

---

*Adopted 2026-08-17. Reference implementation: HCW-HybridCloudWorks.*
