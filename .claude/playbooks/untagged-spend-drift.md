# Untagged Spend Drift

> Tag coverage does not decay because people forget. It decays because creation is ungoverned and cleanup is manual.

## Symptom

- A material share of spend cannot be attributed to any team, product, or environment.
- A tagging campaign lifts coverage sharply, and it erodes back within two or three quarters.
- Coverage looks healthy by resource count and poor by cost — the untagged resources are the big
  ones.
- Chargeback and unit-economics work is blocked, and every attempt restarts the tagging
  conversation from the beginning.

## Why it happens

The arithmetic is unforgiving. Tag coverage is a **stock** depleted by a continuous **flow** of
new untagged resources. Manual cleanup campaigns adjust the stock once. The flow continues.

If 8% of newly created resources are untagged and the estate turns over meaningfully each year,
any campaign's gains are gone within a few quarters — reliably, regardless of how well the
campaign was run.

Compounding causes:

1. **Policy in `warn` mode indefinitely.** A warning that never blocks anything is a warning
   nobody reads. **`warn` means `ignore`.** Audit mode is a legitimate *phase* for measuring the
   violation rate; left running permanently, it is theatre.
2. **Tags are finalized at charge time.** Retagging a resource today does **not** fix last month's
   billing rows. Historical spend stays unattributable forever. This surprises nearly every team
   starting allocation work and it is the reason cleanup alone can never be the strategy.
3. **Coverage measured by resource count, not cost.** 95% of resources tagged can be 60% of spend
   untagged. Count-based metrics let a program declare victory while the actual problem is
   untouched.
4. **No taxonomy, or a taxonomy nobody agreed to.** Free-text values produce `team: platform`,
   `Team: Platform`, and `team: platform-eng` as three distinct values — coverage looks fine and
   allocation still fails.
5. **Resources created outside IaC.** Console-created and script-created resources bypass whatever
   tagging the modules enforce.

## Detection

**Always measure coverage by cost.**

```sql
-- Untagged share of spend, by service category and account
SELECT
    ServiceCategory,
    SubAccountId,
    SUM(EffectiveCost)                                          AS total_cost,
    SUM(CASE WHEN JSON_VALUE(Tags, '$.owner') IS NULL
             THEN EffectiveCost ELSE 0 END)                     AS untagged_cost,
    ROUND(100.0 * SUM(CASE WHEN JSON_VALUE(Tags, '$.owner') IS NULL
                           THEN EffectiveCost ELSE 0 END)
          / NULLIF(SUM(EffectiveCost), 0), 1)                   AS untagged_pct
FROM focus_costs
WHERE ChargeCategory = 'Usage'
GROUP BY 1, 2
ORDER BY untagged_cost DESC;
```

Two further measurements that matter more than the headline number:

- **The flow, not the stock.** Untagged share of *newly created* resources, measured monthly. This
  is the leading indicator; total coverage is a lagging one. If the flow is not near zero, no
  campaign will hold.
- **Value normalization.** Distinct values per tag key. A key with 340 distinct values for 25
  teams is not a working allocation key regardless of its coverage.

Some charges legitimately have no `ResourceId` and therefore no tags — shared and tenant-level
charges. Exclude them explicitly and report them as a separate "structurally unattributable"
bucket rather than letting them depress the coverage metric.

## Remediation

Fix the flow first. A campaign run before enforcement is committed work that will be undone.

1. **Agree the taxonomy.** A small mandatory set — owner, environment, cost-center, application —
   with **enumerated allowed values**, not free text. Four enforced keys beat twelve aspirational
   ones.
2. **Enforce at creation.** Policy-as-code in `deny` mode on new resources, rolled out by
   resource type in descending order of spend. Start with the two or three types carrying most of
   the untagged cost; that is where the coverage is won.
3. **Announce the deny date and hold it.** Run in audit mode long enough to measure the violation
   rate and let teams fix their modules — then actually flip it. A deny date that slips twice
   will never happen.
4. **Provide the paved path before enforcing.** Shared IaC modules that apply mandatory tags
   automatically, so compliance is the default rather than extra work. Enforcing without this is
   how the FinOps function becomes the team that blocks deployments — see Rich Hoyer's framing in
   [`../doctrine/fcp-anchors.md`](../doctrine/fcp-anchors.md).
5. **Then run the backfill campaign**, top-down by cost. Accept that historical billing rows stay
   unattributable; tag going forward and use `SubAccountId` for historical allocation.
6. **Publish a coverage-by-cost dashboard per team**, in the team's own space. Peer visibility is
   more effective than a central scold — see
   [`../doctrine/data-in-the-path.md`](../doctrine/data-in-the-path.md).

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | No direct saving. It is the **prerequisite** for chargeback, unit economics, benchmarking, and team accountability — every one of which is blocked without it |
| **Speed** | Real friction at resource creation on day one. This is the actual price, and it is paid once per team rather than continuously |
| **Quality** | Reporting trust improves permanently. Allocation stops being disputable |
| **Carbon** | Indirect: unattributable resources are also un-rightsized and un-decommissioned |

## Prevention

- **`deny`, not `warn`.** The whole pattern reduces to this.
- **Mandatory tags in shared IaC modules**, so the default path is compliant.
- **Console creation restricted** in production accounts.
- **Coverage-by-cost as a standing KPI**, with the new-resource flow tracked alongside it.
- **Enumerated tag values** validated by policy, not conventions in a wiki.
- **Automated resources need it too** — CI/CD, autoscaling, and operators must propagate tags, and
  they are a frequent silent source of untagged spend.

## Related

- **Agents:** `allocation-policy-architect`, `showback-chargeback-architect`, `finops-practice-lead`
- **Doctrine:** [`crawl-walk-run.md`](../doctrine/crawl-walk-run.md) — allocation precedes almost everything; measurement precedes enforcement
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — `Tags` as JSON, finalized inheritance, coverage by cost
- **Playbooks:** [`chargeback-revolt.md`](chargeback-revolt.md) — what happens when chargeback is attempted on this foundation · [`snapshot-sprawl.md`](snapshot-sprawl.md)
