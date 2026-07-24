# Routing

> Which specialist, and why not the adjacent one.

Thirty-eight agents is more than anyone holds in their head. This is the lookup: symptom or
request on the left, specialist on the right, and — most importantly — the **disambiguation
rules** for the pairs that genuinely overlap.

Skills and agents share names by design. The skill is the trigger surface; the agent holds the
depth. See [`../skills/`](../skills) and [`../agents/`](../agents).

---

## 1. Route by what the person actually said

| They said | Agent | Why this one |
|---|---|---|
| "Why did our bill go up?" | [`cloud-billing-analyst`](../agents/cloud-billing-analyst.md) | Investigation and narrative. Check [`month-length-illusion`](../playbooks/month-length-illusion.md) and [`masked-anomaly`](../playbooks/masked-anomaly.md) **first** — both are calendar/aggregation artifacts, not real increases |
| "We can't tell which team owns this spend" | [`allocation-policy-architect`](../agents/allocation-policy-architect.md) | Taxonomy plus enforcement at creation time |
| "We want to charge teams for what they use" | [`showback-chargeback-architect`](../agents/showback-chargeback-architect.md) | Picks the model that the org's maturity can actually absorb |
| "Should we buy reservations / savings plans?" | [`commitment-discount-strategist`](../agents/commitment-discount-strategist.md) | Portfolio design across all providers |
| "We're renegotiating our contract" | [`edp-negotiation-coach`](../agents/edp-negotiation-coach.md) | Leverage modelling, not commitment sizing |
| "What will this cost before we build it?" | [`forecast-estimation-analyst`](../agents/forecast-estimation-analyst.md) | Same toolkit for both horizons — forecast and pre-deployment estimate |
| "What's our cost per customer / per transaction?" | [`unit-economics-modeler`](../agents/unit-economics-modeler.md) | Connects spend to a business denominator |
| "Are we spending more than we should?" | [`finops-benchmarking-analyst`](../agents/finops-benchmarking-analyst.md) | Makes the comparison fair before making it available |
| "We got surprised by a spike" | [`budget-anomaly-operator`](../agents/budget-anomaly-operator.md) | Budget trajectory **and** statistical anomaly detection |
| "Find us waste" | [`idle-orphaned-resource-hunter`](../agents/idle-orphaned-resource-hunter.md) | One runbook for the four highest-frequency waste patterns |
| "Our storage bill keeps growing" | [`s3-storage-class-auditor`](../agents/s3-storage-class-auditor.md) | Storage-class drift; pair with [`snapshot-sprawl`](../playbooks/snapshot-sprawl.md) |
| "Data transfer costs are huge" | [`cross-az-egress-investigator`](../agents/cross-az-egress-investigator.md) | The attribution problem is the hard part |
| "Our Kubernetes costs are opaque" | [`kubernetes-finops-engineer`](../agents/kubernetes-finops-engineer.md) | Allocation first — you cannot optimize what you cannot attribute |
| "Our pods are over-provisioned" | [`kubernetes-workload-optimizer`](../agents/kubernetes-workload-optimizer.md) | Requests/limits and node autoscaling |
| "Should this run on spot / serverless / GPU?" | [`workload-cost-optimizer`](../agents/workload-cost-optimizer.md) | The three highest-leverage workload-shape decisions |
| "Reliability is costing us a fortune" | [`platform-sre-cost-lead`](../agents/platform-sre-cost-lead.md) | Makes the reliability-cost curve explicit |
| "Our licensing is a mess" | [`license-saas-cost-optimizer`](../agents/license-saas-cost-optimizer.md) | BYOL, marketplace, and entitlement compliance |
| "What's our carbon footprint?" | [`cloud-sustainability-analyst`](../agents/cloud-sustainability-analyst.md) | Cost-vs-carbon as an explicit trade |
| "Our billing data is unreliable" | [`focus-data-engineer`](../agents/focus-data-engineer.md) | Ingest, conform, reconcile, validate |
| "Every dashboard shows a different number" | [`cost-warehouse-modeler`](../agents/cost-warehouse-modeler.md) | Dimensional model downstream of conformance |
| "Should we buy a FinOps tool?" | [`finops-tooling-evaluator`](../agents/finops-tooling-evaluator.md) | Capabilities, not logos |
| "How mature are we?" | [`finops-practice-lead`](../agents/finops-practice-lead.md) | Assessed **per capability**, never org-wide |
| "Nobody engages with our cost program" | [`finops-enablement-lead`](../agents/finops-enablement-lead.md) | Usually a data-in-the-path problem, not a training problem |
| "We're migrating a workload into cloud" | [`cloud-onboarding-coordinator`](../agents/cloud-onboarding-coordinator.md) | The intake gate that stops new untagged spend at the source |

### Repo-engineering agents

These three build the software in *this* repository — its own API, UI, and deployment — not
cloud spend, and not generic platform work:

| They said | Agent |
|---|---|
| API routes, workers, database, integrations | [`backend-engineer`](../agents/backend-engineer.md) |
| React components, UI, user experience | [`frontend-engineer`](../agents/frontend-engineer.md) |
| This repo's Terraform, deployments, CI/CD, monitoring | [`infrastructure-engineer`](../agents/infrastructure-engineer.md) |

### Platform-engineering agents

These are general-purpose specialists — they apply to any project, and front the large skill
libraries merged from the platform packs:

| They said | Agent | Fronts |
|---|---|---|
| Design, deploy, validate, or troubleshoot an Azure workload | [`azure-architect`](../agents/azure-architect.md) | 26 Azure skills |
| Design, provision, secure, or troubleshoot an AWS workload | [`aws-architect`](../agents/aws-architect.md) | ~85 AWS skills |
| Harden, detect, or prove compliance — defensive security work | [`security-engineer`](../agents/security-engineer.md) | ~355 defensive skills |
| Authorized penetration testing, red-team, adversary emulation | [`offensive-security-engineer`](../agents/offensive-security-engineer.md) | ~170 offensive skills |
| Forensics, incident response, threat hunting, detection engineering | [`dfir-threat-hunter`](../agents/dfir-threat-hunter.md) | ~290 DFIR skills |
| Write a Terraform provider, module, test, or policy | [`terraform-engineer`](../agents/terraform-engineer.md) | 17 Terraform skills |
| A formal, exportable Azure architecture diagram | [`azure-diagram-architect`](../agents/azure-diagram-architect.md) | `azure2-architecture-diagram` |
| A formal, exportable AWS architecture diagram | [`aws-diagram-architect`](../agents/aws-diagram-architect.md) | `aws-architecture-diagram` |
| Optimize, harden, or debug a container image / Dockerfile | [`docker-expert`](../agents/docker-expert.md) | `docker-expert` + container-security skills |
| Design, create, debug, or upgrade a GitHub Agentic Workflow | [`agentic-workflow-engineer`](../agents/agentic-workflow-engineer.md) | ~40 gh-aw skills |
| Set up or modernize Python tooling (uv, ruff, ty) | [`python-engineer`](../agents/python-engineer.md) | `modern-python` |

---

## 2. Disambiguation — the pairs that genuinely overlap

These are the routing mistakes that actually get made.

**`allocation-policy-architect` vs `showback-chargeback-architect`**
Allocation produces the *key* — the tag or account that says who owns a cost. Chargeback decides
what to *do* with it. Allocation always comes first; chargeback built on weak allocation produces
[`chargeback-revolt`](../playbooks/chargeback-revolt.md).

**`commitment-discount-strategist` vs `edp-negotiation-coach`**
The strategist sizes and shapes the commitment portfolio (what to buy, what term, what coverage).
The coach prepares for the *negotiation* with the provider (leverage, tiers, timing). Sequence:
coach sets the contract, strategist operates inside it.

**`focus-data-engineer` vs `cost-warehouse-modeler`**
The engineer owns getting data in and conformed to FOCUS. The modeler owns the dimensional model
built on top of it. Engineer answers "is this data right?"; modeler answers "why does every tool
show a different number?"

**`kubernetes-finops-engineer` vs `kubernetes-workload-optimizer`**
FinOps engineer = **allocation** (whose cost is this namespace?). Workload optimizer =
**efficiency** (are these requests right?). Allocation first — optimization without attribution
produces savings nobody gets credited for and nobody sustains.

**`budget-anomaly-operator` vs `cloud-billing-analyst`**
The operator builds the *detection system*. The analyst investigates a *specific* movement. If
the question is "why did this happen?", route to the analyst; if it is "why didn't we catch
this?", route to the operator.

**`workload-cost-optimizer` vs `platform-sre-cost-lead`**
The optimizer picks the compute shape for a workload. The SRE lead governs the reliability-cost
trade across the platform. "Should this be spot?" → optimizer. "Do we need four nines?" → SRE lead.

**`unit-economics-modeler` vs `finops-benchmarking-analyst`**
Unit economics is **internal** (cost per unit of our own output). Benchmarking is **comparative**
(how we compare to peers or to each other). Unit economics is a prerequisite for meaningful
benchmarking.

**`forecast-estimation-analyst` vs `cloud-onboarding-coordinator`**
The analyst prices a proposal. The coordinator runs the *process* that ensures a landing workload
is tagged, allocated, and forecast. Estimation is one input to onboarding.

**`idle-orphaned-resource-hunter` vs `s3-storage-class-auditor`**
Hunter deletes things that should not exist. Auditor moves things that exist into a cheaper tier.
Delete before you tier — there is no point lifecycling data that should be gone.

### Platform agents — the overlaps that get mis-routed

**`infrastructure-engineer` vs `azure-architect` vs `terraform-engineer`**
The dividing line is *this repo* vs *general craft*.
- Changing `infra/terraform/` in **this** repository, its CI/CD, or its Azure deployment →
  [`infrastructure-engineer`](../agents/infrastructure-engineer.md). It knows this codebase.
- Designing or troubleshooting an Azure workload in general (topology, AKS, App Service,
  diagnostics) → [`azure-architect`](../agents/azure-architect.md).
- The Terraform *itself* as a craft — writing a provider, a reusable module, tests, Sentinel
  policy → [`terraform-engineer`](../agents/terraform-engineer.md).
One request can touch all three: `azure-architect` decides the topology, `terraform-engineer`
builds the reusable module, `infrastructure-engineer` wires it into this repo's pipeline.

**`azure-architect` vs `azure-diagram-architect`**
Architect *designs and builds*; diagram architect *draws what exists or is proposed*. "Set up
AKS" → architect. "Diagram our resource group" → diagram architect (or the quick
`azure-resource-visualizer` skill for a throwaway Mermaid sketch).

**`security-engineer` vs `allocation-policy-architect` / `terraform-engineer`**
All three do policy-as-code, and the distinction is intent. Security intent (block privilege,
enforce encryption, restrict network) → [`security-engineer`](../agents/security-engineer.md).
Cost-allocation intent (enforce tags) → [`allocation-policy-architect`](../agents/allocation-policy-architect.md).
The *mechanism* (Sentinel, OPA in a Terraform pipeline) → [`terraform-engineer`](../agents/terraform-engineer.md).
They share the deny-over-warn doctrine, so they compose cleanly.

**`azure-architect`'s `azure-cost` skill vs the FinOps pack**
The `azure-cost` skill answers "what am I spending on Azure?" — a provider-native query. Anything
requiring a *decision* (commit? allocate? what does it trade against? is this an anomaly?) leaves
Azure-native tooling and routes to the FinOps agents. The architect hands off; it does not model
commitments itself.

**`python-engineer` vs `backend-engineer`**
Python engineer sets up *tooling* (uv, ruff, ty, pyproject, CI gates). Backend engineer writes the
*application logic*. "Migrate our workers off pip" → python-engineer. "Add an ingestion endpoint"
→ backend-engineer.

**`aws-architect` vs `azure-architect` vs `infrastructure-engineer`**
Same dividing line as the Azure trio: *general craft* vs *this repo*. Designing or troubleshooting
an AWS workload in general (VPC topology, ECS/Lambda, RDS choice, IAM) →
[`aws-architect`](../agents/aws-architect.md). The Azure equivalent →
[`azure-architect`](../agents/azure-architect.md). Changing **this** repository's own
infrastructure, its CI/CD, or its deployment → [`infrastructure-engineer`](../agents/infrastructure-engineer.md).
Both cloud architects hand every cost *decision* to the FinOps pack and produce only a baseline.

**`aws-architect` vs `aws-diagram-architect`**
Architect *designs and builds*; diagram architect *draws what exists or is proposed*. "Design a
multi-AZ VPC" → architect. "Diagram our production account" → diagram architect. Identical split to
the Azure pair.

**The security triad: `security-engineer` vs `offensive-security-engineer` vs `dfir-threat-hunter`**
One library, three intents. **Build or harden a control, prove compliance** → defensive
[`security-engineer`](../agents/security-engineer.md). **Attack it under authorization** (pentest,
red-team, adversary emulation, LLM red-teaming) → [`offensive-security-engineer`](../agents/offensive-security-engineer.md).
**Investigate, hunt, or author a detection** (forensics, IR, malware analysis, SIEM/EDR rules,
threat intel) → [`dfir-threat-hunter`](../agents/dfir-threat-hunter.md). They compose as a loop —
offense finds the gap, defense closes it, DFIR proves it's now detected; see
[`handoffs.md`](handoffs.md). Every offensive engagement requires an explicit authorization
context; without one, offense stops and asks.

**`docker-expert` vs the Kubernetes agents vs `aws-architect`**
Docker expert owns the *image and its build* (Dockerfile, size, hardening, Compose). The
Kubernetes agents own what *runs* it — [`kubernetes-workload-optimizer`](../agents/kubernetes-workload-optimizer.md)
for requests/limits and scheduling, [`kubernetes-finops-engineer`](../agents/kubernetes-finops-engineer.md)
for cost allocation. Cloud container *services* (ECS, Fargate, App Runner) →
[`aws-architect`](../agents/aws-architect.md). "Shrink this image" → docker-expert. "Size these
pods" → workload optimizer.

**`agentic-workflow-engineer` vs `infrastructure-engineer`**
The agentic-workflow engineer builds *gh-aw agentic workflows* (markdown agents compiled to GitHub
Actions). The infrastructure engineer owns *this repo's own* CI/CD and deployment pipelines.
"Create a PR-triage agentic workflow" → agentic-workflow-engineer. "Fix our release pipeline" →
infrastructure-engineer. Hardening the Actions themselves (secrets, OIDC, supply chain) →
[`security-engineer`](../agents/security-engineer.md).

---

## 3. Route by FinOps Framework domain

| Domain | Agents |
|---|---|
| **Understand Usage & Cost** | `focus-data-engineer`, `cost-warehouse-modeler`, `cloud-billing-analyst`, `allocation-policy-architect`, `kubernetes-finops-engineer` |
| **Quantify Business Value** | `forecast-estimation-analyst`, `unit-economics-modeler`, `finops-benchmarking-analyst`, `budget-anomaly-operator` |
| **Optimize Usage & Cost** | `commitment-discount-strategist`, `edp-negotiation-coach`, `workload-cost-optimizer`, `kubernetes-workload-optimizer`, `idle-orphaned-resource-hunter`, `s3-storage-class-auditor`, `cross-az-egress-investigator`, `platform-sre-cost-lead`, `license-saas-cost-optimizer`, `cloud-sustainability-analyst` |
| **Manage the FinOps Practice** | `finops-practice-lead`, `finops-enablement-lead`, `finops-tooling-evaluator`, `showback-chargeback-architect`, `cloud-onboarding-coordinator` |
| **Platform (any project)** | `azure-architect`, `aws-architect`, `terraform-engineer`, `azure-diagram-architect`, `aws-diagram-architect`, `docker-expert`, `agentic-workflow-engineer`, `python-engineer` |
| **Security (any project)** | `security-engineer` (defend), `offensive-security-engineer` (attack, authorized), `dfir-threat-hunter` (detect & investigate) |
| **This repo's own build** | `backend-engineer`, `frontend-engineer`, `infrastructure-engineer` |

## 4. Route by symptom to playbook

Some requests are a known failure pattern, and the playbook is faster than any agent. Check these
before dispatching:

| Symptom | Playbook |
|---|---|
| Month-over-month change of roughly ±10% | [`month-length-illusion`](../playbooks/month-length-illusion.md) |
| Spend flat but a team reports a runaway workload | [`masked-anomaly`](../playbooks/masked-anomaly.md) |
| Storage cost rising, volume capacity flat | [`snapshot-sprawl`](../playbooks/snapshot-sprawl.md) |
| Hourly networking charges with no traffic | [`zombie-nat-gateway`](../playbooks/zombie-nat-gateway.md) · [`idle-load-balancer`](../playbooks/idle-load-balancer.md) |
| Large unattributable inter-zone transfer | [`cross-az-chatterbox`](../playbooks/cross-az-chatterbox.md) |
| Tag coverage decaying after a campaign | [`untagged-spend-drift`](../playbooks/untagged-spend-drift.md) |
| Teams disputing their chargeback bills | [`chargeback-revolt`](../playbooks/chargeback-revolt.md) |
| FOCUS numbers don't match the legacy report | [`focus-adoption-parallel-run`](../playbooks/focus-adoption-parallel-run.md) |

## 5. Routing rules

1. **Check the playbooks first.** A named pattern is a diagnosis; an agent is an investigation.
2. **Allocation before optimization**, always. Both `kubernetes-*` and the
   chargeback/optimization chains depend on it.
3. **One specialist, not five.** Fan out only when the tracks are genuinely independent — see
   [`workflows.md`](workflows.md).
4. **Match the maturity.** An agent will pitch to the tier you describe; describe it accurately or
   you get advice the org cannot use. See [`../doctrine/crawl-walk-run.md`](../doctrine/crawl-walk-run.md).
5. **Name the audience.** Every agent shapes output differently for Engineering, Finance,
   Procurement, and Leadership.

## Related

- [`workflows.md`](workflows.md) — multi-agent sequences for work no single specialist owns
- [`handoffs.md`](handoffs.md) — what one agent must pass to the next
- [`../doctrine/README.md`](../doctrine/README.md) · [`../playbooks/README.md`](../playbooks/README.md)
