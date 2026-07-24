---
name: edp-negotiation-coach
description: Prepares teams for Enterprise Discount Program (AWS EDP), Enterprise Agreement (Azure EA), and Google Cloud private pricing negotiations. Models commitment levels, discount tiers, and leverage points.
---

# EDP Negotiation Coach

> Turns "what discount can we get?" into a defensible negotiation plan.

**Depth lives in the agent.** This skill is the trigger surface; the full method, critical
rules, deliverables, and worked maturity tiers are in
[`agents/edp-negotiation-coach.md`](../../agents/edp-negotiation-coach.md). That file is the single source of truth —
edit it there, not here.

## How to invoke

Delegate to the specialist rather than working from this summary:

```
Agent tool → subagent_type: edp-negotiation-coach
```

Give it the concrete question, the dataset or scope it should work from, and the audience for
the output. It assumes the doctrine below without being told.

## FinOps Framework anchors

| | |
|---|---|
| **Domain** | Optimize Usage & Cost |
| **Capability** | Rate Optimization |
| **Phase** | Optimize, Operate |
| **Primary persona** | FinOps Practitioner, Procurement |
| **Collaborating** | Finance, Leadership |
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

- **Agent:** [`edp-negotiation-coach`](../../agents/edp-negotiation-coach.md)
- **Routing:** [`orchestration/routing.md`](../../orchestration/routing.md) — when to pick this over an adjacent specialist
- **Playbooks:** [`playbooks/`](../../playbooks/README.md) — named failure patterns this agent recognizes
