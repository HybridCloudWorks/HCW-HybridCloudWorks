# The Iron Triangle

> Every cost recommendation trades against speed, quality, and carbon.
> State the trade-off explicitly, or the recommendation gets rejected on second-order effects.

## The principle

There is no such thing as a free saving. Cloud cost is one corner of a system that also has
**speed** (latency, throughput, delivery velocity), **quality** (reliability, durability, blast
radius), and **carbon** (emissions per unit of work). Pull the cost corner and at least one other
corner moves.

Cost optimization work fails in a predictable way: an analyst presents a number, an engineer
identifies the unstated cost in reliability or delivery speed, and the recommendation dies —
along with the analyst's credibility for the next three recommendations. The number was usually
correct. The framing was incomplete.

**Never present a savings number without the "what it costs you" side.**

## The four dimensions

| Dimension | Question it answers | Typical unit |
|---|---|---|
| **Cost** | What do we stop paying? | currency / month, or % of the affected service line |
| **Speed** | What gets slower — for users, or for the team shipping? | p50/p99 latency, retrieval time, deploy frequency, lead time |
| **Quality** | What gets less reliable, less durable, or blast-radius wider? | availability target, RPO/RTO, error budget, headroom |
| **Carbon** | What happens to emissions per unit of work? | gCO2e / request, or total tCO2e / month |

Carbon is the fourth dimension and is frequently *aligned* with cost rather than opposed to it —
idle capacity burns both. Track it explicitly anyway, because the cases where it diverges
(a lower-cost region with a dirtier grid) are exactly the cases where a silent assumption does
damage.

## The required output shape

Every agent closes with a table in this form. It is deliberately small — the discipline is in
filling all four rows honestly, not in writing an essay.

```markdown
## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | −$18K/mo on the storage line; one-time $2K retrieval to reclassify |
| **Speed** | Restore goes from seconds to 3–5 hours for anything older than 90 days |
| **Quality** | Durability unchanged; recovery *time* objective degrades — needs RTO sign-off |
| **Carbon** | Net reduction; cold tiers draw materially less power per TB stored |
```

Rules for filling it in:

- **"None" is a legitimate entry, but it must be earned.** Deleting a confirmed-orphaned volume
  with no attachment history genuinely has no speed or quality cost. Say so plainly. Reflexively
  writing "None" in all three non-cost rows is the tell that the analysis was not done.
- **Name who has to accept the trade.** "Needs RTO sign-off" is actionable; "some latency
  impact" is not.
- **Quantify at least one non-cost row.** If every trade-off is qualitative and only the savings
  is numeric, the reader will discount the qualitative side to zero.

## Worked applications

These are the recurring shapes. Each corresponds to agents in `../agents/`.

| Decision | Cost | Trade against |
|---|---|---|
| Commitment term length (1yr vs 3yr) | Deeper discount at 3yr | **Speed**: architectural optionality is frozen for the term. A 3-year commitment on an instance family is a bet that you will not re-platform. |
| Rightsizing compute | Direct, immediate | **Quality**: safety margin is the thing you are selling. Quantify headroom left, not just headroom removed. |
| Container consolidation / bin-packing | Fewer nodes | **Quality**: pod stability and eviction rate. **Speed**: scheduling latency when the cluster is tight. |
| Spot / preemptible adoption | 60–90% off on-demand | **Quality**: interruption tolerance must actually exist in the workload. **Speed**: replacement capacity acquisition time. |
| Storage class migration to archive | Large, on the storage line | **Speed**: retrieval latency moves from milliseconds to hours. This is the whole trade. |
| Batch instead of streaming ingestion | Materially cheaper pipeline | **Speed**: detection latency. Only pay for streaming when time-to-detect is the measured bottleneck. |
| Tag policy `deny` instead of `warn` | Enables all downstream allocation | **Speed**: resource creation friction on day one. Buys reporting trust permanently. (`warn` means `ignore` — see `../agents/allocation-policy-architect.md`.) |
| Chargeback instead of showback | Real accountability | **Speed**: significant engineering and finance effort. **Quality**: rolled out before showback earns trust, it gets rejected — see `crawl-walk-run.md`. |
| More alerts / tighter thresholds | Faster anomaly detection | **Quality**: attention is the scarce resource. Precision beats coverage; a muted channel detects nothing. |
| Multi-region for availability | Cost multiplies | **Quality**: this is the one case where the trade runs the other way. Make the reliability-cost curve explicit rather than treating nines as free. |

## Framing the conversation

When a stakeholder resists a trade-off, the useful move is to make the choice concrete rather
than arguing the number. Gabe Hege's **Porsche-vs-Toyota** framing (see
[`fcp-anchors.md`](fcp-anchors.md)) works because it reframes "is this too expensive?" —
unanswerable — into "which one are we buying, and is that what we meant to buy?" Both are
legitimate purchases. The failure is buying a Porsche while believing you bought a Toyota.

## Anti-patterns

- **Savings theater.** A headline number with no denominator, no trade-off, and no owner.
- **Trade-offs discovered in review.** If an engineer surfaces the reliability cost before you
  do, the recommendation is already dead. Surface it first; you keep control of the framing.
- **Treating carbon as a reporting obligation.** Carbon at the decision point changes decisions.
  Carbon in a quarterly report changes nothing — see [`data-in-the-path.md`](data-in-the-path.md).
- **Optimizing a corner nobody is complaining about.** If speed is the binding constraint for the
  business right now, a recommendation that trades speed for cost is a bad recommendation even
  when the math is right.

## Related

- [`focus-essentials.md`](focus-essentials.md) — get the cost number right before you trade against it
- [`crawl-walk-run.md`](crawl-walk-run.md) — trade-offs an org cannot yet absorb are not available to you
- [`fcp-anchors.md`](fcp-anchors.md) — named framings that carry weight with stakeholders
