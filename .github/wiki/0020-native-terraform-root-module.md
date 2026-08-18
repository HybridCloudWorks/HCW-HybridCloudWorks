# ADR 0020: Flat native-provider Terraform root module (no AVM)

**Status:** Accepted
**Decision date:** 2026-08-18
**Owners:** Workload owner and architecture owner

## Context

ADR 0005 and the root README guardrail required composing pinned Azure Verified Modules from a thin
production root. The implemented `infra/` is a flat root module of raw `azurerm` resources — not one
`module` block — and it is live, with state in HCP Terraform Cloud and `prevent_destroy` guards on
every stateful resource. Migrating to AVM now would change every resource address, requiring `moved`
blocks or state surgery per resource, reviewed against plans proving zero destroy/create pairs.
TODO T-502 held this open as "reconcile or supersede."

## Purpose and decision drivers

- State safety on a live environment outweighs module aesthetics.
- This is a single-workload repository with no second consumer: AVM's reuse and comformance value
  accrues mostly to fleets.
- Several resources here carry decision-dense inline documentation (the Cosmos serverless triple-lock,
  the Key Vault seeding window, the OIDC subject composition) that wrapping in a module would bury.

## Decision

Ratify the flat native-provider root module as the module strategy. Supersedes the AVM clause of
ADR 0005; **the OIDC/GitHub delivery clauses of ADR 0005 stand unchanged.** The root README guardrail
changes from "use Azure Verified Modules" to: *pin provider and action versions, keep resource
addresses stable (`moved` blocks for any rename), and document any structural refactor's plan
evidence.* Closes TODO T-502.

## Consequences and accepted risks

- The repository owns its own resource-level correctness; there is no AVM baseline doing conformance
  work for us — the Trivy/tflint CI gates and the WAF assessment carry that weight instead.
- New resources keep being written natively; a future AVM adoption grows the migration surface with
  every addition. Accepted: see revisit triggers.
- The `iac-repo-standardizer` agent and IaC Repository Standard describe the *pattern* (flat root,
  pinned providers, lifecycle guards) rather than AVM composition, so future repositories inherit the
  ratified shape.

## Alternatives considered

- **Migrate to AVM with `moved` blocks, module by module** — rejected now: weeks of state-sensitive
  work with zero behavioural change, on a budget-capped single workload.
- **Hybrid (AVM for new resources only)** — rejected: two idioms in one root is worse than either.

## Validation and revisit triggers

- Validated by `terraform validate`/tflint/Trivy green on the as-built module and the live
  environment it manages.
- **Revisit** when: a second infrastructure repository or environment appears (fleet conformance
  starts paying); ALZ absorption mandates module-level policy the flat root can't express; or a major
  `azurerm` version migration would be absorbed more cheaply through AVM anyway.

## Related decisions and references

- Supersedes the module-strategy clause of [ADR 0005](0005-github-terraform-delivery)
- [ADR 0018](0018-as-built-plan-v02) · [IaC Repository Standard](IaC-Repository-Standard)
- Closes TODO T-502
