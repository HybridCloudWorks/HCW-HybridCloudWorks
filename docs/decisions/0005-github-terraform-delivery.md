# ADR 0005: Use AVM-based Terraform and GitHub OIDC delivery

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The platform must be deployed as code and use GitHub as the change-control surface. The prototype uses
direct resources and workflow patterns that require stronger identity and approval boundaries.

## Purpose and decision drivers

Make infrastructure changes consistent, reviewable, credentialless, reproducible, and reversible.

## Decision

Compose pinned Azure Verified Modules from a thin Terraform production root. Use separate GitHub OIDC
identities for read-only plan and protected apply. Apply only the reviewed artifact with serialized
production concurrency.

## Consequences and accepted risks

- Bootstrap OIDC trust, state, and RBAC are separately governed.
- Direct `azurerm` resources require a documented AVM gap.
- Actions and modules are pinned to immutable versions.
- The apply identity cannot change its own trust or grant itself RBAC.

## Alternatives considered

- Static service-principal secrets: rejected due to credential rotation and exposure risk.
- Portal deployment: rejected because it removes reviewable desired state.
- HCP Terraform as the primary change surface: not selected because GitHub is the requested control
  plane; remote state mechanics remain an implementation detail.

## Validation and revisit triggers

Validate reviewed-plan hash, protected approval, lock behavior, rollback, and absence of static Azure
credentials. Revisit if organization-level delivery tooling becomes mandatory.

## Amendment 2026-10-07 — the Terraform run identity's grants (estate review SEC-1)

The consequence above, "the apply identity cannot change its own trust or
grant itself RBAC", was not true when the estate review of 2026-10-06 read
it. HCP Terraform runs as `id-plat-terraform-prod-cus-01`, created and
granted by `scripts/bootstrap-terraform-oidc.ps1` outside Terraform state,
and it held Contributor and an unconditioned Role Based Access Control
Administrator on every target subscription. Unconditioned, that role writes
any role assignment, Owner included. This amendment records what now makes
the sentence true, and what still does not.

- **The condition, applied 2026-10-06.** `scripts/Set-TerraformRbacCondition.ps1`
  (#893, #906, #907) put an ABAC condition on each RBAC Administrator
  assignment: it refuses writes of Owner, User Access Administrator, RBAC
  Administrator and every Key Vault administrator and officer role, except
  Key Vault Secrets Officer to a user (the `admin_object_ids` seeding
  window), and refuses deletes of Owner, User Access Administrator and RBAC
  Administrator. From 2026-10-07 it also refuses **Contributor**, so the
  scoping below cannot be undone by one role assignment;
  `scripts/terraform-identity-grants.test.mjs` fails the build if `infra/`
  ever assigns a refused role.
- **The condition stays in the operator script, not in Terraform.** Decided
  2026-10-07. The identity's grants are not in Terraform state by design
  (section 0 of the deployment runbook: Terraform must not manage the
  credential it authenticates with), and a condition held in `infra/` would
  be maintained by the very identity it constrains: a run could rewrite or
  drop its own condition, which is the escalation the condition exists to
  stop. Revisit if a separate, more privileged bootstrap workspace ever
  holds the run identity's grants; that workspace could hold the condition.
- **Contributor scoped to the resource groups `infra/` declares.** From
  2026-10-07 the bootstrap grants Contributor on each of the nine groups
  `infra/` creates (seven in the application subscription,
  `rg-mgmt-plat-prod-cus` in Management, `rg-conn-hub-prod-cus` in
  Connectivity; listed in `scripts/terraform-identity-grants.json`, which
  the test above keeps equal to the HCL), plus a custom role,
  `HCW Terraform Subscription Scope`, for the only things `infra/` does at
  subscription scope: create and update those groups, keep the two
  subscription budgets, and register `var.azure_resource_providers`. The
  custom role has no `resourceGroups/delete`, because at subscription scope
  that verb deletes any group and everything in it; removing a group from
  `infra/` is an owner step. Terraform creates its groups, so
  Contributor on a group alone could not create one; the custom role is
  what closes that.
- **Two steps.** The subscription-wide Contributor stays until a later,
  separate change removes it, after a plan and an apply have run on the
  narrow grants. Doing both at once would make the first run to find a
  missing action the run that had already lost the wide grant. Once it is
  gone, a new resource group needs one extra pass (deployment runbook,
  section 0).
- **Still open.** RBAC Administrator is still granted per subscription, so
  the identity can still assign narrower built-in roles at subscription
  scope to principals it controls; scoping it to the same groups is the
  next narrowing. The acceptance evidence, a test apply that tries to
  assign Key Vault Secrets Officer to a service principal and is refused,
  has not been recorded.
- **Team tokens: an owner decision, not implemented.** The review also asked
  for a read-scoped team token for the workspace-busy check and a separate
  token for the plan check. Team API tokens need HCP Terraform's Teams
  feature, and the `hcw` organisation does not have that entitlement; the
  owner decides whether to buy it, and until then both checks use the
  existing token. Separate Azure credentials per run phase are a different
  mechanism that does not need Teams: HashiCorp documents
  `TFC_AZURE_PLAN_CLIENT_ID` and `TFC_AZURE_APPLY_CLIENT_ID`, which fall
  back to `TFC_AZURE_RUN_CLIENT_ID`. A plan identity with read-only rights
  would still need the list actions a refresh calls (app settings, storage
  keys), so it is a designed custom role, not Reader; recorded here as the
  option, not built.

## Related decisions and references

- [ADR 0009](../decisions/0009-production-state.md)
- [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/)
- [Azure infrastructure delivery with GitHub Actions](https://learn.microsoft.com/devops/deliver/iac-github-actions)
