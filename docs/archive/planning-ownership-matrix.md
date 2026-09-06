# PLANNING-OWNERSHIP-MATRIX

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 23, 2026
**Status:** Active (P0–P3 ownership map)

## Scope

This matrix maps the ContentForge roadmap (P0–P3) to owner role, dependencies, and milestone
sequencing.

| Roadmap Item                                       | Owner Role        | Dependencies                          | Target Milestone |
| -------------------------------------------------- | ----------------- | ------------------------------------- | ---------------- |
| P0: Unify lifecycle contract (`content`/`blogs`)   | FED               | Firestore schema alignment            | P0-M1            |
| P0: Harden blog detail resolution                  | FED               | Slug strategy + provider routes       | P0-M1            |
| P0: Finalize News detail behavior                  | FED               | UX policy decision                    | P0-M1            |
| P0: Route template submissions via review controls | FED + GHE         | Admin workflow endpoints              | P0-M2            |
| P1: Enforce public visibility rules                | FED               | Canonical status states               | P1-M1            |
| P1: Consolidate status transition API usage        | FED               | Transition matrix + API contracts     | P1-M1            |
| P1: Add publish metadata validation gate           | FED               | Publish contract fields               | P1-M2            |
| P1: Ship real data phase 1                         | Content Ops + FED | Seed/import scripts                   | P1-M2            |
| P2: ContentForge-backed Coder Corner               | FED               | Type + route parity                   | P2-M1            |
| P2: Editor diff for AI vs human edits              | FED               | Editor baseline content capture       | P2-M1            |
| P2: Queue automation extensions                    | FED + AAI         | RSS feeds + digest scheduler          | P2-M2            |
| P2: Capability regression guardrails               | GHE + FED         | CI workflow + matrix script           | P2-M2            |
| P3: Scraping robustness upgrade path               | CKAD + FED        | Baseline extraction telemetry         | P3-M1            |
| P3: AI model abstraction layer                     | AAI + FED         | Shared AI router + env config         | P3-M1            |
| P3: Data model simplification roadmap              | CGOA + FED        | Lifecycle contract + migration policy | P3-M2            |
| P3: Implementation sequencing and ownership matrix | KCS + FED         | Roadmap inventory                     | P3-M1            |

## Notes

- Owner roles map to AGENTS persona responsibilities.
- Milestones are sequential by default and may run in parallel only when dependencies are met.
- Any scope change must be reflected in this matrix and `todo.md` in the same PR.
