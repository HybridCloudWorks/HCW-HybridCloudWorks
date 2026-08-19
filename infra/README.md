# infra/ — Azure platform infrastructure (Terraform)

This directory is the single Terraform root module for the HybridCloudWorks
production workload. It is the deployment source of truth for every Azure
resource the platform runs on, plus the Cloudflare DNS records that point at
them.

Narrative documentation (architecture, ADRs, runbooks, cost analysis) lives in
the [GitHub Wiki](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki).
This README covers only what an engineer needs to work safely in this
directory. Start with the
[Deployment Runbook](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Deployment-Runbook)
before any plan or apply.

## Posture

- **One environment: production.** There is no dev/staging state (ADR-0009).
  `var.environment` exists for naming, not for a second workspace.
- **State lives in HCP Terraform Cloud** — org `HybridCloudWorks`, workspace
  `hcw-azure` (`backend.tf`). State, saved plans, and
  `*.tfvars` with real values never enter Git.
- **Applies are gated.** The GitHub workflow (`.github/workflows/deploy-infra.yml`)
  is hard-disabled; production applies happen through HCP Terraform with
  human plan review, per the guardrails in the root README.
- **The target subscription is a platform subscription** that will later be
  absorbed into an Azure Landing Zone management-group hierarchy. See
  "ALZ absorption" below for what is expected to change at that point.

## Layout

| File | Holds |
| --- | --- |
| `backend.tf` | HCP Terraform Cloud backend declaration |
| `providers.tf` | Required providers and provider configuration (`azurerm ~> 4.0`, `cloudflare ~> 4.0`) |
| `variables.tf` | All inputs; names must match TFC workspace variable keys exactly |
| `main.tf` | Core workload: resource group, Static Web App, Cosmos DB (serverless), storage, Functions (Flex Consumption), Key Vault, observability, budget, DNS |
| `oidc.tf` | GitHub Actions deployment identity — user-assigned managed identity + federated credentials, least-privilege role assignments |
| `openai.tf` / `outputs-openai.tf` | Azure OpenAI account and model deployments |
| `ci-runner.tf` | Container Apps job for self-hosted CI runner failover |
| `outputs.tf` | Root outputs |
| `cosmos-containers.json` | Generated container manifest (one container per Firestore collection) — regenerate with `scripts/generate-cosmos-container-spec.mjs`, do not hand-edit |
| `terraform.tfvars.example` | Placeholder-only example; real values live in TFC workspace variables |
| `.tflint.hcl` | Lint ruleset used by CI |
| `runner-image/` | Dockerfile for the self-hosted runner image |

The module is deliberately flat. Three irreversible decisions are load-bearing
on each other (serverless Cosmos, container-per-collection, per-container
partition keys — see the comment block on `azurerm_cosmosdb_account.hcw` in
`main.tf`), and the environment is live: **do not refactor resources into
child modules or rename resource addresses without `moved` blocks and an
explicit plan review showing zero destroy/create pairs.**

## Working in this directory

Local validation needs no credentials:

```bash
terraform fmt -recursive -check   # formatting
terraform init -backend=false     # providers only, no state access
terraform validate
tflint --init && tflint           # lint (ruleset in .tflint.hcl)
```

CI runs the same checks plus a Trivy IaC misconfiguration scan on every pull
request touching `infra/**` (`.github/workflows/iac-validate.yml`).

Plans and applies run in HCP Terraform Cloud against the workspace — not from
laptops, not from GitHub-hosted runners with static tokens. The workspace
holds all variable values, including the sensitive ones catalogued in
`Variables.md` and `CHECKLIST.md` at the repository root.

## Guardrails

- GitHub deployments authenticate with **OIDC federated credentials** on a
  user-assigned managed identity (`oidc.tf`). No static cloud credentials in
  the repository or its secrets, ever.
- **Stateful resources carry `prevent_destroy`** (Cosmos account, both storage
  accounts, Key Vault). Removing one of those guards is itself a reviewed,
  human-approved change.
- Key Vault `purge_protection_enabled` must be `true` before production
  secrets are written (`variables.tf`).
- Secret **values** are never managed by Terraform and never enter state.
  Seeding is a manual, windowed operation via `var.admin_ip_rules` — see the
  variable's description.
- Every resource takes `var.tags`. The tag set (`workload`, `environment`,
  `owner`, `costCenter`, `managedBy`, `criticality`, `dataClassification`) is
  the allocation contract for cost reporting and the future landing zone —
  extend it, don't fork it.

## ALZ absorption

This subscription is expected to be moved under an Azure Landing Zone
management-group hierarchy later. Decisions here were made to keep that move
non-breaking:

- **Nothing in this module assumes tenant-root placement.** No management
  groups, no subscription-level policy assignments, no deny assignments are
  created here; those arrive with the ALZ and apply *onto* this subscription.
- **Tags and diagnostics are ALZ-compatible.** Azure Policy under the ALZ will
  typically enforce tag presence and diagnostic-settings routing; the tag
  schema above and the Log Analytics workspace already satisfy the common
  baselines. If the ALZ mandates a central Log Analytics workspace, add
  diagnostic settings pointing at it rather than replacing the local one.
- **Expect policy friction on:** public network access defaults (Cosmos and
  Storage currently allow selected public access paths by design of the
  static-first architecture), Key Vault firewall defaults, and allowed
  regions. Reconcile via policy exemptions or resource changes at absorption
  time — tracked in the Deployment Runbook's ALZ section.
- **Do not pre-build hub networking.** The VNet here is a workload spoke-in-
  waiting; peering to an ALZ hub is additive when the hub exists.

When absorption happens, the sequence is: inventory policy conflicts in audit
mode → remediate or exempt → move the subscription → verify budget, RBAC and
OIDC identities survived the move (they are subscription-scoped and should).
