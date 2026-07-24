# Data in the Path

> A report nobody opens is worth zero. Put the number where the decision already happens.

## The principle

Cost data has no value at rest. It acquires value only at the moment it changes a decision — and
decisions get made inside workflows that already exist, on surfaces people already have open.

The default failure is building a *destination*: a dashboard, a portal, a weekly PDF. A
destination requires the audience to remember it exists, navigate to it, and interpret it — three
chances to lose them, repeated every cycle. Adoption decays to near zero within a quarter and the
data is blamed for being wrong when the real problem is that it was never read.

The alternative is putting the number **in the path**: on the surface the person is already
looking at, at the moment the decision is live.

## The test

Before building any deliverable, answer three questions. If you cannot, do not build it yet.

1. **Who decides?** A named role, not "the business." (See the FinOps Framework Personas —
   Engineering, Finance, Procurement, Product, Leadership, FinOps Practitioner.)
2. **Where are they when they decide?** The actual surface: a pull request, a sprint board, the
   month-end close workbook, a Slack/Teams channel, an architecture review doc, a renewal
   pipeline, an on-call runbook.
3. **What decision changes** if the number is there and correct?

A deliverable that survives all three is worth building. One that fails question 2 is a
destination, and should be redesigned or dropped.

## Integration points by persona

Every agent in `../agents/` names its own. These are the recurring ones.

| Persona | The path | What lands there |
|---|---|---|
| **Engineering** | Pull request checks | Cost delta of an infrastructure change, before merge |
| | Architecture decision records | Cost per `ServiceCategory` as a first-class design constraint |
| | The rightsizing recommender they already run | Per-workload request/limit recommendations |
| | On-call runbook | Cost-anomaly triage steps alongside reliability steps |
| **Finance** | Month-end close workbook | Amortized, allocated actuals on `EffectiveCost` |
| | The existing forecast model | Driver-based cloud forecast with confidence intervals |
| **Procurement** | Renewal pipeline | License utilization ahead of the renewal date, not after |
| | Vendor scorecards | Commitment health, effective discount realized |
| **Product** | The product's own KPI dashboard | Cost per unit alongside the revenue and usage metrics |
| **Leadership** | The existing business review deck | Unit economics trend, not raw spend |
| **FinOps Practitioner** | Team-owned dashboards | Per-namespace / per-team allocation the team already opens |

## Design rules

1. **Reduce to a decision, not a dataset.** The path tolerates one number and one action. Ten
   numbers is a destination wearing a costume.
2. **Travel without infrastructure.** A self-contained artifact — a single HTML file, a Markdown
   comment, a message — reaches people who will never be provisioned access to a BI tool. This is
   why several agents in this pack emit standalone reports rather than dashboard definitions.
3. **Push, don't pull.** The system delivers; the human does not fetch.
4. **Meet the existing cadence.** Land in the close cycle, the sprint boundary, the renewal date,
   the review meeting. A weekly report with a monthly decision cycle is noise three weeks in four.
5. **Name the source.** Every artifact footer names the files, queries, or exports it came from.
   The first time a number is challenged — and it will be — traceability is what preserves the
   program's credibility.
6. **Alerts are the sharpest path and the easiest to ruin.** They interrupt, which is the point,
   and which is why precision beats coverage. A channel that gets muted has negative value: it
   consumed trust and now detects nothing.
7. **Carbon at the decision point beats carbon in a report.** Same rule, and the one most often
   violated, because sustainability reporting has a compliance-shaped pull toward destinations.

## Anti-patterns

- **The unopened dashboard.** Check the view count before building the second one.
- **The PDF attachment.** Not a path. Nobody has opened it since the third week.
- **"We'll train them to check it."** Enablement scales a habit that already has a hook; it does
  not manufacture one. See `../agents/finops-enablement-lead.md`.
- **Access-gated data.** If seeing the number requires a license, a role grant, or a VPN, the
  audience is whoever already had all three.
- **Precision that outruns the decision.** A number good to the penny, delivered two weeks after
  the decision, loses to a number good to 5% delivered before it.

## Related

- [`focus-essentials.md`](focus-essentials.md) — the conformed FOCUS table is itself a path: it is where every downstream tool reads the same numbers
- [`iron-triangle.md`](iron-triangle.md) — the trade-off has to travel with the number, in the same artifact
- [`crawl-walk-run.md`](crawl-walk-run.md) — early maturity means fewer, better-placed paths
