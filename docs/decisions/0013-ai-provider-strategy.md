# ADR 0013: Use Azure OpenAI as a feature-gated default

**Status:** Accepted
**Decision date:** 2026-07-22
**Owners:** Workload owner and architecture owner

## Context

The source defaults to Vertex AI but already contains a multi-provider adapter. Model capacity,
versions, pricing, rate limits, and safety behavior can change independently of the site.

## Purpose and decision drivers

Remove the production Vertex dependency while preserving portability, graceful degradation, and a
bounded AI cost envelope.

## Decision

Use consumption-based Azure OpenAI as the Azure-native default behind the existing provider adapter.
Provision it only after region/capacity/model approval. Use managed identity, content filters, bounded
tokens/TPM, dynamic quota off, retries, evaluations, and non-AI fallback.

> **Not implemented as decided — factual note, 2026-09-07.** This records what
> happened; it does not change the decision, which only a superseding ADR can
> do. **The Azure OpenAI account was never the default and no longer exists:**
> `oai-site-prod-cus` and its resource group were retired on 2026-08-19
> ([Naming convention](../standards/naming-convention.md)), `infra/*.tf`
> declares no `azurerm_cognitive_account`, and the subscription holds zero
> model quota. What runs instead is the third-party fallback path this ADR
> listed as optional: `functions/src/lib/ai/router.js` decides provider
> availability at runtime by key presence in Key Vault. The consequences below
> therefore hold in an inverted form — AI is still not a dependency for public
> page delivery, but the identity model is API keys in Key Vault rather than
> managed identity, and AI spend lands on a provider's bill where no Azure
> budget can see it ([Cost analysis](../architecture/cost-analysis.md)).
>
> **This gap is unresolved governance, not a documentation defect.** The
> register's rule is that a changed decision gets a new ADR
> ([decisions index](../decisions/index.md)); this record is left Accepted and
> unedited because writing that ADR is the architecture owner's act, not a
> documentation pass's. Until it exists, read this page as the July 2026
> intent and the note above as what is true.

## Consequences and accepted risks

- AI is not a dependency for public page delivery.
- Model deployment names and versions are explicit configuration.
- Third-party providers can remain optional fallbacks with Key Vault secrets.
- Image/model parity with Vertex is measured, not assumed.

## Alternatives considered

- Retain Vertex as default: rejected because the target removes GCP production dependencies.
- Direct OpenAI only: rejected because Azure identity/governance is preferred.
- Remove AI: rejected because AI workflows are part of the source capability inventory.

## Validation and revisit triggers

Use a golden evaluation dataset, safety tests, 429/timeout tests, cost per generation, and provider
fallback evidence. Revisit on model retirement, capacity failure, unacceptable quality, or budget
pressure.

## Related decisions and references

- [ADR 0010](../decisions/0010-observability.md)
- [ADR 0015](../decisions/0015-cost-governance.md)
- [AI workload design principles](https://learn.microsoft.com/azure/well-architected/ai/design-principles)
