# HCW Azure FinOps Assessment

**Status:** Corrected 2026-08-25 against the built estate and the first Cost
Management reading (taken 2026-08-24). The pre-deployment envelope this page
used to carry described resources that were never created; see *Corrected
2026-08-25* below.

**Currency:** USD

**Budget ceilings:** two, both **subscription**-scoped — USD 150 on the
application subscription (live) and USD 25 on Platform Management (declared in
`fix/go-live-remediation`, **not applied**).

**Scope:** the HybridCloudWorks production workload across three subscriptions —
application, Platform Management, Platform Connectivity. Cloudflare, Hostinger
and the external AI provider APIs are shown separately because they are not
billed by Azure and no Azure budget can see them.

## Corrected 2026-08-25

The Go-Live readiness review read this page against `infra/*.tf` and found it
budgeting an architecture that was never built. Recorded here rather than
silently rewritten, because a number that was wrong for months is worth knowing
about:

| What this page said | What is actually built |
| --- | --- |
| "Selective Private Link and network — $25–35, four endpoints" | **No private endpoint exists.** `grep private_endpoint infra/*.tf` returns nothing. The network posture that was built is service endpoints on the Functions integration subnet, VNet rules on Cosmos, Key Vault and both storage accounts, and default-`Deny` firewalls. That line is USD 0 |
| "Azure OpenAI — $0–40" | **No Azure OpenAI account exists.** `oai-site-prod-cus` and its resource group were retired on 2026-08-19 ([Naming-Convention](../standards/naming-convention.md)); the subscription holds zero model quota. Model calls go to external provider APIs keyed from Key Vault, so AI spend is on the provider's bill and no Azure budget sees it |
| "Resource-group monthly budget: USD 150" | The budget is **subscription**-scoped and has been since the workload split into six resource groups. A resource-group budget would have watched one of the six and ignored the other five (`infra/main.tf`, the `azurerm_consumption_budget_subscription.hcw` header) |
| "`enable_ai = false` until model/capacity approval" | There is no `enable_ai` variable. Provider availability is decided at runtime by key presence in Key Vault (`functions/src/lib/ai/router.js`), not by a Terraform switch |
| "Service-specific alerts for Function execution, Cosmos RU/429, Storage, Log Analytics ingestion, AI tokens" | **Zero alert rules of any kind existed** in either subscription when the review ran on 2026-08-24. Five are added by `fix/go-live-remediation` and none is applied yet — see [Alerting and support](../runbooks/alerting-and-support.md) |

The tag table's example values were also wrong (`criticality: medium`,
`dataClassification: public-internal`); the real values are below.

ADR 0008 (*Use selective Private Link*) is still **Accepted** and still
unimplemented, and it is not in ADR 0018's deviation table. That is an
architecture question rather than a cost one — the cost consequence is simply
that this line is zero — and it is left for the architecture owner rather than
dispositioned here.

## What the estate actually costs

Cost Management, month-to-date, read 2026-08-24. Application subscription:

| Resource | Month-to-date | Why it is what it is |
| --- | ---: | --- |
| Static Web Apps, Standard | $1.34 | The one fixed monthly line in the workload — it bills whether or not anyone visits. `infra/main.tf` records what Standard buys: managed SSL on a custom domain, the Front Door CDN backbone, SPA routing, PR staging environments, 100 GB bandwidth included |
| Functions host storage (`stsitefuncprodcus01`) | $0.98 | Deployment packages and host state. 7-day blob and container soft delete is added by `fix/go-live-remediation` and will move this line slightly |
| Cosmos DB, serverless | $0.68 | No provisioned throughput to pay for while idle (ADR 0003). RU charges only when a request runs |
| Functions, Flex Consumption | $0.14 | Zero always-ready instances, so nothing is billed while nothing executes |
| Key Vault, Standard | $0.01 | Per-operation, and secrets are cached by the client |
| **Five largest lines** | **$3.15** | The balance to the $3.23 total sits in lines too small to itemise |

**Read that as a partial month, not a monthly figure.** The whole estate was
moved to `centralus` on 2026-08-19 ([Naming-Convention](../standards/naming-convention.md)), so
month-to-date on 2026-08-24 covers roughly five days of the current resources,
not twenty-four. The check that proves it: Static Web Apps Standard has a
published fixed price near USD 9 per app per month, and $1.34 over five days
extrapolates to almost exactly that. A full month at this traffic is therefore
closer to **USD 15–20** on the application subscription than to $3.23 — still an
order of magnitude under the USD 150 ceiling, and still dominated by one fixed
line rather than by usage. That extrapolation is arithmetic, not a measurement;
re-read it after a full calendar month in `centralus`.

**The subscription budget is not measuring the workload.** The same reading put
the application subscription's month-to-date spend at **$37.14** against the USD
150 budget. About **91%** of that is not this workload: deleted lab resources and
the retired `southcentralus` estate still settling. So the budget's
50/75/90/100 ladder is currently tracking a tail that is going away, and the
first month after it clears is the first month the ladder means anything.

**The largest controllable line is telemetry, and it bills somewhere else.** Log
Analytics ingestion is charged in Platform Management, where there was **no
budget at all** until `fix/go-live-remediation` adds one. The 0.25 GB/day cap
bounds it at about 7.5 GB a month, which at the USD 2.30–2.76/GB the
configuration records is roughly **USD 17–21 a month** — five times the entire
application-subscription workload. The workspace was found sitting *at* that cap
(`dataIngestionStatus: OverQuota`), so the top of that range is the realistic
figure, not the bottom.

That is the whole cost shape of this platform: one fixed USD 9 line, one
telemetry line of roughly USD 20, and everything else a rounding error.

## What bills, and what holds it down

| Cost area | Control in code | Where |
| --- | --- | --- |
| Static Web Apps | Standard plan, one production site; preview environments stay ephemeral | `azurerm_static_web_app.hcw` |
| Functions, Flex Consumption | **Always-ready deliberately unset (= 0)** — one always-ready 2048 MB instance is roughly $20/month whether or not anything runs. `maximum_instance_count = 20` bounds a traffic spike on the unauthenticated comparison endpoint | `infra/main.tf`, the Scale block |
| Cosmos DB | Serverless capability, no provisioned throughput block anywhere, and a per-container `indexing_policy` with explicit included/excluded paths — indexing is RU spend on every write | `azurerm_cosmosdb_account.hcw`, `azurerm_cosmosdb_sql_container.hcw` |
| Blob storage | Lifecycle deletes scraped article images after 90 days. Versioning on the content account — declared, not yet applied — is bounded by a 30-day non-current-version expiry in the same change, which is what stops versioning becoming an unbounded bill | `azurerm_storage_management_policy.cleanup` |
| Key Vault | Standard SKU, no HSM; runtime reads come from cached secret clients | `azurerm_key_vault.hcw` |
| Log Analytics / App Insights | **0.25 GB/day cap** plus 30-day retention, both live. Pruning the Cosmos diagnostic to `ControlPlaneRequests` — two data-plane categories were most of the cap — is declared and not yet applied. Ingestion sampling deliberately **not** enabled ([ADR 0022](../decisions/0022-alerting-fabric.md)) | `azurerm_log_analytics_workspace.hcw`, `infra/observability.tf` |
| Hub networking | Everything in `hub.tf` is hourly-free by design. Azure Firewall (~$288–912), Bastion (~$138), VPN Gateway (~$138) and DDoS Protection (~$2,944) are absent and the file says why — any one of them is between one and twenty times this whole budget | `infra/hub.tf` |
| AI generation | Not an Azure cost. Providers are on when their key is present; Listen & Learn audio bills against `GEMINI-API-KEY` at roughly $0.17 an episode and $0.87 a certification, logged per run in the AI Engine usage tab (`TODO.md`) | `functions/src/lib/ai/` |

## What the alert fabric costs

`fix/go-live-remediation` adds the first alert rules this platform has ever had.
None of them is applied yet, so this is what the fabric *will* cost. The units,
from the Azure Monitor pricing page:

- **Metric alert rules** bill per monitored time series per month. Three are
  declared (`function_http_5xx`, `function_response_time`, `cosmos_throttled`);
  none uses dimension splitting, so each is one series.
- **Log search alert rules** bill per rule per month, priced by evaluation
  frequency. Two are declared — `app_exceptions` at 5 minutes, `logs_daily_cap`
  at 1 hour.
- **Email notifications** through the action group include 1,000 a month free.
- **Budgets** are free.
- **Standard availability web tests** bill *per execution*. `api_health` is
  created with `enabled = false`, so it costs nothing on creation. Armed at the
  defaults — 5 locations every 15 minutes — it is 5 × 96 × 30 = **14,400
  executions a month**, which is the only line on this list that is not a
  rounding error against a workload of this size. Arming it is an owner decision
  for reachability reasons as well ([Alerting and support](../runbooks/alerting-and-support.md));
  it should also be a spend decision.

Exact per-unit prices are deliberately not quoted here. The Azure Monitor
pricing page renders them dynamically and they could not be read at the time of
writing; take them from the pricing calculator before arming the web test, the
same rule this page applies to every other figure.

## Budgets and anomaly controls

| Budget | Scope | Amount | What it watches |
| --- | --- | ---: | --- |
| `hcw-monthly-budget` | Subscription `sub-app-site-prod-cus` | USD 150 | The workload — Static Web Apps, Functions, Cosmos, storage, Key Vault |
| `plat-mgmt-monthly-budget` | Subscription `sub-plat-mgmt-prod-cus` | USD 25 | Log Analytics ingestion and retention. **Declared, not applied** |

Both carry the same ladder: actual-cost notifications at 50/75/90/100% and a
forecast notification at 100%, which is the one that leaves time to act. Both
route to the ops action group *and* to `budget_alert_email` directly.

Two things about that are worth keeping in mind:

- The direct `contact_emails` path is why a budget notification proves nothing
  about the action group. Mail arrives on that path with the action group
  completely inert. The alert rules have no such fallback — see
  [Alerting and support](../runbooks/alerting-and-support.md), *Delivery is unproven*.
- `budget_start_date` is a create-time constraint, not a "when we started"
  field. Azure rejects a monthly budget whose start date is outside the current
  month, so the Management budget — a *create* — fails if the apply lands on or
  after 2026-09-01 with the value still at `2026-08-01`. Move it to the first of
  the applying month. This is on the pre-apply checklist in the
  [Deployment Runbook](../runbooks/deployment-runbook.md#3-apply).

Budget alerts never shut anything down automatically, and nothing here is a
spend cap.

## Edge decision

Azure Front Door currently has a fixed monthly base fee around **$35 for
Standard** and **$330 for Premium**, before transfer and request charges.
Premium provides the strongest WAF and Private Link integration but exceeds the
entire workload ceiling. Cloudflare currently offers Free and Pro plans at a
substantially lower fixed cost, so it remains the approved edge (ADR 0002).

The cost of that choice is not zero, and it is not financial: Cloudflare's Bot
Fight Mode is what blocks Azure's availability agents, which is why this
platform has no reachability alert. That trade is recorded in ADR 0022.

References:

- [Azure Front Door pricing](https://azure.microsoft.com/pricing/details/frontdoor/)
- [Cloudflare plans](https://www.cloudflare.com/plans/)

## Allocation model

Every taggable Azure resource takes the same `var.tags` map:

| Tag | Value | Purpose |
| --- | --- | --- |
| `workload` | `hybridcloudworks` | Workload allocation |
| `environment` | `prod` | Environment allocation |
| `owner` | `platform` | Operational accountability |
| `costCenter` | `content-platform` | Financial ownership |
| `managedBy` | `terraform` | Change authority |
| `criticality` | `high` | Reliability context |
| `dataClassification` | `internal` | Security context |

Coverage comes from one map used everywhere, **not from a gate**. There is no
CI check that a new resource carries tags: `iac-validate.yml` runs `fmt`,
`validate`, `tflint` and Trivy, and none of them inspects the tag map. The
resources with no tags are types Azure does not tag at all — role assignments,
blob containers, Cosmos databases and containers, subnets, diagnostic settings,
budgets, peerings, federated credentials. Exceptions to the map require a reason
and an expiry date.

Cost attribution by tag therefore works today because the map is applied
uniformly, and would stop working silently the first time someone omits it.

## Measurement plan

The first baseline now exists, so this is maintenance rather than discovery:

1. Re-read month-to-date per resource after a full calendar month in
   `centralus` — the 2026-08-24 reading covers roughly five days.
2. Re-read the Platform Management subscription separately. It is the only one
   with a cost that varies with load, and it was invisible until it had a
   budget.
3. Once the deleted-lab and `southcentralus` tail clears, compare the
   application subscription's total against the workload total; a gap that
   persists is something nobody knows about.
4. Attribute by service and by the required tags.
5. Confirm the Log Analytics figure against the cap after a full **uncapped**
   day. The pre-apply ingestion numbers in `infra/observability.tf` are a floor,
   not a measurement — they were sampled while the cap was already tripping.
6. Treat a reduction as realized savings only after billed cost falls without
   violating latency, error, recovery, or security targets.

No commitment purchase is appropriate. Nothing here has a reservable shape:
Static Web Apps Standard has no reservation, serverless Cosmos has no
throughput to reserve, and Flex Consumption bills on execution.

## FINOPS_ASSESSMENT

```text
TYPE: FINOPS_ASSESSMENT
GOAL: Keep the production Azure workload below USD 150/month on the application subscription and USD 25/month on Platform Management, without violating the approved security and recovery baseline.
SCOPE: Three subscriptions (app, Platform Management, Platform Connectivity); one region, centralus. Cloudflare, Hostinger and external AI provider APIs are tracked separately because no Azure budget can see them.
CONSTRAINTS: Single primary region; anonymous public site; Entra admin only; static-first delivery; no destructive optimization.
DECISIONS: Consumption/serverless compute with zero always-ready; Cosmos Serverless; capped telemetry at 0.25 GB/day; Cloudflare retained; no Front Door, Firewall, Bastion, VPN Gateway, NAT, APIM, DDoS plan or private endpoints; no Azure OpenAI account.
FINOPS: Baseline read 2026-08-24 — USD 3.23 month-to-date over roughly five days of the current estate, against USD 37.14 subscription spend of which about 91% is retired resources. Log Analytics bills separately in Platform Management at roughly USD 20/month.
IMPLEMENTATION: Two subscription budgets with 50/75/90/100 actual plus forecast; Log Analytics daily cap and an 80%-of-cap alert; storage lifecycle and bounded versioning; zero always-ready instances; bounded maximum instance count; required allocation tags applied from one map.
VALIDATION: Re-read after a full calendar month in centralus; confirm ingestion after a full uncapped day; reconcile the workload total against the subscription total once the retired-resource tail clears.
RISK_GATES: Arming the availability test (14,400 executions/month); adding fixed-cost networking; always-ready or zone-redundant compute; provisioned Cosmos throughput; multi-region replication; Defender plans; raising the Log Analytics daily cap.
OPEN_ITEMS: Cloudflare plan cost; Hostinger billed cost; a full-month application-subscription figure; exact Azure Monitor alert-rule and web-test unit prices.
NEXT_OWNER: Workload owner for post-apply cost measurement.
```

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
| Container Registry | **Not needed** — all GitHub Actions jobs use GitHub-hosted runners, so HCW has no runner image or container-registry dependency |
| Service Bus Standard 750 h | **Rejected** for the pending async fabric — 12-month cliff to ~$10/mo; Storage Queues (ADR-0012's choice) cost pennies, never expire, and support managed identity |
| VMs / SQL / MySQL / PostgreSQL / LB / VPN GW / Public IP meters | **Not applicable** — the architecture deliberately contains none of these; standing one up to harvest an expiring freebie needs an ADR and plants month-13 bill shock |
| Key Vault Premium HSM ops, Media Services | Irrelevant (Standard-SKU vault; Media Services is retired) |

### AI options for future features — the standing reference

> **2026-08-25.** Read the table below as a menu, not as a gap. AI generation is
> live and runs entirely on **external provider APIs** keyed from Key Vault —
> there is no Azure OpenAI account and this subscription holds no model quota,
> so today's AI spend is on the providers' bills and no Azure budget sees it.
> What the table still answers is the question that comes up whenever a *new*
> AI-shaped feature is proposed: whether an always-free Azure F0 SKU does the
> job before reaching for a paid generative API.

When a new AI RPC is built, the cost choice per task is:
**paid generative APIs** (the third-party SaaS keys in Key Vault, or Azure
OpenAI if an account is ever created) versus **always-free F0 SKUs** of
individual Azure AI services. F0 mechanics that make them safe under the USD 150
ceiling:

- F0 is **always-free per service** (one F0 resource per service per
  subscription), separate from the 12-month meters — it does not expire.
- On quota exhaustion F0 **throttles (HTTP 429) instead of billing** —
  overage cannot accrue (confirmed in Microsoft Learn for Language/Speech).
- **Create the resource directly with SKU F0.** Resources provisioned
  through Microsoft Foundry default to S0 and do not inherit free tiers.
- F0 resources support managed identity / Entra auth, so the keyless posture
  applies to them exactly as it does elsewhere.

| Task shape | Free option (F0, approximate monthly allowance) | When the paid API is the only option |
| --- | --- | --- |
| Translation | Translator F0 (~2M characters) | — |
| Sentiment, key phrases, summarization, PII detection | Language F0 (~5K text records) | Long-form abstractive quality → LLM |
| Image tagging, OCR, alt-text for media/covers | Vision F0 (~5K transactions, rate-limited) | Creative captions → LLM |
| Moderating anonymous submissions | Content Safety F0 (text+image, 5 RPS) | — |
| Document/receipt extraction | Document Intelligence F0 (~500 pages; 2 pages/4 MB per request; add-ons billable) | Complex layouts |
| Speech-to-text / text-to-speech | Speech F0 (~5 audio hours / ~0.5M characters) | Real-time avatar/LLM-speech features are S0-only |
| **Content drafting, scoring, image generation** | **No free Azure tier exists** | The SaaS keys in Key Vault (the live path), or Azure OpenAI if an account is ever created |

Allowances are the documented F0 shapes at the time of writing — confirm on
the service's pricing page before building against one, and add any new
cognitive account through the normal PR + plan review (it is a new resource:
tags, ADR if architecturally material, F0 SKU stated in the diff). Creating one
is a spend decision and belongs in `TODO.md`.
