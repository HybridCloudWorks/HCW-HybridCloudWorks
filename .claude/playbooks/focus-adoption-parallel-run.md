# FOCUS Adoption — Parallel Run

> Cut over to FOCUS on a date and you will spend the next quarter proving the new numbers are not broken.

## Symptom

Attempted as a cutover rather than a migration, FOCUS adoption produces:

- Numbers that differ from the legacy report, with no way to explain which is right.
- Finance rejecting the new dataset because it does not tie to the report they have reconciled
  against for years.
- Dashboards silently breaking as column names and semantics change under them.
- The migration reversed, and a lasting belief that "FOCUS doesn't match our data."

## Why it happens

**FOCUS divergence from provider-native data is expected and often correct.** The spec clarifies
definitions that providers used loosely and inconsistently — that is much of its value. So a
migration inevitably produces differences, and without a reconciliation period there is no way to
distinguish:

- a **legitimate** divergence (FOCUS defines amortization or a category more strictly), from
- an **ingestion bug** in the new pipeline.

Both look identical: a number that changed. With no baseline to compare against, every difference
becomes a debate, and the organization defaults to trusting the number it already knows.

Additional forcing factors:

1. **Cost columns are not interchangeable.** Consumers built on a provider's blended or unblended
   cost do not map one-to-one onto `BilledCost` / `EffectiveCost`. Point a chargeback report at
   the wrong one and you get [`chargeback-revolt.md`](chargeback-revolt.md).
2. **Historical data is not automatically FOCUS-shaped.** Trend analysis across the cutover date
   breaks unless history is converted.
3. **The spec versions.** Adopting FOCUS is joining a moving target; the migration process needs
   to survive being repeated.

## The pattern

Run both datasets side by side and migrate consumers one at a time.

```
                    ┌─────────────────┐
  legacy export ───▶│                 │──▶ legacy consumers  (live throughout)
                    │    warehouse    │
  FOCUS export  ───▶│  (both landed)  │──▶ FOCUS consumers   (migrated one by one)
                    └────────┬────────┘
                             │
                    per-period reconciliation
                    + divergence register
```

### Phases

**1 — Stand up in parallel.** Enable the provider's FOCUS export alongside the existing one. Land
both in the warehouse; change no consumer. Both datasets are live from day one.

**2 — Reconcile per period.** Each closed billing period, compare totals at descending grain:
account → service → resource. Every divergence gets classified and recorded:

| Classification | Meaning | Action |
|---|---|---|
| **Expected — definitional** | FOCUS defines it differently | Document; this is the migration delivering value |
| **Expected — amortization** | `EffectiveCost` vs a cash-basis legacy column | Document; confirm `BilledCost` still ties to invoice |
| **Bug — ingestion** | Rows dropped, duplicated, mistyped | Fix the pipeline |
| **Bug — mapping** | Wrong source column mapped | Fix the transform |
| **Unexplained** | Not yet classified | **Blocks migration of any affected consumer** |

The **divergence register** is the primary deliverable of the whole exercise. It is what lets you
answer "why is this number different?" instantly, twelve months later, when someone asks.

**3 — Validate conformance.** Run the FOCUS Validator on every new period, plus the Requirements
Analyzer to trace failures to specific normative clauses. Maintain an annotated suppression list
for conditionally-required fields the Validator cannot evaluate — with a justification per entry.

**4 — Convert history.** Use `focus_converters` to reshape historical provider-native data so
trend analysis spans the cutover. Reconcile converted history against the legacy dataset with the
same rigour.

**5 — Migrate consumers one at a time.** Ordered by blast radius, lowest first:

1. Internal analyst queries — analysts can spot a wrong number
2. Engineering-facing dashboards
3. Executive reporting
4. **Finance reconciliation and chargeback last** — highest stakes, least tolerance for surprise

For each: rebuild on FOCUS, run both versions in parallel for at least one full period, get the
owner's explicit sign-off, then retire the legacy version.

**6 — Retire legacy.** Only after every consumer has migrated and signed off. Keep legacy
ingestion running throughout — the cost of running both pipelines is trivial against the cost of
a reversal.

### Duration

Three billing periods minimum. Anything less has not seen a month-end correction cycle, and
corrections (`ChargeClass = 'Correction'`) are exactly where idempotency bugs surface.

## Detection — is your migration in trouble?

- Divergences classified as "unexplained" that are not shrinking period over period
- Consumers migrated before their reconciliation signed off
- Validator suppressions added without justifications
- No converted history, so trend analysis has a discontinuity at the cutover
- A cutover **date** set before the divergence register was empty

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Running two pipelines costs real money for a quarter or more. It is small against a failed migration, and it is the entire insurance premium |
| **Speed** | Materially slower than a cutover. This is the deliberate trade |
| **Quality** | The reason to do it. The divergence register converts every future "why is this different?" into a lookup instead of an investigation |
| **Carbon** | Negligible; duplicate pipeline compute for a bounded period |

## Prevention — doing it right the first time

- **Never set a cutover date before the divergence register is clean.** Set exit criteria instead.
- **Reconcile at multiple grains.** Totals matching at account level while individual resources
  are wrong is a common and dangerous state.
- **`BilledCost` must still tie to the invoice to the penny.** This is the non-negotiable test —
  see [`../doctrine/focus-essentials.md`](../doctrine/focus-essentials.md).
- **Expect `EffectiveCost` not to tie**, and document the amortization delta before Finance
  encounters it.
- **Version the schema contract**, with the FOCUS spec version as part of it, so the next spec
  upgrade reuses this process rather than reinventing it.
- **Migrate Finance last.**

Organizations that have published this pattern include STMicroelectronics, GitLab, Zoom,
UnitedHealth Group, and the European Parliament — see
[`../doctrine/fcp-anchors.md`](../doctrine/fcp-anchors.md) for how to cite them.

## Related

- **Agents:** `focus-data-engineer`, `cost-warehouse-modeler`, `cloud-billing-analyst`
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — column semantics, Validator caveats, metadata, reconciliation tests
- **Doctrine:** [`crawl-walk-run.md`](../doctrine/crawl-walk-run.md) — migrate consumers one notch at a time
- **Playbook:** [`chargeback-revolt.md`](chargeback-revolt.md) — what a wrong cost column costs downstream
