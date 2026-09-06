# ADR 0006: Use Entra ID for administrators only

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The public site is anonymous, while the administrative portal changes content, integrations, media,
and operational configuration. Firebase Auth must be removed without creating unnecessary public-user
identity scope.

## Purpose and decision drivers

Protect privileged workflows with the tenant's workforce identity while keeping public access simple.

## Decision

Use one Entra SPA registration, one API registration, and an admin app role or group. Public content
remains anonymous. Every admin API route validates issuer, audience, expiry, and authorization claims.

## Consequences and accepted risks

- Admin authorization moves from Firebase claims/allowlists to Entra governance.
- The admin bundle remains public; APIs protect all privileged data and actions.
- Public labs require quota and abuse controls rather than a public-user identity system.
- Bootstrap and break-glass access require explicit procedures.

## Alternatives considered

- Entra External ID for all visitors: rejected because public accounts are not required.
- Retain Firebase Auth: rejected because it preserves a GCP production dependency.
- Cloudflare Access as sole authorization: rejected because Azure APIs must enforce authorization.

## Validation and revisit triggers

Validate admin, non-admin, expired, wrong-audience, and revoked-token paths. Revisit if the site later
requires persistent public-user accounts.

## Related decisions and references

- [ADR 0004](../decisions/0004-functions-boundaries.md)
- [ADR 0007](../decisions/0007-static-first-frontend.md)
