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
| `TODO.md` / `REVIEW.md` / `CHECKLIST.md` / `CHANGELOG.md` | Code Review SOP documents, exact casing, CI-enforced. CHECKLIST holds references and formats, never values |
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
| UPPER_SNAKE_CASE, **max 2 words** (3 only when 2 is genuinely ambiguous) | `CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`, `APP_HOSTNAME` |
| No provider prefixes — the repo targets one platform; say what the value *is* | `CLIENT_ID`, not `AZURE_CLIENT_ID` |
| Third word only to break a real collision | `FUNCTIONS_STORAGE_ACCOUNT` (vs the content storage account) |
| Contractual names are exempt and never renamed | `VITE_*` build variables, `GITHUB_TOKEN` |
| Apply at creation; renaming a *set* variable is a coordinated one-PR change across setting + consumers | — |

Applies to GitHub Actions variables and secrets, Terraform variables, and
app settings the repository controls. The `iac-repo-standardizer` agent
enforces this on every standardization run.

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
