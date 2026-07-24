# FinOps Canon Anchors

> Named framings and case studies to cite when a recommendation needs external weight.

## What this file is for

An argument that sounds like the practitioner's personal opinion gets debated. The same argument
attached to a named practitioner or a recognizable organization gets considered. These anchors
exist so agents can reach for credibility at the moment a stakeholder pushes back, rather than
re-deriving first principles in a meeting.

> **Use with care.** The entries below are **paraphrased summaries** of framings from the FinOps
> Foundation community — talks, case studies, and published material. They are written here as
> *concepts attributed to their originator*, not as verbatim quotations. Before putting any of
> these into a client-facing deliverable, verify the current wording and source against the
> FinOps Foundation's published material and cite that source directly. Do not present a
> paraphrase as a direct quote, and do not attribute specific numbers to a named person without
> confirming them.

---

## Framings

### The forgotten dev environment — J.R. Storment

The story of a long-running non-production environment quietly accumulating a very large bill
before anyone noticed, because no single person owned the question "should this still exist?"

**Use it for:** waste-detection work, and for making the case that visibility without ownership
changes nothing. It reframes idle resources from an engineering hygiene issue into an
accountability gap.
**Agents:** `idle-orphaned-resource-hunter`, `allocation-policy-architect`, `finops-practice-lead`

### Incremental decisions compound — Rob Martin

Maturity advances through many small decisions made well, not through a single transformation
program. The corollary that matters operationally: a three-year chargeback transition that sticks
beats a one-year transition that gets reversed.

**Use it for:** defending a staged roadmap against pressure to deliver the end state immediately.
**Agents:** `showback-chargeback-architect`, `finops-practice-lead`, `finops-enablement-lead`
**Doctrine:** [`crawl-walk-run.md`](crawl-walk-run.md)

### Many small commitments beat a few large ones — Rob Martin

A laddered portfolio of smaller commitments preserves flexibility and smooths expiry risk,
relative to a small number of large ones timed together.

**Use it for:** commitment portfolio design, and against the instinct to make one big purchase to
maximize the headline discount.
**Agents:** `commitment-discount-strategist`, `edp-negotiation-coach`

### Porsche vs Toyota — Gabe Hege

Reframes "is this too expensive?" — which is unanswerable — into "which one did we intend to
buy?" Both are legitimate purchases. The failure mode is buying the expensive one while believing
you bought the economical one.

**Use it for:** cost-vs-quality conversations with Engineering and Leadership, especially around
reliability tiers and over-provisioned architectures.
**Agents:** `platform-sre-cost-lead`, `cloud-billing-analyst`, `workload-cost-optimizer`
**Doctrine:** [`iron-triangle.md`](iron-triangle.md)

### The helpful resource that isn't making demands — Rich Hoyer

The FinOps function succeeds when engineering teams experience it as a resource that makes their
work easier, and fails when it is experienced as an auditor issuing requirements.

**Use it for:** designing the operating model and the tone of every recurring communication.
**Agents:** `finops-enablement-lead`, `finops-practice-lead`, `platform-sre-cost-lead`

### Start without waiting for perfection — FinOps X EU sustainability keynote

Applied to carbon measurement: imperfect emissions data that reaches a decision point beats
precise data that arrives after the architecture is fixed. Generalizes to any capability where
data-quality perfectionism is being used to defer starting.

**Use it for:** unblocking sustainability and unit-economics work stalled on data quality.
**Agents:** `cloud-sustainability-analyst`, `unit-economics-modeler`
**Doctrine:** [`data-in-the-path.md`](data-in-the-path.md)

### Team evolution over time — Dann Berg

How a FinOps team's shape and remit change as the practice matures — the central team's job
shifts from doing the work to enabling others to do it.

**Use it for:** organizational design questions and headcount conversations.
**Agents:** `finops-practice-lead`, `finops-enablement-lead`

### Executive sponsorship is a prerequisite — Patrick Brogan

Programs without an executive sponsor stall at the point where they first require a team to do
something that is not in that team's own interest — which is exactly where the value is.

**Use it for:** the case for securing sponsorship before scaling, not after.
**Agents:** `finops-practice-lead`, `showback-chargeback-architect`

### Efficiency Engineering — Target

Framing the discipline as an engineering capability rather than a finance reporting function,
which changes both who owns it and how build-vs-buy decisions get made.

**Use it for:** build-vs-buy analysis and for positioning the practice inside an
engineering-led organization.
**Agents:** `finops-tooling-evaluator`, `platform-sre-cost-lead`

---

## Case study patterns

### Metric-based allocation — GitLab

Allocating shared and platform costs by an actual consumption signal rather than a flat or
headcount-based split.

**Use it for:** the Walk→Run notch on allocation, once tagging is solid.
**Agents:** `showback-chargeback-architect`, `allocation-policy-architect`, `kubernetes-finops-engineer`

### Cost per vehicle — Renault connected-car

Unit economics anchored to a business unit that leadership already manages — cost per connected
vehicle — rather than to an infrastructure unit.

**Use it for:** choosing a unit metric that leadership already cares about, instead of one that is
merely easy to compute.
**Agents:** `unit-economics-modeler`, `finops-benchmarking-analyst`

### FOCUS parallel-run adoption — STMicroelectronics, GitLab, Zoom, UnitedHealth Group, European Parliament

Organizations that migrated onto FOCUS by running the new export alongside the legacy one and
reconciling per period before cutting any consumer over.

**Use it for:** justifying a parallel-run period against pressure to cut over on a date.
**Agents:** `focus-data-engineer`, `cost-warehouse-modeler`
**Playbook:** [`../playbooks/focus-adoption-parallel-run.md`](../playbooks/focus-adoption-parallel-run.md)

### Tag-driven snapshot lifecycle — Joe Daly

Using a tag written at creation time to drive automated retention and expiry for snapshots and
volumes, rather than periodic manual cleanup campaigns.

**Use it for:** the canonical answer to snapshot sprawl — it fixes the generator, not the symptom.
**Agents:** `idle-orphaned-resource-hunter`, `allocation-policy-architect`
**Playbook:** [`../playbooks/snapshot-sprawl.md`](../playbooks/snapshot-sprawl.md)

---

## Using anchors well

1. **Cite by name, once, at the point of resistance.** An anchor deployed where there is no
   objection is filler.
2. **Attribute honestly.** Name the person or organization and the framing. If you need a direct
   quotation, go and get the actual wording from the source.
3. **Never invent a number.** If you cannot confirm a figure attributed to a named party, describe
   the pattern without the figure.
4. **Prefer the anchor closest to your audience's world.** An engineering audience moves on the
   Efficiency Engineering framing; a finance audience moves on the parallel-run case studies.
5. **Keep this file current.** Anchors go stale. When one stops landing, replace it.

## Related

- [`crawl-walk-run.md`](crawl-walk-run.md) · [`iron-triangle.md`](iron-triangle.md) · [`data-in-the-path.md`](data-in-the-path.md) · [`focus-essentials.md`](focus-essentials.md)
