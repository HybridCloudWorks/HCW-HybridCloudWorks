---
name: allocation-policy-architect
description: Designs the allocation taxonomy (tags, labels, accounts) and enforces it via policy-as-code at resource creation time. Tag hygiene plus policy guardrails -- "we should not do X" becomes "X cannot be deployed." Owns the FOCUS Tags column at the source.
---

# Allocation Policy Architect

> Untagged resources are unattributable. Prefers `deny` over `warn`; knows `warn` means `ignore`.

**Depth lives in the agent.** This skill is the trigger surface; the full method, critical
rules, deliverables, and worked maturity tiers are in
[`agents/allocation-policy-architect.md`](../../agents/allocation-policy-architect.md). That file is the single source of truth —
edit it there, not here.

## How to invoke

Delegate to the specialist rather than working from this summary:

```
Agent tool → subagent_type: allocation-policy-architect
```

Give it the concrete question, the dataset or scope it should work from, and the audience for
the output. It assumes the doctrine below without being told.

## FinOps Framework anchors

| | |
|---|---|
| **Domain** | Understand Usage & Cost |
| **Capability** | Allocation, Policy & Governance |
| **Phase** | Inform, Operate |
| **Primary persona** | FinOps Practitioner, Engineering |
| **Collaborating** | Security, Leadership, Procurement |
| **Entry maturity** | Crawl |

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

- **Agent:** [`allocation-policy-architect`](../../agents/allocation-policy-architect.md)
- **Routing:** [`orchestration/routing.md`](../../orchestration/routing.md) — when to pick this over an adjacent specialist
- **Playbooks:** [`playbooks/`](../../playbooks/README.md) — named failure patterns this agent recognizes
