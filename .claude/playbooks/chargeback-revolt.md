# Chargeback Revolt

> Chargeback launched before showback earned trust. Every team's first act is to dispute their bill.

## Symptom

- Chargeback goes live and the program immediately spends all of its time defending numbers
  instead of reducing cost.
- Teams escalate to leadership demanding exemptions; several get them, and the model collapses
  into special cases.
- Engineering treats the FinOps function as an adversary rather than a resource.
- The model is quietly suspended "until the data is better" — and the credibility loss outlasts
  the suspension by years.

## Why it happens

Chargeback moves real money against real budgets. The moment it does, every number becomes worth
disputing — and the disputes are frequently **correct**, because the underlying allocation has
never been validated in a low-stakes setting.

The root cause is almost always a skipped maturity notch. The sequence that works is:

> **showback → soft chargeback → hard chargeback**, roughly one notch per year.

Each notch does specific work that cannot be done later:

| Stage | What it is | What it earns |
|---|---|---|
| **Showback** | Teams see their cost. No budget impact | Data validation at zero stakes. Teams find allocation errors *before* money moves — and finding them is a contribution rather than a grievance |
| **Soft chargeback** | Costs appear in team budgets, informational; no penalty for variance | Behavioural adjustment. Teams learn to forecast and manage before being held to it |
| **Hard chargeback** | Real budget accountability | Actual optimization incentive |

Skipping to hard chargeback means the first time anyone examines their allocation closely is the
first time it costs them money. Every error found becomes evidence the system is broken — and
because the errors are real, that argument wins.

Aggravating factors:

1. **Untagged spend.** If a material share of cost cannot be attributed, it lands in a shared
   bucket allocated by some proportional rule. That bucket is where every dispute originates —
   see [`untagged-spend-drift.md`](untagged-spend-drift.md).
2. **`BilledCost` instead of `EffectiveCost`.** Charging teams on a cash basis means commitment
   purchases land arbitrarily on whoever was running that month. This is indefensible on the
   merits and teams will correctly say so. See
   [`../doctrine/focus-essentials.md`](../doctrine/focus-essentials.md).
3. **Shared costs with an unexplained split.** Networking, platform, observability, and support
   must be allocated by a rule teams understood and agreed to *before* it charged them.
4. **No cost lever.** A team charged for costs it cannot control has been given a tax, not an
   incentive. Managed platform costs and mandated tooling are the usual offenders.
5. **No executive sponsor.** The first escalation succeeds, and after that the model is optional
   — see Patrick Brogan's framing in [`../doctrine/fcp-anchors.md`](../doctrine/fcp-anchors.md).

## Detection

Leading indicators, visible before launch if anyone looks:

| Signal | Threshold suggesting you are not ready |
|---|---|
| Untagged / unallocated share of cost | > 5–10% |
| Shared-cost pool as share of total | > 20% with no agreed split rule |
| Showback dashboard engagement | Teams not opening it monthly |
| Allocation disputes during showback | Still arriving at a steady rate |
| Cost column in use | Anything other than `EffectiveCost` |
| Executive sponsor | Cannot name one |
| Time in showback | < 2–3 quarters |

Post-launch, the revolt is unmistakable: dispute volume rising month over month, exemption
requests, and the program's calendar consumed by defending numbers.

## Remediation

If the revolt is already underway, **stop and step back a notch**. Continuing costs more than
retreating.

1. **Suspend hard chargeback; revert to soft or showback.** Announce it as a deliberate
   sequencing correction, not a failure. Retreating deliberately preserves far more credibility
   than being forced back later.
2. **Triage the disputes and publish the findings.** Most will be legitimate. Fixing them
   publicly converts the dispute backlog from evidence-against into a shared work list.
3. **Fix the shared-cost pool first** — it generates disputes disproportionate to its size.
   Shrink it by improving tagging; allocate what remains by a rule teams reviewed and signed off.
4. **Switch to `EffectiveCost`** if you were not already on it.
5. **Agree exit criteria for re-advancing**: unallocated below a stated threshold, dispute rate
   near zero for two consecutive quarters, teams actively using the data. Publish them, so the
   next advance is earned against criteria rather than announced by date.
6. **Secure the executive sponsor** before re-advancing.

If chargeback has **not** launched yet, the remediation is simply not to skip the notch. Rob
Martin's three-year transition framing exists for this reason: a slow transition that holds beats
a fast one that reverses.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Chargeback is the strongest available accountability lever — when it survives. A reverted rollout delivers nothing and burns the option for years |
| **Speed** | Substantial ongoing effort in Finance and Engineering: allocation rules, dispute handling, budget integration. Sequencing properly is slower to reach hard chargeback and far faster to reach *working* hard chargeback |
| **Quality** | Trust in the cost data is the asset being spent. It is expensive to build and very slow to rebuild |
| **Carbon** | Indirect; accountability drives the decommissioning that unowned resources never get |

## Prevention

- **Never skip showback.** Two to three quarters minimum, with measured engagement.
- **Allocation before accountability.** Untagged spend below 5% before money moves.
- **`EffectiveCost`, always.**
- **Agree shared-cost rules in advance**, in writing, with the teams that will pay them.
- **Give teams a lever** — a cost they cannot influence should not be charged to them.
- **Land the data in the team's own workflow**, not a central portal — see
  [`../doctrine/data-in-the-path.md`](../doctrine/data-in-the-path.md).
- **Position the function as a resource, not an auditor** (Rich Hoyer). The tone of the rollout
  materially changes whether disputes arrive as collaboration or as escalation.

## Related

- **Agents:** `showback-chargeback-architect`, `finops-practice-lead`, `finops-enablement-lead`, `allocation-policy-architect`
- **Doctrine:** [`crawl-walk-run.md`](../doctrine/crawl-walk-run.md) — the canonical one-notch-at-a-time case
- **Doctrine:** [`fcp-anchors.md`](../doctrine/fcp-anchors.md) — Rob Martin on incremental transition; Patrick Brogan on sponsorship; Rich Hoyer on tone
- **Playbook:** [`untagged-spend-drift.md`](untagged-spend-drift.md) — the prerequisite that is usually missing
