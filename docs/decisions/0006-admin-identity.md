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

### Validated 2026-09-12 (#514)

**MFA is enforced by security defaults, not Conditional Access.** Checked against the live tenant:
security defaults are enabled in tenant properties, and Conditional Access is unavailable because the
tenant is not licensed for Entra ID P1. Three files previously stated Conditional Access —
`AdminAuthGuard.jsx`, `entraAuth.js` and this ADR — and all three were corrected.

Two consequences worth writing down rather than rediscovering:

- **Security defaults cannot be scoped or excepted.** There is no way to exempt a break-glass account,
  so a break-glass path has to survive MFA rather than bypass it.
- **Entra disables security defaults automatically the moment any Conditional Access policy is
  created.** If this tenant is ever licensed for P1 and someone writes their first policy, MFA stops
  being enforced everywhere it currently is unless that policy covers it. That is the revisit trigger:
  licensing P1 is not a free upgrade here, it is a change that requires replacing the MFA control
  before it takes effect.

**Continuous Access Evaluation is not available to this API and must not be declared.** CAE requires
that both the client and the resource be CAE-enabled, and CAE-enabled resources are Microsoft
first-party services; a custom Azure Functions API cannot be one. The revocation SLA is therefore the
60-second `admins/{oid}` cache in `lib/auth/roles.js`, which is tighter than CAE for the events this
application actually cares about. See the citation in that file.

## Related decisions and references

- [ADR 0004](../decisions/0004-functions-boundaries.md)
- [ADR 0007](../decisions/0007-static-first-frontend.md)
