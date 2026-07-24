# Snapshot Sprawl

> Every snapshot had a good reason to be created. None of them has anyone responsible for deleting it.

## Symptom

- Block-storage spend grows steadily while provisioned volume capacity is flat.
- Snapshot count grows monotonically; the oldest is measured in years.
- Snapshots exist for volumes, instances, and entire accounts that were decommissioned long ago.
- A cleanup campaign runs, reclaims a large amount, and the line is back within twelve months.

## Why it happens

Snapshot creation is easy, cheap per unit, automated, and celebrated. Snapshot deletion is
manual, risky-feeling, and rewarded by nobody.

Four generators, in rough order of volume:

1. **Automated backup policies with no retention limit** — or with a retention limit applied to
   the schedule but not to snapshots created before the policy existed.
2. **Pre-change safety snapshots** — "taking a snapshot before the migration." The migration
   succeeded. The snapshot is still there, four years later.
3. **Orphaned lineage** — the source volume is deleted but its snapshots survive independently.
   This is the largest and least visible category, because nothing links the cost back to a
   resource anyone recognizes.
4. **Cross-region/account copies for DR** that were never included in any lifecycle policy.

The deletion problem is fundamentally an **ownership** problem, not a technical one. Nobody wants
to be the person who deleted the backup that turned out to be needed, and the incremental cost of
keeping one more is trivially small. The aggregate is not.

## Detection

Billing data alone tells you the size of the problem; deciding what is safe to delete requires
provider-native inventory. Do both.

```sql
-- Size the exposure: snapshot spend, and whether it is growing
SELECT
    DATE_TRUNC('month', ChargePeriodStart) AS month,
    SubAccountId,
    RegionId,
    SUM(EffectiveCost)                     AS snapshot_cost
FROM focus_costs
WHERE ServiceCategory = 'Storage'
  AND ChargeCategory  = 'Usage'
  AND LOWER(SkuMeter) LIKE '%snapshot%'   -- meter naming is provider-specific; verify
GROUP BY 1, 2, 3
ORDER BY month, snapshot_cost DESC;
```

Then, from provider inventory (this is **not** in the billing dataset):

| Signal | Meaning | Safety |
|---|---|---|
| Source volume no longer exists | Orphaned lineage | Highest-confidence deletion candidate |
| Age > retention policy for its tag/class | Policy violation | Safe once policy is confirmed |
| No restore ever performed, age > 1 year | Almost certainly dead | Safe with owner sign-off |
| Not referenced by any AMI / machine image | No hidden dependency | **Must check** — deleting a snapshot backing an image breaks instance launches |
| Untagged, owner unknown | Unattributable | Do not delete blind — see below |

**The mandatory safety check:** never delete a snapshot that backs a registered machine image, and
never delete based on age alone without confirming no dependency. The one time this goes wrong
costs more credibility than the entire campaign saves.

## Remediation

Order matters — do the safe, high-volume tier first to build trust before touching anything
ambiguous.

1. **Tier 1 — orphaned lineage.** Source volume deleted, not backing any image, older than the
   longest retention policy in the org. Delete with a notification, not an approval request.
2. **Tier 2 — policy violations.** Snapshots exceeding the documented retention for their class.
   Notify the owning team, delete after a stated grace period (14 days is typical).
3. **Tier 3 — unattributable.** Untagged, owner unknown. **Do not bulk-delete.** Move to a
   deletion-pending state or the cheapest archive tier, publish the list, and delete after a
   longer grace period (60–90 days). If something breaks, it breaks recoverably.
4. **Tier 4 — everything else.** Requires an owner decision. This tier should shrink to near zero
   once prevention is in place; if it does not, tagging is the actual problem — see
   [`untagged-spend-drift.md`](untagged-spend-drift.md).

Track reclaimed spend per tier so the next campaign can be justified — or, better, so it is never
needed again.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Direct and immediate on the storage line. Typically one of the largest single waste categories in a mature account |
| **Speed** | None ongoing. One-time engineering effort to build the inventory join and the lifecycle policy |
| **Quality** | **This is the real trade.** Recovery options narrow. Tier 1 and 2 carry near-zero risk if the image-dependency check is honoured; Tier 3 is where risk lives, which is why it gets a grace period rather than a delete |
| **Carbon** | Proportional reduction — stored data draws power continuously |

## Prevention

Campaigns treat the symptom. The fix is at creation time.

- **Tag-driven lifecycle** is the canonical pattern (Joe Daly — see
  [`../doctrine/fcp-anchors.md`](../doctrine/fcp-anchors.md)): every snapshot carries a retention
  tag written at creation, and an automated job enforces expiry from that tag. Retention becomes a
  declared property of the snapshot rather than a decision someone must remember to make later.
- **Deny creation of untagged snapshots** via policy-as-code. `warn` means `ignore` — see
  `../agents/allocation-policy-architect.md`.
- **Default retention on every backup policy.** Unlimited retention should not be expressible
  without an explicit, reviewed exception.
- **Cascade on volume deletion** — deleting a volume should surface, and ideally schedule, its
  dependent snapshots.
- **Monitor snapshot cost as a ratio to provisioned volume cost.** A rising ratio is the leading
  indicator, and it moves long before the absolute number gets anyone's attention.

## Related

- **Agents:** `idle-orphaned-resource-hunter`, `allocation-policy-architect`, `s3-storage-class-auditor`
- **Doctrine:** [`fcp-anchors.md`](../doctrine/fcp-anchors.md) — tag-driven lifecycle; the forgotten-environment story for the ownership argument
- **Doctrine:** [`iron-triangle.md`](../doctrine/iron-triangle.md) — recovery optionality is the currency being spent
- **Playbooks:** [`untagged-spend-drift.md`](untagged-spend-drift.md) · [`idle-load-balancer.md`](idle-load-balancer.md) · [`zombie-nat-gateway.md`](zombie-nat-gateway.md)
