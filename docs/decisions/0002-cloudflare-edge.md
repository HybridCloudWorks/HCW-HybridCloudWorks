# ADR 0002: Retain Cloudflare as the initial edge

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The workload has a USD 150 monthly Azure ceiling. Azure Front Door Standard has a meaningful fixed
base fee, and Premium is outside the ceiling. Cloudflare already provides DNS and edge delivery.

## Purpose and decision drivers

Preserve CDN, DNS, TLS, DDoS, and plan-available WAF capability without consuming an excessive share
of the Azure budget.

## Decision

Retain Cloudflare for authoritative DNS and edge controls. Host the frontend on Azure Static Web Apps
and APIs on Functions Flex. Azure remains responsible for API authentication and authorization.

## Consequences and accepted risks

- Cloudflare cannot provide Azure Private Link origin integration.
- Azure origins remain addressable unless separately restricted.
- API security cannot depend solely on edge filtering.
- Front Door Premium remains the future private-origin option.

## Alternatives considered

- Front Door Premium: rejected because its fixed price exceeds the workload ceiling.
- Front Door Standard: rejected initially because it adds fixed cost without private origins.
- Azure DNS only: rejected because it removes existing CDN and edge controls.

## Validation and revisit triggers

Measure cache hit rate, origin bypass attempts, edge errors, and total edge cost. Revisit after an
origin-bypass incident, compliance change, or budget increase.

## Related decisions and references

- [ADR 0007](../decisions/0007-static-first-frontend.md)
- [ADR 0008](../decisions/0008-selective-private-link.md)
- [Azure Front Door pricing](https://azure.microsoft.com/pricing/details/frontdoor/)
- [Cloudflare plans](https://www.cloudflare.com/plans/)
