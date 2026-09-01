# Infrastructure review — `infra/`

Single Terraform root module for the **live production** estate: Azure
(Static Web App, Functions Flex Consumption, Cosmos DB, Storage, Key Vault,
Log Analytics/App Insights, budgets, alerting) plus Cloudflare DNS. State is
in HCP Terraform Cloud — org `hcw`, project `Site`, workspace `hcw-azure`
(`backend.tf`). One environment; there is no staging to absorb a mistake.
Read `infra/README.md` before reviewing anything non-trivial here.

## What to check in the diff

### Destroy/recreate risk — check this first
- Any change to a resource's address (rename, move into/out of `for_each` or
  `count`) **requires a `moved` block**. Without one, Terraform plans a
  destroy+create of a live resource. This is the single most expensive
  mistake available in this repo; treat a rename without `moved` as blocking.
- Changes to immutable arguments (Cosmos account/container partition keys,
  storage account name/settings, Key Vault name) force replacement — call
  it out explicitly and check the plan evidence in the PR.
- Key Vault has purge protection (ADR-0021); Cosmos firewall behavior is
  documented in ADR-0025. Changes touching either need the ADR context.

### Hygiene CI will enforce (`iac-validate.yml`)
- `terraform fmt` clean, `terraform validate` clean, tflint, and Trivy
  (IaC misconfiguration scan). Run fmt/validate locally; note that
  validate/plan need TFC credentials — if unavailable, say so in the report
  rather than guessing.
- No state files, saved plans, real `tfvars`, or credentials in the diff.
  `terraform.tfvars.example` carries shapes only.

### Consistency with the rest of the repo
- Naming follows the Wiki Naming Convention (`rg-<tier>-site-prod-cus`,
  `stsiteprodcus01`, `func-site-prod-cus-01`, `kv-site-prod-cus-01`, …).
  Defaults live in `infra/variables.tf` — new resources should thread
  through variables the same way, not hardcode.
- `infra/cosmos-containers.json` is the container spec source; it must stay
  in sync with `scripts/generate-cosmos-container-spec.mjs --check` and with
  what `functions/` actually reads/writes.
- Custom role definitions in `infra/roles/*.json` are tested by
  `scripts/terraform-role-definitions.test.mjs` — role changes need that
  test green, and least-privilege scrutiny (what did the assignable scope or
  actions list gain?).
- Function app settings in `functionapp.tf` pair with the secrets checks in
  `functions/` and `scripts/check-unresolved-secrets.mjs`; a new Key Vault
  reference needs the secret to exist (owner-gated — flag it as a required
  input, don't assume).
- New alerts/monitors (`observability.tf`, `budget.tf`) should match the
  alerting fabric in ADR-0022, and action-group changes affect real paging.

### Process
- The PR must carry plan output or an HCP Terraform run link, and the
  PR template's infrastructure checklist filled in. Applies happen only via
  HCP Terraform with human approval — any diff wiring an auto-apply path is
  blocking.

## Verification commands

```bash
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate     # needs TFC credentials; report if unavailable
cd scripts && npx vitest run terraform-role-definitions.test.mjs   # when infra/roles/*.json changed
cd scripts && node generate-cosmos-container-spec.mjs --check      # when cosmos-containers.json changed
```
