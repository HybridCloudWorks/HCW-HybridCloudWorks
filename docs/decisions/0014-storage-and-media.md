# ADR 0014: Keep source media private in ZRS Blob Storage

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The source uses Firebase Storage for public media, generated assets, uploads, certifications, speaker
images, and intermediate content. The prototype created anonymously readable Azure containers.

## Purpose and decision drivers

Protect source assets, preserve recoverability, and publish only intentional derivatives.

## Decision

Use GPv2 Standard ZRS content storage with anonymous access and shared-key application access disabled.
Use private Blob/Queue endpoints, managed-identity RBAC, versioning, soft delete, short retention, and
measured lifecycle tiering. Function host state uses separate accounts.

## Consequences and accepted risks

- Public URLs must be rewritten to the controlled delivery path.
- ZRS costs more than LRS but survives a zone failure.
- Recovery features and old versions require lifecycle cleanup.
- Content-type and cache metadata must be preserved during migration.

## Alternatives considered

- Public blob containers: rejected because source objects become directly enumerable/addressable.
- LRS: rejected initially because the recovery value justifies modest ZRS cost.
- GRS/GZRS: rejected due to cost and single-region workload posture.

## Validation and revisit triggers

Reconcile object counts, sizes, checksums, metadata, content types, rendering, and restore behavior.
Revisit redundancy after actual storage cost and recovery value are measured.

## Related decisions and references

- [ADR 0008](../decisions/0008-selective-private-link.md)
- [ADR 0011](../decisions/0011-single-region-recovery.md)
- [Blob Storage Well-Architected guide](https://learn.microsoft.com/azure/well-architected/service-guides/azure-blob-storage)
