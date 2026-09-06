# ADR 0001: Consolidate HCW into one repository

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The complete production application is in `Personal-Site_HCW`, while this repository contains an
incomplete Azure attempt and an older frontend copy. Two active repositories would create contract
drift across frontend, functions, data migrations, infrastructure, and workflows.

## Purpose and decision drivers

Create one review, release, security, and provenance boundary for the complete workload.

## Decision

This repository becomes the source of truth for application code, Azure Functions, migration tooling,
Terraform, architecture, and GitHub delivery. The old repository remains available during migration
and rollback, then is archived only after explicit approval.

## Consequences and accepted risks

- Source history or a documented provenance boundary must be preserved.
- Duplicate frontend and infrastructure paths must be reconciled.
- A larger repository requires clear ownership and targeted workflows.
- Archival is a separate destructive gate.

## Alternatives considered

- Two permanent application/platform repositories: rejected because shared contracts would drift.
- Keep the old repository authoritative: rejected because it prevents the Azure landing repository
  from becoming the full delivery boundary.

## Validation and revisit triggers

Validate with one build, test, security, deployment, and documentation path. Revisit only if distinct
teams and release cadences later justify independently versioned services.

## Related decisions and references

- [ADR 0005](../decisions/0005-github-terraform-delivery.md)
- [ADR 0016](../decisions/0016-reversible-migration.md)
