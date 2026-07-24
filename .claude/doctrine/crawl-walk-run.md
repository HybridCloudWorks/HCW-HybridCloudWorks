# Crawl, Walk, Run

> Maturity is **per-capability**, not per-org. Recommend the next notch, not the end state.

## The principle

"We're a Walk organization" is not a meaningful statement. An org can be Run on rate optimization
— a sophisticated, well-managed commitment portfolio — while sitting at Crawl on allocation, with
a third of spend untagged and no enforced policy. These are independent capabilities with
independent constraints, and they advance at independent speeds.

Assessing maturity at the org level produces advice that is simultaneously too advanced for the
weak capabilities and too basic for the strong ones, which is how a maturity assessment manages to
be useless in both directions at once.

**Assess per capability. Recommend one notch. Sequence the notches.**

## Why one notch

Skipping a notch does not accelerate the program; it stalls it, and the stall is expensive because
it burns the organization's willingness to try again.

The canonical example is chargeback. Hard chargeback rolled out before showback has earned trust
gets rejected by engineering teams — not on the merits, but because the numbers have never been
validated in a low-stakes setting and every team's first act is to dispute their bill. The
program then spends a year defending its data instead of reducing cost. The correct sequence is:

> **showback → soft chargeback → hard chargeback**, roughly one notch per year.

Rob Martin's framing (see [`fcp-anchors.md`](fcp-anchors.md)) is that maturity advances through
many small incremental decisions rather than a single transformation — and that a three-year
chargeback transition that succeeds beats a one-year one that gets reversed.

## The tiers

| Tier | Character | What it looks like |
|---|---|---|
| **Crawl** | Visibility exists, manually | Reports produced on request; a few people can answer cost questions; no automation, no enforcement, no SLA |
| **Walk** | Automated and trusted | Data is automated and reconciled; the relevant persona sees it in their own workflow; policy exists and is measured; exceptions are tracked |
| **Run** | Enforced and optimized | Guardrails prevent the bad state rather than reporting it; targets have SLOs; the capability is owned outside the central FinOps team |

The tier boundary that matters most is **Crawl → Walk**, and the thing that crosses it is almost
always *automation plus a landing place*, not more analysis. See
[`data-in-the-path.md`](data-in-the-path.md).

## Assessing a capability

Four questions per capability. Two or more "no" answers means the capability is a tier lower than
it is being described as.

1. **Is the data automated**, or does a person assemble it each cycle?
2. **Does it reconcile** — and does anyone check?
3. **Does it reach the deciding persona** in their existing workflow, unprompted?
4. **Is there an owner outside the central FinOps team** who would notice if it broke?

Self-reported maturity runs consistently one tier high. Assess against artifacts — the actual
dashboard, the actual policy, the actual alert channel — not against intent.

## Sequencing rules

1. **Allocation precedes almost everything.** Chargeback, unit economics, benchmarking, and team
   accountability all read the allocation key. A program that starts anywhere else builds on
   sand. If tag coverage by cost is below ~80%, allocation is the work.
2. **Visibility precedes accountability.** People must be able to see a number before they can be
   held to it.
3. **Measurement precedes enforcement.** Ship the policy in audit mode, measure the violation
   rate, *then* switch to deny. Note the corollary from
   `../agents/allocation-policy-architect.md`: `warn` left running indefinitely means `ignore`.
   Audit mode is a phase, not a destination.
4. **Optimize what is already measured.** Rate optimization on a spend base you cannot attribute
   produces savings nobody can be credited for — which means nobody sustains them.
5. **Advance the binding constraint.** Push the capability that is blocking the others, not the
   one that is most enjoyable to work on.

## Calibrating advice to tier

The same question gets a genuinely different answer at each tier. Advice pitched at the wrong tier
is rejected as either patronizing or impossible — and both rejections cost credibility.

| Question | Crawl answer | Walk answer | Run answer |
|---|---|---|---|
| "How should we allocate shared costs?" | Split by `SubAccountId`; ship something defensible this month | Tag-based with a documented proportional split for shared services | Metric-based allocation driven by actual consumption signals |
| "Should we buy commitments?" | Cover the stable baseline only, 1-year, no-upfront | Laddered portfolio, coverage target by `ServiceCategory` | Continuous portfolio management with utilization SLOs |
| "How do we handle anomalies?" | One budget alert on total spend | Per-team budgets with trajectory alerts | Statistical detection tuned for precision, routed to the owning team |
| "How do we do unit economics?" | One unit metric for the whole business | Per-product cost-per-unit in the product's own dashboard | Per-tenant margin, in the pricing model |

## Reporting maturity

State the tier **per capability**, with the evidence and the single next notch:

```markdown
| Capability | Tier | Evidence | Next notch |
|---|---|---|---|
| Allocation | Crawl | 30% of spend untagged; tag policy exists in audit mode only | Enforce deny on the 3 highest-spend resource types |
| Rate Optimization | Crawl→Walk | Commitments exist and are laddered; autoscaling capacity uncovered | Extend coverage target to autoscaled compute |
| Anomaly Management | Crawl | No budgets configured | One trajectory alert per top-5 spending team |
```

Never report a single org-level tier. Never recommend the end state as the next action.

## Related

- [`iron-triangle.md`](iron-triangle.md) — a trade-off the org cannot yet absorb is not available to you, however good the math
- [`data-in-the-path.md`](data-in-the-path.md) — Crawl→Walk is usually a landing-place problem
- [`fcp-anchors.md`](fcp-anchors.md) — incremental-progress framings that land with executives
- [`../playbooks/chargeback-revolt.md`](../playbooks/chargeback-revolt.md) — what skipping a notch actually costs
