# HCW Azure FinOps Assessment

**Status:** Pre-deployment estimate; no actual Azure billing baseline exists

**Currency:** USD

**Budget ceiling:** USD 150 per calendar month

**Scope:** One production HybridCloudWorks workload in a generic Azure subscription

## Assessment boundary

This is a planning envelope, not a quote or forecast from Azure Cost Management. Tenant, region,
offer, taxes, negotiated discounts, traffic, RU consumption, log ingestion, AI tokens, and storage
volume are unknown. Prices must be refreshed in the Azure Pricing Calculator before Terraform is
approved and compared with actual billed cost after deployment.

The repository's earlier Firebase/GCP estimate is not an actual billing export and is not used as a
validated savings baseline.

## FINOPS_ASSESSMENT

```text
TYPE: FINOPS_ASSESSMENT
GOAL: Keep the production Azure workload below USD 150/month without violating the approved security and recovery baseline.
SCOPE: One production resource group; generic subscription; Cloudflare and Hostinger shown separately from Azure.
CONSTRAINTS: Single primary region; anonymous public site; Entra admin only; static-first delivery; no destructive optimization.
DECISIONS: Consumption/serverless compute; Cosmos Serverless; bounded telemetry; Cloudflare retained; selective Private Link; no Front Door, Firewall, NAT, or APIM.
FINOPS: No actual baseline. Planning metric is monthly ListCost in USD until BilledCost is available. Required allocation tags apply at creation.
IMPLEMENTATION: USD 150 budget, alerts, AI/token limits, log caps, storage lifecycle, zero always-ready instances, RU monitoring, policy checks.
VALIDATION: Refresh calculator before apply; observe daily burn after deployment; reconcile BilledCost and service quality at 7, 14, and 30 days.
RISK_GATES: Adding fixed-cost networking, always-ready compute, provisioned Cosmos throughput, multiregion replication, Defender plans, or dynamic AI quota.
OPEN_ITEMS: Region, usage volume, Cloudflare plan, Hostinger billed cost, Azure OpenAI model and capacity.
NEXT_OWNER: Terraform implementation, then workload owner for post-deployment cost measurement.
```

## Monthly planning envelope

| Cost area | Target envelope | Primary driver | Control |
| --- | ---: | --- | --- |
| Static Web Apps | $9–12 | Standard plan | One production site; preview environments kept ephemeral |
| Functions Flex | $0–20 | Executions and GB-seconds | Zero always-ready; concurrency and timeout limits |
| Cosmos DB | $5–25 | Serverless RUs and storage | Query/partition review, selective indexing, RU alerts |
| Blob/Queue/host storage | $3–12 | Capacity, operations, redundancy | Lifecycle, short recovery retention, no optional idle features |
| Key Vault | $0–2 | Operations | Cache secret clients appropriately; no HSM requirement |
| Monitor/App Insights | $0–15 | Log ingestion and retention | Sampling, 30 days, 0.25 GB/day cap and pre-cap alert |
| Azure OpenAI | $0–40 | Tokens/images | Feature gate, TPM/output limits, dynamic quota disabled |
| Selective Private Link and network | $25–35 | Four endpoints, DNS and low data processing | No fixed-cost gateway products; host storage remains public |
| **Azure expected range** | **$42–146** | — | Maintain contingency below $150 |

Cloudflare and Hostinger are external costs. They are tracked in the total workload view but not in the
Azure resource-group budget.

The upper bounds are not simultaneous entitlements. A high AI month, for example, reduces the safe
headroom for telemetry or Cosmos consumption.

## Edge decision

Azure Front Door currently has a fixed monthly base fee around **$35 for Standard** and **$330 for
Premium**, before transfer and request charges. Premium provides the strongest WAF and Private Link
integration but exceeds the entire workload ceiling. Cloudflare currently offers Free and Pro plans
at a substantially lower fixed cost, so it remains the approved edge.

References:

- [Azure Front Door pricing](https://azure.microsoft.com/pricing/details/frontdoor/)
- [Cloudflare plans](https://www.cloudflare.com/plans/)

## Allocation model

Every taggable Azure resource must include:

| Tag | Example | Purpose |
| --- | --- | --- |
| `workload` | `hybridcloudworks` | Workload allocation |
| `environment` | `prod` | Environment allocation |
| `owner` | `<owner-alias>` | Operational accountability |
| `costCenter` | `<cost-center>` | Financial ownership |
| `managedBy` | `terraform` | Change authority |
| `criticality` | `medium` | Reliability context |
| `dataClassification` | `public-internal` | Security context |

Exceptions require a reason and expiry date. CI reports allocation coverage before apply.

## Budget and anomaly controls

- Resource-group monthly budget: USD 150.
- Actual-cost notifications: 50%, 75%, 90%, and 100%.
- Forecast notification: projected 100% breach.
- Daily burn review for the first 14 days after each major cutover.
- Service-specific alerts for Function execution/GB-seconds, Cosmos RU/429, Storage capacity and
  transactions, Log Analytics ingestion, and Azure OpenAI token usage.
- Budget alerts do not shut down production automatically.

## Cost-relevant Terraform controls

- typed SKU, retention, replication, daily-cap, throughput mode, and feature flags;
- `enable_ai = false` until model/capacity approval;
- `always_ready_instances = 0` by default;
- serverless Cosmos capability with no provisioned throughput blocks;
- Storage lifecycle and recovery retention declared as code;
- exactly the approved Cosmos, Blob, Queue, and Key Vault private endpoints; no Front Door, Firewall,
  NAT Gateway, APIM, additional Private Endpoints, or Defender plan unless explicitly enabled and
  reviewed;
- mandatory tags validated in CI;
- plan summary calls out every SKU or capacity change.

## Measurement plan

After deployment:

1. Record subscription and resource-group `BilledCost` and `EffectiveCost` for days 1–7.
2. Compare daily burn with the USD 150 monthly trajectory.
3. Attribute cost by service and required tags.
4. Correlate Functions, Cosmos, Monitor, Storage, and AI cost with their usage metrics.
5. Review at days 7, 14, and 30.
6. Treat a reduction as realized savings only after billed cost falls without violating latency,
   error, recovery, or security targets.

No commitment purchase is appropriate until at least 30 days of stable production usage exists.

## Free-tier disposition (2026-08-18)

Reviewed the subscription's free-services meters against the as-built
architecture (workload owner + validation session). Ruling principles: this
platform already lives on **always-free consumption mechanics** (Functions
scale-to-zero, Cosmos serverless idle-free, scale-to-zero ACA job, capped
Log Analytics); **12-month free-tier meters are treated as traps**, not
opportunities — they expire from the subscription's creation date and then
bill full price.

### Decisions

| Item | Decision |
| --- | --- |
| Blob Hot LRS 5 GB + operations, egress 15 GB | Automatic billing discounts on the existing accounts; nothing to configure |
| Cosmos free tier (25 GB + RU/s) | **Unusable by design** — applies only to provisioned-throughput accounts; ours is serverless (irreversible, ADR-0003/0018). Correctly shows "Not in use" forever |
| Container Registry (12-month Standard) | **Rejected** — runner image stays on the owner's free Docker Hub account; ACR adds a month-13 cost (~$20/mo Standard) for a failover-only image. If the Docker Hub dependency ever needs removing, land on ACR Basic (~$5/mo), never the free-Standard-then-cliff path |
| Service Bus Standard 750 h | **Rejected** for the pending async fabric — 12-month cliff to ~$10/mo; Storage Queues (ADR-0012's choice) cost pennies, never expire, and support managed identity |
| VMs / SQL / MySQL / PostgreSQL / LB / VPN GW / Public IP meters | **Not applicable** — the architecture deliberately contains none of these; standing one up to harvest an expiring freebie needs an ADR and plants month-13 bill shock |
| Key Vault Premium HSM ops, Media Services | Irrelevant (Standard-SKU vault; Media Services is retired) |

### AI options for future features — the standing reference

When the unimplemented AI RPCs get built, the cost choice per task is:
**paid generative APIs** (Azure OpenAI — no free tier — or the third-party
SaaS keys in Key Vault) versus **always-free F0 SKUs** of individual Azure
AI services. F0 mechanics that make them safe under the USD 150 ceiling:

- F0 is **always-free per service** (one F0 resource per service per
  subscription), separate from the 12-month meters — it does not expire.
- On quota exhaustion F0 **throttles (HTTP 429) instead of billing** —
  overage cannot accrue (confirmed in Microsoft Learn for Language/Speech).
- **Create the resource directly with SKU F0.** Resources provisioned
  through Microsoft Foundry default to S0 and do not inherit free tiers.
- F0 resources support managed identity / Entra auth — the keyless posture
  (T-506) applies to them exactly as to OpenAI.

| Task shape | Free option (F0, approximate monthly allowance) | When the paid API is the only option |
| --- | --- | --- |
| Translation | Translator F0 (~2M characters) | — |
| Sentiment, key phrases, summarization, PII detection | Language F0 (~5K text records) | Long-form abstractive quality → LLM |
| Image tagging, OCR, alt-text for media/covers | Vision F0 (~5K transactions, rate-limited) | Creative captions → LLM |
| Moderating anonymous submissions | Content Safety F0 (text+image, 5 RPS) | — |
| Document/receipt extraction | Document Intelligence F0 (~500 pages; 2 pages/4 MB per request; add-ons billable) | Complex layouts |
| Speech-to-text / text-to-speech | Speech F0 (~5 audio hours / ~0.5M characters) | Real-time avatar/LLM-speech features are S0-only |
| **Content drafting, scoring, image generation** | **No free Azure tier exists** | Azure OpenAI (gpt-4o / dall-e-3, deployed, keyless) or the SaaS keys |

Allowances are the documented F0 shapes at the time of writing — confirm on
the service's pricing page before building against one, and add any new
cognitive account through the normal PR + plan review (it is a new resource:
tags, ADR if architecturally material, F0 SKU stated in the diff).
