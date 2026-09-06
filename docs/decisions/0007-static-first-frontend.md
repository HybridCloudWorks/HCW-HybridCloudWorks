# ADR 0007: Preserve static-first rendering on Azure Static Web Apps

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The source generates Vike HTML for public routes and loads admin/dynamic behavior separately. The
public site should not become dependent on live Cosmos queries, Functions cold starts, or AI health.

## Purpose and decision drivers

Maintain fast public delivery, search metadata, accessibility, cacheability, and backend failure
isolation.

## Decision

Deploy prerendered public HTML and versioned public data to Azure Static Web Apps Standard behind
Cloudflare. Publish operations trigger a controlled GitHub rebuild. The admin SPA remains dynamic.

## Consequences and accepted risks

- Published-content freshness depends on successful rebuild/deployment.
- Build triggers need deduplication, audit, and failure recovery.
- Dynamic tools use APIs and must degrade independently.
- Static Web Apps remains a public origin.

## Alternatives considered

- Server-side rendering on App Service: rejected due to cost and new runtime dependency.
- Direct browser-to-Cosmos reads: rejected due to security, cost, and coupling.
- Blob static website plus Front Door: rejected because Front Door fixed cost is not justified.

## Validation and revisit triggers

Validate route/metadata parity, CSP, accessibility, Core Web Vitals, cache hit rate, and public
availability during API/Cosmos outages. Revisit if personalization requires runtime rendering.

## Related decisions and references

- [ADR 0002](../decisions/0002-cloudflare-edge.md)
- [ADR 0006](../decisions/0006-admin-identity.md)
