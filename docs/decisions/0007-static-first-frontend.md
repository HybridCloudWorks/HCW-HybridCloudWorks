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

> **Amended 2026-09-07 — two details in that sentence, not the decision.** The
> static-first decision holds exactly as written; two facts named alongside it
> have changed and would mislead a reader taking them as current.
>
> - **"Standard" is now Free.** The Static Web App moved to the Free plan on
>   2026-09-05 (owner decision, #341; `sku_tier = "Free"` in
>   `infra/frontend.tf`). Nothing this ADR relies on was Standard-only —
>   managed SSL on custom domains, global distribution and SPA routing are all
>   in Free. Microsoft documents the move in either direction, so this is a
>   two-way door rather than a new decision.
> - **"Behind Cloudflare" is not how the site is served.** Only
>   `api-azure.hybridcloudworks.com` is Cloudflare-proxied; the apex and `www`
>   resolve to Azure and are not proxied, because a Static Web App root domain
>   validates against a token Azure reissues. Cloudflare is still authoritative
>   DNS for the zone ([ADR 0002](../decisions/0002-cloudflare-edge.md)), which
>   is what makes the sentence half-true rather than wrong. See
>   [Edge and DNS verification](../runbooks/edge-dns-verification.md).

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
