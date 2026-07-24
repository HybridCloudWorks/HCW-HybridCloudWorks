# Masked Anomaly

> A real cost spike and a commitment purchase land in the same period. They cancel. Nobody sees either.

## Symptom

- Total spend looks flat or slightly down, and no alert fires — but a team later discovers a
  workload has been misconfigured and burning money for weeks.
- A month with a large reservation or savings-plan purchase shows a *smaller* net change than
  expected, and nobody investigates a number that moved in the right direction.
- Anomaly detection has a conspicuous gap around commitment purchase dates.
- Two teams' costs moved in opposite directions and the aggregate hid both.

## Why it happens

Anomaly detection almost always runs on **aggregate spend**. Aggregates cancel.

A commitment purchase creates a large, legitimate, *expected* movement in the cost series. On
`BilledCost` a prepaid purchase is a one-time spike; on `EffectiveCost` a new commitment
immediately *reduces* the effective rate on covered usage. Either way the series moves for a
known reason — and a genuine anomaly landing in the same window disappears into it.

The failure has three compounding parts:

1. **Detection runs on the total**, so opposing movements net out.
2. **The known event provides a ready explanation.** An analyst who sees a movement and knows a
   commitment was purchased stops investigating. The explanation is true for *part* of the
   movement, which is what makes it convincing.
3. **Nobody alerts on things getting cheaper.** A 15% drop from a new commitment masking a 12%
   increase from a runaway workload nets to −3%, and no detector on earth fires on that.

This generalizes beyond commitments. Any large known movement masks anomalies in the same window:
a workload migration, a region shutdown, a credit applied, a large one-time `Purchase` row.

## Detection

**Rule one: detect on decomposed series, not the total.**

```sql
-- Separate the commitment effect from underlying usage before looking for anomalies
SELECT
    DATE(ChargePeriodStart)                                   AS usage_date,
    SUM(CASE WHEN ChargeCategory = 'Purchase'
             THEN EffectiveCost ELSE 0 END)                   AS commitment_purchases,
    SUM(CASE WHEN ChargeCategory = 'Usage'
              AND PricingCategory = 'Committed'
             THEN EffectiveCost ELSE 0 END)                   AS committed_usage,
    SUM(CASE WHEN ChargeCategory = 'Usage'
              AND PricingCategory = 'On-Demand'
             THEN EffectiveCost ELSE 0 END)                   AS ondemand_usage,
    -- the series that actually matters: what are we consuming, rate-independent
    SUM(CASE WHEN ChargeCategory = 'Usage'
             THEN ListCost ELSE 0 END)                        AS usage_at_list
FROM focus_costs
GROUP BY 1
ORDER BY 1;
```

**`ListCost` on `ChargeCategory = 'Usage'` is the masking-immune series.** It measures consumption
at public rates, so it is unaffected by commitment purchases, discount changes, and credits
entirely. If `usage_at_list` jumps while `EffectiveCost` stays flat, a commitment is masking a
real usage increase — and that is precisely the case you would otherwise never find.

**Rule two: detect at a grain where things cannot cancel.**

Run detection per `SubAccountId`, per `ServiceCategory`, and per allocation key — not only on the
total. Two teams moving in opposite directions cancel at the top and are both visible one level
down.

**Rule three: alert on unexplained *decreases* too.** A drop nobody can explain is either a
masked increase somewhere else, a data pipeline failure, or a workload that stopped working.
All three are worth knowing about.

**Confirming the pattern:** annotate the cost series with commitment purchase dates
(`ChargeCategory = 'Purchase'`, and `CommitmentDiscountId` first-seen dates). Any anomaly window
overlapping an annotation is suspect and needs the `ListCost` check before being dismissed.

## Remediation

1. **Re-run detection on the decomposed series** for the affected window, at
   `SubAccountId` and `ServiceCategory` grain.
2. **Compare `usage_at_list` against its own trend**, ignoring `EffectiveCost` entirely.
3. **Attribute anything found** to a resource via `ResourceId`, then to a team via the allocation
   key.
4. **Quantify from the anomaly's actual start**, not from the date it was discovered. The masked
   period is usually the majority of the total impact and is the number that justifies fixing the
   detection.
5. **Check the commitment itself.** A purchase made during an inflated-usage window may be sized
   against demand that was never real — see `commitment-discount-strategist`.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Recovers the full masked period rather than only the post-discovery tail. Frequently the largest single find in an anomaly program's first year |
| **Speed** | Decomposed detection is more queries and more series to maintain |
| **Quality** | More alerts, and therefore a real precision risk — tune per-series thresholds or the extra channels get muted, which is worse than not having them |
| **Carbon** | Masked over-consumption is usually real compute burning real power; finding it reduces both |

## Prevention

- **Never run anomaly detection on `EffectiveCost` alone.** Pair it with a `ListCost`-on-`Usage`
  series that no discounting can move.
- **Detect at allocation-key grain** as the default, with the aggregate as a secondary view.
- **Maintain a change calendar** — commitment purchases, migrations, credits, region changes — and
  annotate every cost chart with it. Known events should be *visible*, not *assumed*.
- **Treat a known explanation as a hypothesis, not a conclusion.** Quantify how much of the
  movement the known event explains. If it explains 80%, investigate the other 20%.
- **Alert on unexplained decreases.**

## Related

- **Agents:** `budget-anomaly-operator`, `commitment-discount-strategist`, `cloud-billing-analyst`
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — `ChargeCategory`, `PricingCategory`, and the `ListCost`/`ContractedCost`/`EffectiveCost` decomposition
- **Doctrine:** [`data-in-the-path.md`](../doctrine/data-in-the-path.md) — precision over coverage; a muted alert channel detects nothing
- **Playbook:** [`month-length-illusion.md`](month-length-illusion.md) — the other reason a period comparison lies
