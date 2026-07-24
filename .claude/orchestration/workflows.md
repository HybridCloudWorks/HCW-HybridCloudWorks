# Workflows

> Multi-agent sequences for work no single specialist owns.

Most requests route to one agent — see [`routing.md`](routing.md). These are the ones that
genuinely do not. Each names the sequence, what gates the transition between steps, and where it
is safe to run agents in parallel.

**Default to sequential.** Parallelism helps only when tracks are genuinely independent; two
agents working the same data with different assumptions produce two answers and no decision.

---

## W1 — Cost spike investigation

**Trigger:** "Our bill jumped and nobody knows why."
**Time to first answer:** minutes for steps 1–2; they resolve a large share of cases outright.

```
1. Rule out artifacts      → playbooks (no agent yet)
2. Decompose the movement  → cloud-billing-analyst
3. Attribute to a resource → cloud-billing-analyst
4. Attribute to an owner   → allocation-policy-architect  [if step 3 hits untagged spend]
5. Fix the detection gap   → budget-anomaly-operator
```

**Step 1 is not optional.** Two artifacts explain a large share of reported spikes and cost
nothing to check:
- [`month-length-illusion`](../playbooks/month-length-illusion.md) — normalize to daily run-rate
- [`masked-anomaly`](../playbooks/masked-anomaly.md) — check `ListCost` on `Usage` rows, which no
  discounting can move

Report the **residual after normalizing**, never just "it's the calendar" — a real increase
frequently hides underneath a calendar effect.

**Gate 2→3:** the movement must be isolated to a service, account, or region first. Attribution
across the whole estate is a different, much longer job.
**Gate 3→4:** only if the spend is untagged. If it is attributable, go straight to the owning team.
**Step 5 always runs.** An investigation that does not improve detection guarantees a repeat.

---

## W2 — Stand up allocation, then chargeback

**Trigger:** "We want teams accountable for their cloud spend."
**Horizon:** quarters, not weeks. Compressing it is what produces
[`chargeback-revolt`](../playbooks/chargeback-revolt.md).

```
1. Conform the data          → focus-data-engineer
2. Design the taxonomy       → allocation-policy-architect
3. Enforce at creation       → allocation-policy-architect
4. Backfill campaign         → allocation-policy-architect
5. Showback                  → showback-chargeback-architect   [2-3 quarters]
6. Soft chargeback           → showback-chargeback-architect
7. Hard chargeback           → showback-chargeback-architect
```

**Gates — each is a hard precondition, not a checkpoint:**

| Transition | Gate |
|---|---|
| 1→2 | `sum(BilledCost)` reconciles to invoice |
| 2→3 | Taxonomy agreed with enumerated values; paved-path IaC modules exist |
| 3→4 | Deny mode live on the highest-spend resource types |
| 4→5 | Unallocated share below ~10%, **measured by cost** |
| 5→6 | Teams engaging with showback; dispute rate near zero for two quarters |
| 6→7 | Executive sponsor secured; teams have levers over the costs they are charged |

**Step 3 before step 4 is the counter-intuitive part** and the whole point: campaigns before
enforcement get undone by the flow of new untagged resources. See
[`untagged-spend-drift`](../playbooks/untagged-spend-drift.md).

---

## W3 — Waste sweep

**Trigger:** "Find us savings." The fastest credible win available to a new program.
**Parallelizable:** yes — the tracks are independent.

```
Parallel:
  A. Idle & orphaned resources → idle-orphaned-resource-hunter
  B. Storage class drift       → s3-storage-class-auditor
  C. Data transfer             → cross-az-egress-investigator
  D. Licenses & SaaS           → license-saas-cost-optimizer
Then:
  E. Consolidate & sequence    → finops-practice-lead
```

**Ordering rule inside track A→B:** delete before you tier. Lifecycling data that should be
deleted is wasted work.

**Step E matters more than it looks.** Four parallel agents produce four lists with overlapping
resources, inconsistent confidence levels, and no execution order. Consolidate into one ranked
list with owners before anything is presented — and make sure each item carries its Iron Triangle
row, especially the ones that trade recovery options.

---

## W4 — Commitment portfolio cycle

**Trigger:** renewal approaching, coverage has drifted, or spend has grown materially.
**Cadence:** quarterly review, annual deep cycle.

```
1. Baseline the stable floor  → forecast-estimation-analyst
2. Assess current coverage    → commitment-discount-strategist
3. Check for masked demand    → budget-anomaly-operator
4. Model the purchase         → commitment-discount-strategist
5. Negotiate                  → edp-negotiation-coach       [if contract is in scope]
6. Feed rates back            → forecast-estimation-analyst
```

**Step 3 is the one teams skip.** Committing against a baseline that contained an anomaly locks in
demand that was never real, for the full term. Confirm the baseline window is clean before
modelling.

**Gate 4→5:** commitment sizing and contract negotiation are different conversations. Know your
portfolio before you negotiate the rates it will run under.

---

## W5 — FOCUS migration

**Trigger:** adopting FOCUS, or upgrading spec versions.
**Horizon:** three billing periods minimum.

```
1. Parallel ingest      → focus-data-engineer
2. Reconcile per period → focus-data-engineer     [repeat until register is clean]
3. Convert history      → focus-data-engineer
4. Rebuild the model    → cost-warehouse-modeler
5. Migrate consumers    → cost-warehouse-modeler  [one at a time, Finance last]
6. Retire legacy        → focus-data-engineer
```

Fully specified in [`focus-adoption-parallel-run`](../playbooks/focus-adoption-parallel-run.md).
**Gate 2→5:** no consumer migrates while any divergence affecting it is unexplained.

---

## W6 — Unit economics

**Trigger:** "What does one customer / transaction actually cost us?"

```
1. Verify allocation      → allocation-policy-architect
2. Pick the denominator   → unit-economics-modeler
3. Build the model        → unit-economics-modeler
4. Land it in the path    → unit-economics-modeler
5. Benchmark              → finops-benchmarking-analyst      [only after 3 is trusted]
```

**Step 2 is the whole exercise.** A denominator leadership already manages beats one that is easy
to compute — see the cost-per-vehicle pattern in
[`../doctrine/fcp-anchors.md`](../doctrine/fcp-anchors.md). Get this wrong and the model is
accurate and ignored.

**Gate 4→5:** benchmarking an untrusted internal number turns one disputed metric into a
cross-team argument.

---

## W7 — Pre-deployment cost gate

**Trigger:** a new workload or major architecture change.

```
1. Estimate with ranges     → forecast-estimation-analyst
2. Shape the compute        → workload-cost-optimizer
3. Reliability trade-off    → platform-sre-cost-lead
4. Carbon position          → cloud-sustainability-analyst   [where it matters]
5. Onboarding gate          → cloud-onboarding-coordinator
```

**Step 5 is what makes this stick.** An estimate that does not become a tagging, allocation, and
forecast commitment at deploy time is an estimate nobody checks against reality.

---

## W8 — Secure Azure workload, end to end

**Trigger:** "Stand up this workload on Azure, done properly." Spans the platform agents and hands
the cost baseline to the FinOps pack.

```
1. Design the topology        → azure-architect
2. Diagram it                 → azure-diagram-architect        [committed beside the IaC]
3. Author reusable IaC        → terraform-engineer
4. Harden + policy-as-code    → security-engineer
5. Wire into this repo's CI   → infrastructure-engineer        [if it lives in this repo]
6. Validate + deploy          → azure-architect
7. Cost baseline → FinOps     → cloud-billing-analyst / allocation-policy-architect
```

**Gates:**

| Transition | Gate |
|---|---|
| 1→3 | Topology decided, boundaries explicit, provisioning path chosen (app-centric vs enterprise) |
| 3→4 | Modules carry mandatory tags and pass `terraform test` |
| 4→6 | Security policy enforced (not warn) on the resource types being deployed; IaC scan clean |
| 6→7 | `azure-validate` preflight passed; deployment reconciles to plan |

**Where cost enters:** the architect produces a *baseline*, not a commitment analysis. Step 7 is
where the FinOps pack takes over — allocation keys, commitment coverage, anomaly baselines. The
architect never models commitments itself; that is [`commitment-discount-strategist`](../agents/commitment-discount-strategist.md).

**Parallelism:** steps 2 and 3 can run alongside once step 1 is fixed — the diagram derives from
the same topology the IaC implements. Step 4 must follow 3 (it hardens what was authored).

---

## W9 — Security posture campaign

**Trigger:** "Harden this estate" / audit finding / new compliance requirement.
**Parallelizable:** the assessment tracks are independent; remediation is not.

```
Parallel assessment:
  A. Identity & privileged access → security-engineer
  B. Cloud posture (CSPM)         → security-engineer
  C. Container & K8s hardening     → security-engineer
  D. Detection coverage vs ATT&CK  → security-engineer
Then:
  E. Prioritize by exploitability  → security-engineer   [EPSS + attack-path, not CVSS sort]
  F. Enforce via policy-as-code    → terraform-engineer  [Sentinel/OPA in the IaC pipeline]
  G. Evidence the compliance map   → security-engineer
```

**Step E is the one that gets skipped**, and skipping it produces a remediation backlog sorted by
severity rather than by reachability — which burns the team on findings that were never exploitable
in the topology. Prioritize before you assign.

**Gate F:** enforcement lands in the Terraform pipeline, so it composes with W8. A control that is
documented but not in the pipeline is not enforced — the same failure the FinOps pack calls
`warn means ignore`.

---

## W10 — Secure AWS workload, end to end

**Trigger:** "Stand up this workload on AWS, done properly." The AWS mirror of W8 — same shape,
same gates, same cost handoff.

```
1. Design the topology        → aws-architect
2. Diagram it                 → aws-diagram-architect         [committed beside the IaC]
3. Author reusable IaC        → terraform-engineer
4. Containerize (if needed)   → docker-expert                 [image built, hardened, scanned]
5. Harden + policy-as-code    → security-engineer
6. Wire into this repo's CI   → infrastructure-engineer       [if it lives in this repo]
7. Validate + deploy          → aws-architect
8. Cost baseline → FinOps     → cloud-billing-analyst / allocation-policy-architect
```

**Gates:**

| Transition | Gate |
|---|---|
| 1→3 | Topology decided, boundaries explicit (account/VPC/subnet/AZ), access patterns mapped to services |
| 3→5 | Modules carry mandatory tags and pass `terraform test`; image (if any) passes its scan gate |
| 5→7 | Security policy enforced (not warn) on the resource types being deployed; IaC scan clean |
| 7→8 | Preflight validation passed; deployment reconciles to plan |

**Where cost enters:** identical to W8 — the architect produces a *baseline*, step 8 hands the
decisions (allocation keys, commitment coverage, anomaly baselines) to the FinOps pack. The
architect never models commitments itself.

**Parallelism:** steps 2, 3, and 4 can run alongside once step 1 is fixed — diagram, IaC, and image
all derive from the same decided topology. Step 5 must follow 3 and 4 (it hardens what was authored
and built).

---

## W11 — Red-team to detection loop

**Trigger:** "Test our defenses" / authorized penetration test or red-team engagement. Exercises
the whole security triad; the point is not the findings but that each one ends up *detected*.

```
1. Scope + authorize          → offensive-security-engineer   [written scope; no scope, no run]
2. Emulate the adversary      → offensive-security-engineer   [findings with reproductions + ATT&CK IDs]
Then, in parallel per finding:
  3a. Close the control        → security-engineer            [remediation owner]
  3b. Author the detection     → dfir-threat-hunter           [detection owner, mapped to ATT&CK]
Then:
4. Purple re-run              → offensive-security-engineer   [verify: control holds AND detection fires]
```

**Gates:**

| Transition | Gate |
|---|---|
| 1→2 | Explicit authorization context — named engagement, signed scope, CTF, or own estate. Absent → stop and ask |
| 2→3 | Every finding carries a reproduction and an ATT&CK technique ID; unreproducible findings do not advance |
| 3→4 | Both the control shipped **and** the detection is authored and tuned |

**The loop-closing rule:** a finding is not closed until step 4 proves both halves — the control
holds and the emulated technique fires a tuned alert. Steps 3a and 3b run in parallel (different
owners, different artifacts) but the re-run gates on both. A finding remediated but not detected
leaves you blind to the next variant; a detection authored but not tuned rejoins the alert-fatigue
failure mode.

**Scope discipline is the whole game.** This workflow only exists inside an authorization envelope.
See [`../agents/offensive-security-engineer.md`](../agents/offensive-security-engineer.md) — offense
stops and asks whenever the authorization context is not clear.

---

## Composition rules

1. **Sequential unless proven independent.** W3 parallelizes because the tracks touch different
   resources. W2 cannot, because each step is the next step's precondition.
2. **Gates are preconditions, not suggestions.** A failed gate means hand back, not proceed with
   caveats — the caveat gets dropped and the number gets quoted.
3. **Every fan-out needs a consolidation step.** Parallel agents produce parallel lists; someone
   has to rank, dedupe, and assign owners.
4. **Carry the handoff envelope** between every step — see [`handoffs.md`](handoffs.md). The cost
   column especially.
5. **Match the workflow to maturity.** W2 at a Crawl org is a multi-year program; presenting it as
   a quarter's work destroys credibility at the first missed gate.
6. **Check playbooks before starting.** Several workflows terminate at step 1 when the symptom
   turns out to be a known pattern.

## Related

- [`routing.md`](routing.md) — single-agent dispatch
- [`handoffs.md`](handoffs.md) — the contract between steps
- [`../playbooks/README.md`](../playbooks/README.md) — named failure patterns
- [`../doctrine/crawl-walk-run.md`](../doctrine/crawl-walk-run.md) — pacing any of these to the org
