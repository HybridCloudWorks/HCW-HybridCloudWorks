# Month Length Illusion

> "Spend jumped 10% in March." No it didn't. March has 10.7% more days than February.

## Symptom

A month-over-month comparison shows a change that triggers an investigation, a budget alert, or an
executive question. Common shapes:

- February looks like a dramatic cost *reduction* — every year, in every organization.
- March looks like a spike of roughly the same magnitude, immediately after.
- A team celebrates an optimization that landed in February and appears to have saved 10%.
- A quarter-over-quarter comparison shifts because the quarters have 90, 91, and 92 days.

## Why it happens

Most cloud spend is usage-based and accrues per hour. A month is not a unit of consumption; it is
a unit of calendar. February has 28 days, March has 31 — **10.7% more billable hours** for
identical infrastructure running identically.

| Comparison | Day delta | Apparent change at flat usage |
|---|---|---|
| Jan (31) → Feb (28) | −3 | **−9.7%** |
| Feb (28) → Mar (31) | +3 | **+10.7%** |
| Apr (30) → May (31) | +1 | **+3.3%** |
| Q1 (90) → Q2 (91) | +1 | **+1.1%** |

A 10.7% swing is larger than most genuine optimizations and larger than most anomaly-detection
thresholds. It reliably generates false positives in March and false confidence in February — and
it is doubly dangerous because a *real* 10% cost increase in March is completely invisible when it
lands on top of the calendar effect.

## Detection

Normalize to a daily rate before comparing anything.

```sql
-- Daily run-rate, the only defensible month-over-month comparison
SELECT
    DATE_TRUNC('month', ChargePeriodStart)              AS billing_month,
    SUM(EffectiveCost)                                  AS total_cost,
    COUNT(DISTINCT DATE(ChargePeriodStart))             AS days_in_period,
    SUM(EffectiveCost)
      / COUNT(DISTINCT DATE(ChargePeriodStart))         AS daily_run_rate
FROM focus_costs
WHERE ChargeCategory = 'Usage'          -- exclude Purchase / Tax / Credit
GROUP BY 1
ORDER BY 1;
```

Compare `daily_run_rate`, never `total_cost`.

**Confirming the illusion:** if `total_cost` moved materially but `daily_run_rate` is flat within
~1%, the change is entirely calendar. Say so and close the investigation.

**The dangerous case:** `total_cost` up 11% and `daily_run_rate` up 4%. The calendar explains most
of it — and there is still a real 4% increase underneath that nobody would have found. Always
report the residual after normalizing, not just "it's the calendar."

Two refinements:

- Use `ChargeCategory = 'Usage'`. One-time `Purchase` rows do not scale with days and will distort
  the run rate. See [`masked-anomaly.md`](masked-anomaly.md) for what those rows can hide.
- The current month is partial. Never compare a month-to-date total against a complete prior
  month; compare run-rates, or compare same-day-of-month to same-day-of-month.

## Remediation

There is nothing to remediate in the infrastructure. The remediation is to the **reporting**:

1. **Make daily run-rate the default metric** on every trend view. Keep monthly totals for
   invoice reconciliation only, where the calendar is the correct basis.
2. **Retract cleanly** if an investigation was opened on the illusion. Report the normalized
   residual so the exercise still produces a finding.
3. **Re-baseline any optimization claimed on a February comparison.** It is probably overstated by
   roughly 10%.
4. **Fix the alert thresholds** that fired — see Prevention.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | No direct saving. Prevents wasted investigation cycles and stops overstated savings claims entering the record |
| **Speed** | Slightly more explanation required the first time a stakeholder sees a run-rate chart instead of a total |
| **Quality** | Materially better. Removes a recurring class of false positive and, more importantly, stops the calendar from hiding real increases |
| **Carbon** | None |

## Prevention

- **Daily run-rate on every trend dashboard**, with monthly totals available but not the default.
- **Anomaly detection operates on normalized rates**, not raw period totals. An anomaly detector
  that fires every March is training its audience to ignore it — see
  [`../doctrine/data-in-the-path.md`](../doctrine/data-in-the-path.md).
- **Forecasts project a daily rate × days-in-future-period**, never month × growth factor.
- **Chart annotations** naming days-in-period on any monthly-total view that survives.

## Related

- **Agents:** `cloud-billing-analyst`, `budget-anomaly-operator`, `forecast-estimation-analyst`
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — `ChargePeriod` vs `BillingPeriod`, and why `ChargeCategory` filtering matters
- **Playbook:** [`masked-anomaly.md`](masked-anomaly.md) — the other way a real spike hides in plain sight
