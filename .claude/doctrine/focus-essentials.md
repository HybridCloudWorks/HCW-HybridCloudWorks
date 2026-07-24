# FOCUS Essentials

> Pick the right cost column. The wrong column gives a confident, well-formatted, wrong answer.

**FOCUS** — the FinOps Open Cost & Usage Specification — is the canonical dataset shape for every
agent in this pack. Provider-native columns (CUR, Cost Management, BigQuery billing export) appear
only as supplemental detail in extended views, never in the conformed warehouse.

Working against FOCUS rather than provider-native schemas is what makes an agent portable across
clouds and across vendors. It is also what makes this pack reusable across projects: the analysis
logic does not change when the billing source does.

---

## 1. The cost columns — the single highest-leverage decision

Five cost columns. They answer different questions. Choosing by habit rather than by question is
the most common analytical error in cloud cost work.

| Column | Basis | Use it for | Do **not** use it for |
|---|---|---|---|
| **`BilledCost`** | Cash | Invoice reconciliation, budget-vs-actual, AP workflows | Trend analysis, chargeback — prepaid commitments land as spikes |
| **`EffectiveCost`** | Accrual | Chargeback/showback, trend analysis, true resource attribution, unit economics | Reconciling to an invoice — it will not match, by design |
| **`ListCost`** | Public rate | Measuring total savings from all discounting | Anything presented as money actually spent |
| **`ContractedCost`** | Negotiated rate | Isolating savings from **commitments** specifically (`ContractedCost − EffectiveCost`) | Rate-negotiation savings, which is `ListCost − ContractedCost` |
| **`BillingCurrency` / `PricingCurrency`** | — | Always check both before summing a multi-region estate | Assuming one currency because the first 1,000 rows agreed |

### The rule in one line

> **`BilledCost` answers "what did we pay?" `EffectiveCost` answers "what did it cost us?"**

They differ because of amortization. A $120K one-year reservation purchased in January appears in
`BilledCost` as $120K in January and $0 for the following eleven months. In `EffectiveCost` it
appears as ~$10K/month spread across the resources that actually consumed it.

Consequences you will hit:

- **Chargeback on `BilledCost` is indefensible.** The team that happened to be running in January
  absorbs the entire commitment. Every subsequent month, teams see near-zero cost for committed
  capacity. Both numbers are wrong and teams will correctly reject them.
- **Trend analysis on `BilledCost` invents cliffs and spikes** that correspond to purchase dates,
  not to consumption. See [`../playbooks/masked-anomaly.md`](../playbooks/masked-anomaly.md) — a
  commitment purchase can hide a real anomaly inside the same period.
- **`sum(EffectiveCost)` will never tie to the invoice.** That is expected, correct, and must be
  documented before Finance sees it, not after they ask.

### The savings decomposition

Two different savings stories, frequently conflated into one inflated number:

```
ListCost − ContractedCost   = savings from rate negotiation (EDP / EA / private pricing)
ContractedCost − EffectiveCost = savings from commitment discounts (RI / SP / CUD / Reservation)
ListCost − EffectiveCost    = total realized savings   ← report this, but decomposed
```

Reporting only the total lets a good negotiation mask a badly-managed commitment portfolio, or
vice versa. Decompose it.

---

## 2. Identity and join columns

| Column | Semantics | Trap |
|---|---|---|
| **`ResourceId`** | Provider-assigned unique resource identifier — the join key to inventory, CMDB, and tagging systems | Not always populated. Shared/tenant-level charges legitimately have none; do not silently drop those rows |
| **`ResourceName`** | Human-readable, **mutable** | Never join on it. Never use it as a dimension key |
| **`BillingAccountId`** / **`SubAccountId`** | The account hierarchy: payer → member (AWS account, Azure subscription, GCP project) | The natural allocation boundary when tagging is immature — see [`crawl-walk-run.md`](crawl-walk-run.md) |
| **`ChargePeriodStart` / `ChargePeriodEnd`** | The window the charge covers | Half-open intervals. Summing across a boundary double-counts if you use `<=` |
| **`BillingPeriodStart` / `BillingPeriodEnd`** | The invoice period | Not the same as charge period. Month-boundary analysis needs the right one — see [`../playbooks/month-length-illusion.md`](../playbooks/month-length-illusion.md) |
| **`InvoiceId`** | Ties rows to a specific invoice | The only correct grain for reconciliation |

**Immutable IDs only.** Every dimension key, every join, every allocation rule keys off
identifiers the provider guarantees stable. Names, tags, and descriptions all change under you.

---

## 3. The Provider / Publisher / Invoice Issuer triad

Three separate parties, routinely collapsed into "vendor" — which breaks marketplace analysis:

| Column | Who it is | Example |
|---|---|---|
| **`ProviderName`** | Who operates the infrastructure | the cloud provider |
| **`PublisherName`** | Who made the thing you are paying for | a third-party ISV selling through the marketplace |
| **`InvoiceIssuerName`** | Who actually bills you | the cloud provider, or a reseller/CSP |

Where this matters:

- **Marketplace spend** has `ProviderName != PublisherName`. It is frequently a material,
  entirely unmanaged spend category, and it often does **not** count toward commitment
  drawdown — verify per provider before modeling.
- **Reseller/CSP estates** have `InvoiceIssuerName != ProviderName`. Reconciliation targets the
  issuer's invoice, not the provider's published rates.
- **License and SaaS analysis** keys off `PublisherName` — see
  `../agents/license-saas-cost-optimizer.md`.

---

## 4. Classification columns

| Column | Values you will act on |
|---|---|
| **`ChargeCategory`** | `Usage`, `Purchase`, `Tax`, `Credit`, `Adjustment`. Filter to `Usage` for optimization work; **never** filter it out for reconciliation |
| **`ChargeClass`** | `Correction` marks a restatement of a prior period. Its presence is why the dataset is slowly-changing, not immutable |
| **`ChargeFrequency`** | `One-Time`, `Recurring`, `Usage-Based`. Forecasting must treat these differently |
| **`PricingCategory`** | `On-Demand`, `Committed`, `Dynamic` (spot/preemptible), `Other`. `Dynamic` is the spot filter; `Committed` is the commitment-coverage filter |
| **`ServiceCategory`** | Normalized service grouping (`Compute`, `Storage`, `Databases`, `Networking`, …). The portable dimension for cross-cloud comparison — provider service *names* are not comparable |
| **`SkuId` / `SkuPriceId` / `SkuMeter`** | `SkuMeter` separates sub-charges within one service — for object storage it splits storage from requests from transfer, which is the whole basis of storage-class analysis |
| **`CommitmentDiscountId` / `_Type` / `_Category` / `_Status`** | The commitment portfolio. `_Status` of `Used` vs `Unused` is the waste signal |

**`ServiceCategory` is the cross-cloud dimension.** Any multi-cloud comparison built on provider
service names is comparing labels, not workloads.

---

## 5. Tags

`Tags` is a **JSON column**, not a flat string.

- Query it with the warehouse's JSON operators; do not regex it.
- Provider-defined tags carry a provider prefix and are semantically distinct from user-defined
  tags. Keep a small reference dimension mapping prefixes so analysts can tell them apart.
- **Tag inheritance is finalized at charge time.** Retagging a resource today does **not**
  retroactively fix last month's rows. This is the single most surprising fact for teams starting
  allocation work, and it is why remediation campaigns must be paired with policy enforcement at
  creation time rather than periodic cleanup — see
  [`../playbooks/untagged-spend-drift.md`](../playbooks/untagged-spend-drift.md).
- Tag coverage is measured **by cost, not by resource count.** Ninety-five percent of resources
  tagged can still be sixty percent of spend untagged, because the untagged ones are the large
  ones.

---

## 6. Metadata: load it before you query

Every conformed FOCUS dataset carries dataset-level metadata. Surface it in a
`dim_focus_metadata` table so consumers can filter by version and schema rather than guessing.

Required:

- **`DataGenerator`** — identifies the producer
- **`Schema ID`**, **`CreationDate`**, **`FOCUS Version`**
- **Column Definition** per column: name, data type, precision/scale, string encoding and max
  length, provider tag prefixes

**Precision target for cost columns: precision 30, scale 15.** Cost data is many very small
numbers aggregating to very large numbers; naive `decimal(18,2)` accumulates visible rounding
error across hundreds of millions of rows, and the error shows up exactly where it hurts — in
the reconciliation-to-invoice test.

---

## 7. Conformance: the Validator and the Requirements Analyzer

Two open-source tools from the FinOps Foundation. Use both.

- **FOCUS Validator** — evaluates a dataset against the spec.
  <https://github.com/finopsfoundation/focus_validator>
- **Requirements Analyzer** — searchable index of the 600+ normative requirements; traces any
  failure to the specific MUST / SHOULD / MAY clause.
  <https://finops-open-cost-and-usage-spec.github.io/focus_requirements_model_analyzer/>
- **focus_converters** — retroactively shapes historical provider-native data into FOCUS.
  <https://github.com/finopsfoundation/focus_converters>

Wire the Validator into CI; failures block promotion.

**Validator caveats** — know these before you trust a green run:

1. Some FOCUS fields are **conditionally** required and the Validator cannot always determine
   whether the condition applies. Maintain an annotated suppression list with a justification per
   entry, and review it when the spec version changes.
2. **A passing sample does not imply full-dataset conformance** unless every scenario is
   represented in the sample. Production requires full-load validation.
3. Conformance is not correctness. A dataset can be perfectly conformant and still fail to tie to
   the invoice.

---

## 8. The tests that actually matter

Three, run monthly, non-negotiable:

1. **`sum(BilledCost)` grouped by `InvoiceId` reconciles to the provider invoice — to the penny.**
   This is the test that catches ingestion bugs nothing else catches.
2. **`sum(EffectiveCost)` by `BillingPeriod` does *not* match the invoice.** Confirm the delta is
   explained entirely by amortization. Document the expected variance so nobody "fixes" it.
3. **Null checks on FOCUS-required columns**, plus row counts against the source export.

Add idempotency: provider exports re-emit corrected history (`ChargeClass='Correction'`). Loads
must replay without duplicating or dropping. Build natural keys from FOCUS columns.

---

## 9. Operating rules

1. **FOCUS is the canonical shape.** Default every new pipeline to FOCUS columns.
2. **Never mutate the raw landing zone.** Transformations are downstream views. This is what lets
   you re-derive when the model changes.
3. **Schema contracts are versioned and broken deliberately.** The FOCUS spec version is part of
   the contract.
4. **Cost data is slowly-changing.** An invoice can be corrected 90+ days after period close.
5. **Separate ingestion from enrichment from allocation.** A change to allocation rules must not
   require re-extracting provider data.
6. **Batch before streaming.** Daily is right for ~95% of workloads. See
   [`iron-triangle.md`](iron-triangle.md).
7. **Migrate onto FOCUS with a parallel run.** Never cut over without a reconciliation period —
   see [`../playbooks/focus-adoption-parallel-run.md`](../playbooks/focus-adoption-parallel-run.md).

---

## 10. Quick reference — question to column

| Question | Column | Grain |
|---|---|---|
| Does this tie to the invoice? | `BilledCost` | `InvoiceId` |
| What should we charge this team? | `EffectiveCost` | allocation key (tag / `SubAccountId`) |
| Is our spend trending up? | `EffectiveCost` | `ChargePeriodStart` |
| How much are commitments saving us? | `ContractedCost − EffectiveCost` | `CommitmentDiscountId` |
| How much is rate negotiation saving us? | `ListCost − ContractedCost` | `BillingAccountId` |
| What is our commitment coverage? | `PricingCategory = 'Committed'` share | `ServiceCategory` |
| How much spot are we running? | `PricingCategory = 'Dynamic'` | workload |
| What is our unit cost? | `EffectiveCost` ÷ business metric | product / tenant |
| Which storage class is wrong? | `EffectiveCost` by `SkuMeter` | bucket / container |
| How much marketplace spend is unmanaged? | `ProviderName != PublisherName` | `PublisherName` |
| What is untagged? | `Tags` null-or-empty share of `EffectiveCost` | `ServiceCategory` |

## Related

- [`iron-triangle.md`](iron-triangle.md) — once the number is right, state what it trades against
- [`crawl-walk-run.md`](crawl-walk-run.md) — how far to push conformance at a given maturity
- [`data-in-the-path.md`](data-in-the-path.md) — the conformed FOCUS table *is* the path
