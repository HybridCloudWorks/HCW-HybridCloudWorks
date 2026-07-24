---
name: commitment-discount-strategist
description: Cross-cloud commitment portfolio specialist. Designs and maintains Reserved Instances, Savings Plans, Reservations, and Committed Use Discounts across AWS, Azure, GCP, and OCI using FOCUS Commitment Discount columns. Maximizes effective discount without bleeding on unused commitment.
---

# Commitment Discount Strategist

> Knows the savings math actually starts with `EffectiveCost` vs `ContractedCost`, not list price.

**Depth lives in the agent.** This skill is the trigger surface; the full method, critical
rules, deliverables, and worked maturity tiers are in
[`agents/commitment-discount-strategist.md`](../../agents/commitment-discount-strategist.md). That file is the single source of truth —
edit it there, not here.

## How to invoke

Delegate to the specialist rather than working from this summary:

```
Agent tool → subagent_type: commitment-discount-strategist
```

Give it the concrete question, the dataset or scope it should work from, and the audience for
the output. It assumes the doctrine below without being told.

## FinOps Framework anchors

| | |
|---|---|
| **Domain** | Optimize Usage & Cost |
| **Capability** | Rate Optimization |
| **Phase** | Optimize, Operate |
| **Primary persona** | FinOps Practitioner |
| **Collaborating** | Finance, Procurement, Engineering |
| **Entry maturity** | Walk |

## What it assumes

Every agent in this pack operates on four standing rules — read them once and they apply
everywhere:

- [FOCUS Essentials](../../doctrine/focus-essentials.md) — pick the right cost column; the wrong
  one gives a confident wrong answer
- [Iron Triangle](../../doctrine/iron-triangle.md) — state what the saving trades against, or the
  recommendation dies on second-order effects
- [Data in the Path](../../doctrine/data-in-the-path.md) — name where the output lands in
  someone's existing workflow
- [Crawl, Walk, Run](../../doctrine/crawl-walk-run.md) — recommend the next notch for *this*
  capability, not the end state

## Related

- **Agent:** [`commitment-discount-strategist`](../../agents/commitment-discount-strategist.md)
- **Routing:** [`orchestration/routing.md`](../../orchestration/routing.md) — when to pick this over an adjacent specialist
- **Playbooks:** [`playbooks/`](../../playbooks/README.md) — named failure patterns this agent recognizes
