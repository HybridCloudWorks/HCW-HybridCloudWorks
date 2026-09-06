# ADR 0003: Start with Cosmos DB Serverless

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The current workload is document-oriented and expected to be low-volume and bursty. The prototype
copied only a subset of Firestore collections and selected partition keys without a query inventory.

## Purpose and decision drivers

Provide a managed document store that matches source semantics and idle/spiky economics while
supporting managed identity and change feed processing.

## Decision

Use single-region Cosmos DB for NoSQL Serverless with Session consistency, zone support where
available, continuous backup, Entra data-plane RBAC, and query-contract-led containers.

## Consequences and accepted risks

- Containers and partition keys require a Firestore query inventory before implementation.
- Serverless cannot add regions; multiregion requires migration.
- RU/query, hot partition, throttling, latency, and storage must be monitored.
- Public content is materialized instead of read directly from Cosmos for each visitor.

## Alternatives considered

- Azure SQL: stronger relational model but a larger migration and steady-cost mismatch.
- Table Storage: cheaper but insufficient query/change-feed ergonomics for the full workflow.
- Provisioned/autoscale Cosmos: supports multiregion but introduces a larger baseline cost.

## Validation and revisit triggers

Validate partition design with real queries and migration samples. Revisit if RU usage becomes
sustained, regional recovery requirements tighten, or hot partitions remain after modeling.

## Related decisions and references

- [ADR 0011](../decisions/0011-single-region-recovery.md)
- [Cosmos DB Well-Architected guide](https://learn.microsoft.com/azure/well-architected/service-guides/cosmos-db)
