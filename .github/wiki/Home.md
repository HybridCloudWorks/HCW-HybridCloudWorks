# HybridCloudWorks Engineering Wiki

This Wiki is the authoritative home for HybridCloudWorks architecture, architectural decisions,
implementation planning, migration guidance, operations, and historical engineering documentation.
The main repository retains only its current root README and Markdown files required by repository
tooling.

## Current Azure migration baseline

- [Approved target architecture](Architecture)
- [Well-Architected assessment](Well-Architected-Assessment)
- [Architecture Decision Record register](Architecture-Decision-Records)
- [Implementation TODO](Implementation-TODO)
- [Implementation plan](Implementation-Plan)
- [Migration inventory](Migration-Inventory)
- [Migration runbook](Migration-Runbook)
- [Deployment runbook](Deployment-Runbook) — Terraform lifecycle: validate, plan, apply, verify, rollback, day-2, ALZ absorption
- [IaC repository standard](IaC-Repository-Standard) — the baseline every HybridCloudWorks infrastructure repository conforms to
- [Naming convention](Naming-Convention) — CAF names for the ALZ target estate: management groups, subscriptions, the three platform landing zones, and HCWSite
- [Resource validation report](Resource-Validation-Report) — 2026-08-18 pass: external surface, plan-vs-code parity, operator to-dos
- [Cost analysis](Cost-Analysis)

## Operating rules

- Update the root repository README whenever repository structure, authority, or delivery status changes.
- Record every material architectural decision in a new ADR before implementation.
- Treat the implementation TODO as the current execution checklist and the implementation plan as its
  phase rationale.
- Keep secrets, credentials, Terraform state, and saved plans out of both the repository and Wiki.
- Require explicit approval for production applies, DNS cutover, third-party mutation tests, GCP
  decommissioning, and archival of the old repository.

## Historical documentation

The imported Firebase/GCP documentation remains available as historical context. Those pages describe
the source system and may be stale; the current Azure baseline and accepted ADRs take precedence.
