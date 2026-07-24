# Handoffs

> What one agent must hand the next, so the second doesn't start from nothing.

Multi-agent work fails at the seams. An agent that receives "look at the Kubernetes costs" spends
its first third of the work rediscovering what the previous agent already established — and
frequently reaches a different conclusion, because it made different assumptions silently.

A handoff is a **contract**: named fields, stated assumptions, explicit confidence.

## The handoff envelope

Every agent-to-agent handoff carries these, whatever the specific payload:

```markdown
## Handoff: <from-agent> → <to-agent>

**Question answered:** <what the upstream agent was asked>
**Scope:** <accounts / date range / services / teams the analysis covers>
**Cost column used:** BilledCost | EffectiveCost | ListCost | ContractedCost
**Data source:** <table / export / API, with the period and freshness>
**Confidence:** high | medium | low — <what would change the answer>

### Findings
<the payload — see the per-pair contracts below>

### Assumptions the next agent inherits
- <each one stated, because unstated assumptions become the next agent's bugs>

### Known gaps
- <what was NOT covered, so it doesn't get silently assumed as covered>
```

**The cost column is mandatory in every handoff.** It is the single most common source of
downstream error: an analysis done on `BilledCost` handed to an agent that assumes accrual basis
produces a confident wrong answer with no visible symptom. See
[`../doctrine/focus-essentials.md`](../doctrine/focus-essentials.md).

---

## Contracts for the common pairs

### `focus-data-engineer` → anyone

The foundational handoff. Everything downstream depends on it.

| Field | Why the receiver needs it |
|---|---|
| Conformed table name and FOCUS version | Column semantics differ between spec versions |
| Reconciliation status per period | Whether `sum(BilledCost)` ties to invoice — if not, no downstream number is defensible |
| Validator result and active suppressions | Known conformance gaps, with justifications |
| Freshness and coverage window | How current, and which accounts/providers are actually in it |
| Known divergences | Especially during a [parallel run](../playbooks/focus-adoption-parallel-run.md) |

**Blocking rule:** if reconciliation fails for a period, downstream agents must be told, and
should refuse to produce chargeback or executive-facing numbers from it.

### `allocation-policy-architect` → `showback-chargeback-architect`

| Field | Why |
|---|---|
| Tag coverage **by cost**, per account and service category | Count-based coverage hides the problem — the untagged resources are the big ones |
| The allocation key, and its enumerated valid values | Chargeback needs a key with normalized values, not just a populated column |
| Unallocatable share, split into "untagged" vs "structurally shared" | These need different treatment; only the first is fixable by tagging |
| Enforcement state per resource type: none / audit / deny | `warn` left running means `ignore` — the receiver must know which it is |

**Blocking rule:** unallocated share above ~10% means chargeback is not ready. Hand back, don't
hand forward — see [`../playbooks/chargeback-revolt.md`](../playbooks/chargeback-revolt.md).

### `cloud-billing-analyst` → `budget-anomaly-operator`

| Field | Why |
|---|---|
| The anomaly's true start date, not its discovery date | Sizing the miss, and tuning to catch it earlier next time |
| Which series would have caught it | The detection gap is the actual deliverable |
| Whether a known event masked it | Drives the decomposed-series requirement in [`masked-anomaly`](../playbooks/masked-anomaly.md) |
| Grain at which it was visible | Aggregate detection misses what per-team detection catches |

### `commitment-discount-strategist` ↔ `forecast-estimation-analyst`

Bidirectional, and the direction matters.

**Forecast → commitment:** the baseline that is safe to commit against, with a confidence
interval and the drivers behind it. Commitments sized against a point estimate over-commit.

**Commitment → forecast:** existing coverage, expiry schedule, and effective rates, so the
forecast prices future usage at effective rather than on-demand rates.

**Shared trap:** a commitment sized during an inflated-usage window commits to demand that was
never real. If the baseline period contained an anomaly, say so explicitly.

### `kubernetes-finops-engineer` → `kubernetes-workload-optimizer`

| Field | Why |
|---|---|
| Per-namespace / per-workload cost attribution | The optimizer needs to know what is worth optimizing |
| Idle vs requested vs used, separated | Three different problems with three different fixes |
| Shared cluster overhead and its allocation rule | Otherwise the optimizer optimizes a number that includes costs the workload cannot influence |

**Ordering rule:** allocation completes before optimization starts.

### Any optimizer → `platform-sre-cost-lead`

When a recommendation trades reliability, the SRE lead owns the decision — not the optimizer.

| Field | Why |
|---|---|
| The full Iron Triangle table | Especially the quality row, quantified |
| Current vs proposed reliability posture | Headroom removed, redundancy reduced, RTO/RPO change |
| Who must sign off | A trade nobody accepted is not a decision |

### Anyone → `finops-practice-lead`

For maturity assessment, findings roll up as evidence:

| Field | Why |
|---|---|
| Capability touched, and observed tier with evidence | Maturity is per-capability, assessed against artifacts not intent |
| The single next notch | Not the end state — see [`../doctrine/crawl-walk-run.md`](../doctrine/crawl-walk-run.md) |
| Blockers outside the capability's control | These become sequencing constraints |

---

## Contracts for the platform pairs

### `azure-architect` → `terraform-engineer`

| Field | Why |
|---|---|
| Provisioning path: app-centric (azd) vs enterprise (subscription-scope) | Determines the module structure — the wrong one produces IaC that works but can't be governed |
| Boundary decisions: subscriptions, resource groups, VNet/subnet layout | The module's structure has to match the topology, not invent its own |
| Identity model: which managed identities, which roles | So RBAC is authored in, not bolted on after a failed deploy |
| Region and zone-redundancy decisions, with their cost stated | These are the expensive parameters; the module should make them explicit inputs |

### `azure-architect` / `aws-architect` / `terraform-engineer` → `security-engineer`

| Field | Why |
|---|---|
| The resource types being deployed | Determines which hardening skills and which policy set apply |
| Current enforcement state per type: none / audit / deny | Security must know what is already guarded vs open |
| Network exposure: public endpoints, ingress paths | Drives segmentation and WAF decisions |
| Compliance regime in scope (PCI, HIPAA, ISO, NERC CIP…) | Selects the control-to-framework mapping |

**Blocking rule:** security enforcement lands in the Terraform pipeline (Sentinel/OPA). A control
handed back as "documented" but not in the pipeline is not enforced — treat it as not done.

### `security-engineer` / `allocation-policy-architect` → `terraform-engineer`

Both hand policy *intent*; the engineer owns the *mechanism*.

| Field | Why |
|---|---|
| The rule, and whether it is audit or deny | Same deny-over-warn discipline across cost and security |
| The resource types it applies to, ranked by spend or risk | Roll out enforcement highest-impact-first |
| The paved-path module that makes compliance the default | Enforcing without a paved path makes the team an obstacle — see [`../playbooks/untagged-spend-drift.md`](../playbooks/untagged-spend-drift.md) |

### `azure-architect` → FinOps pack

The architect produces a **baseline**, never a commitment analysis.

| Field | Why |
|---|---|
| The deployed topology and its `azure-cost` baseline | The starting point for allocation and anomaly baselines |
| Region, SKU, and zone-redundancy choices | These are the cost drivers the FinOps pack will question |
| **Explicitly: no commitment modelling done** | So the strategist knows to start fresh, not to trust an inline guess |

Route the actual decisions to [`commitment-discount-strategist`](../agents/commitment-discount-strategist.md),
[`allocation-policy-architect`](../agents/allocation-policy-architect.md), and
[`budget-anomaly-operator`](../agents/budget-anomaly-operator.md).

### `azure-architect` → `azure-diagram-architect`

| Field | Why |
|---|---|
| The topology, and the IaC it derives from | The diagram is *derived*, not drawn — it needs the source |
| Which boundaries and flows are cost- or risk-significant | So the diagram calls them out rather than burying them |

### `aws-architect` → `aws-diagram-architect`

The AWS mirror of the pair above.

| Field | Why |
|---|---|
| The topology, and the IaC it derives from (CloudFormation / CDK / Terraform) | The diagram is *derived*, not drawn — it needs the source |
| Which boundaries and flows are cost- or risk-significant (cross-AZ, cross-region, egress) | So the diagram calls them out rather than burying them |

### `aws-architect` → FinOps pack

Like the Azure architect, the AWS architect produces a **baseline**, never a commitment analysis.

| Field | Why |
|---|---|
| The deployed topology and its `aws-billing-and-cost-management` baseline | The starting point for allocation and anomaly baselines |
| Region, instance-family, and multi-AZ choices | These are the cost drivers the FinOps pack will question |
| **Explicitly: no commitment modelling done** | So the strategist knows to start fresh, not to trust an inline guess |

Route the actual decisions to [`commitment-discount-strategist`](../agents/commitment-discount-strategist.md),
[`allocation-policy-architect`](../agents/allocation-policy-architect.md), and
[`budget-anomaly-operator`](../agents/budget-anomaly-operator.md).

### `docker-expert` → Kubernetes agents

The image stops where the orchestrator begins.

| Field | Why |
|---|---|
| The image, its base, and its resource footprint (memory/CPU at rest and under load) | The optimizer needs a real footprint to set requests/limits, not a guess |
| Non-root / capability / read-only-rootfs posture | Determines the Pod Security Standard the workload can meet |
| What runtime config the image expects (env, secrets, volumes) | So the Deployment wires it correctly instead of rediscovering it |

Route to [`kubernetes-workload-optimizer`](../agents/kubernetes-workload-optimizer.md) for
sizing and scheduling, [`kubernetes-finops-engineer`](../agents/kubernetes-finops-engineer.md)
for cost allocation.

---

## Contracts for the security triad

The three security agents share one library and hand work around a loop: offense finds the
gap, defense closes it, DFIR proves it's now detected.

### `offensive-security-engineer` → `security-engineer` / `dfir-threat-hunter`

The output of an authorized engagement is a defender's backlog, split two ways.

| Field | Why |
|---|---|
| Each finding with a **reproduction** (steps, payload, preconditions) | A finding the defender cannot reproduce cannot be fixed or verified |
| The **ATT&CK technique ID** per finding | Turns a raw finding into a detection requirement `dfir-threat-hunter` can author against |
| Remediation owner vs detection owner, split | `security-engineer` owns the control that closes it; `dfir-threat-hunter` owns the detection that catches the next attempt |
| Scope and authorization reference | So downstream work stays inside the same authorized envelope |

**Loop-closing rule:** a finding is not closed until the control ships *and* the emulated
technique fires a tuned detection. Offense → defense (fix) and offense → DFIR (detect) run in
parallel, then the purple-team re-run verifies both.

### `dfir-threat-hunter` → `security-engineer`

| Field | Why |
|---|---|
| The gap a hunt or investigation exposed, mapped to ATT&CK | Becomes a control requirement, not just an incident note |
| Whether an existing control failed or was absent | Failed control → tune; absent control → build |
| Indicators and detections to promote to standing rules | So the one-time hunt becomes continuous coverage |

---

## Rules

1. **State the cost column.** Every time. No exceptions.
2. **Pass confidence, not just conclusions.** "High confidence on compute, low on networking
   because flow logs cover only two of five accounts" is actionable; a bare number is not.
3. **Pass gaps explicitly.** What you did not examine will otherwise be assumed examined.
4. **Never silently re-scope.** If the receiving agent needs a different window or grain, it says
   so rather than quietly substituting one.
5. **Hand back when a precondition fails.** An agent that cannot do defensible work on the inputs
   it received should say so, not produce a caveated number that will be quoted without the caveat.
6. **Preserve the trade-off.** The Iron Triangle table travels with the recommendation all the way
   to the decision-maker. It is the first thing lost in summarization and the thing whose loss
   causes rejection — see [`../doctrine/iron-triangle.md`](../doctrine/iron-triangle.md).

## Related

- [`routing.md`](routing.md) — picking the right specialist in the first place
- [`workflows.md`](workflows.md) — the sequences these handoffs connect
