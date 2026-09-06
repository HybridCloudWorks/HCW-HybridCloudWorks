# ADR 0008: Use selective Private Link

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

Functions Flex requires a subnet delegated to `Microsoft.App/environments`. Verification found that
the original service-endpoint plan was not a sound pairing for this subnet. Fully privatizing all
Function host storage subresources would consume disproportionate budget.

## Purpose and decision drivers

Privately connect the most sensitive data and secret services while retaining a viable monthly cost.

## Decision

Use a dedicated Flex integration subnet and a separate private-endpoint subnet. Create private
endpoints and Private DNS for Cosmos DB, content Blob Storage, content Queue Storage, and Key Vault.
Keep isolated Function host storage and feature-gated Azure OpenAI public initially with identity-first
access.

## Consequences and accepted risks

- Four endpoints add hourly, data-processing, and DNS costs.
- Host storage public endpoints remain an accepted exposure with no editorial content or secrets.
- Private DNS and deployment ordering become operational responsibilities.
- Public access is disabled only after private-path validation.

## Alternatives considered

- Service endpoints on the Flex subnet: rejected during pairing verification.
- Private endpoints for every host storage service: deferred due to endpoint count and cost.
- No VNet: rejected because it weakens the sensitive data plane.

## Validation and revisit triggers

Validate private DNS, data-plane access, public-access rejection, deployment recovery, and actual
endpoint cost. Revisit after threat-model changes, budget increases, or host-storage exposure findings.

## Related decisions and references

- [ADR 0004](../decisions/0004-functions-boundaries.md)
- [ADR 0015](../decisions/0015-cost-governance.md)
- [Flex VNet integration](https://learn.microsoft.com/azure/azure-functions/flex-consumption-how-to#configure-virtual-network-integration)
