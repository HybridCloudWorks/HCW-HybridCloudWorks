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

## Related decisions and references

- [ADR 0009](../decisions/0009-production-state.md)
- [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/)
- [Azure infrastructure delivery with GitHub Actions](https://learn.microsoft.com/devops/deliver/iac-github-actions)
