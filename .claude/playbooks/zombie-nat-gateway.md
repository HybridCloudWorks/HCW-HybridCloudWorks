# Zombie NAT Gateway

> The workload that needed it is gone. The gateway is still billing, in every AZ, forever.

## Symptom

- A flat, persistent networking charge in accounts that run nothing.
- NAT gateway count exceeding the number of active private subnets that need egress.
- Networking spend that does not correlate with application traffic.
- Multiple gateways in one VPC, one per availability zone, where the workload has shrunk to a
  single zone.

## Why it happens

NAT gateways combine the two properties that guarantee accumulation: **an hourly charge
independent of traffic**, plus **a per-GB processing charge** on everything that passes through.
Zero traffic still bills the hourly rate.

Generators:

1. **Network scaffolding outlives the workload.** VPCs are created by a landing-zone or
   networking module, workloads are created separately, and the workload's lifecycle does not own
   the network's. The application is deleted; the VPC and its gateways are not.
2. **Multi-AZ by default.** High-availability templates provision one gateway per AZ. Correct for
   production; expensive and usually unnecessary for the dev and test environments that inherited
   the same template.
3. **Nobody owns a VPC.** Networking is shared infrastructure, so it has no team-level allocation
   key, so no team sees the cost, so nobody questions it.
4. **Fear of deletion.** Networking changes feel high-blast-radius, so an unused gateway stays
   indefinitely rather than being removed.

The multi-AZ default is worth singling out: three gateways in a non-production VPC cost three
times what one costs, provide availability guarantees that non-production does not need, and are
invisible because they were never a decision anyone consciously made.

## Detection

```sql
-- NAT gateway spend, split into hourly vs data-processing meters
SELECT
    SubAccountId,
    RegionId,
    ResourceId,
    SUM(CASE WHEN LOWER(SkuMeter) LIKE '%hour%'
             THEN EffectiveCost ELSE 0 END)  AS hourly_cost,
    SUM(CASE WHEN LOWER(SkuMeter) LIKE '%byte%'
                  OR LOWER(SkuMeter) LIKE '%gb%'
             THEN EffectiveCost ELSE 0 END)  AS data_processing_cost,
    SUM(EffectiveCost)                       AS total_cost
FROM focus_costs
WHERE ServiceCategory = 'Networking'
  AND ChargeCategory  = 'Usage'
  AND LOWER(SkuMeter) LIKE '%nat%'          -- meter naming is provider-specific; verify
GROUP BY 1, 2, 3
HAVING SUM(EffectiveCost) > 0
ORDER BY total_cost DESC;
```

**The zombie signature is `hourly_cost > 0` with `data_processing_cost ≈ 0`.** No bytes processed
means nothing is egressing through it. This is fully determinable from FOCUS data without
inventory access, which makes it one of the cleanest waste findings available.

Corroborate before acting:

| Signal | Source | Meaning |
|---|---|---|
| Zero data processing over 30+ days | **Billing** | Nothing is using it |
| No route table references it | Inventory | Structurally orphaned — highest confidence |
| Private subnets in the VPC have no running instances | Inventory | The workload is gone |
| Gateway count > active AZ count for the workload | Inventory | Over-provisioned rather than dead |

The last row is a different finding with a different fix: consolidation rather than deletion.

## Remediation

Separate the two cases — they carry very different risk.

**Case A — genuinely orphaned** (no route table reference, no traffic, no running instances):

1. Confirm no route table in any VPC references the gateway.
2. Confirm 30+ days of zero data processing, covering any monthly batch cycle.
3. Delete the gateway, then release the associated elastic/static IP — **the IP bills separately
   when unattached and is routinely left behind**, converting one zombie into another.

**Case B — over-provisioned multi-AZ in non-production** (traffic exists, but across more
gateways than needed):

1. Confirm the environment's actual availability requirement. Non-production rarely justifies
   per-AZ redundancy.
2. Consolidate to a single gateway and repoint the other AZs' route tables to it.
3. **Accept the trade explicitly**: cross-AZ traffic to reach the single gateway now incurs
   inter-zone data transfer charges, and an AZ failure takes egress with it. For dev and test this
   is almost always the right call — but it must be a stated decision, and the cross-AZ cost must
   be modelled, or you have simply moved the charge. See
   [`cross-az-chatterbox.md`](cross-az-chatterbox.md).

For both cases: notify the owning team first, and if the VPC has no owner, that is the finding.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Direct and recurring. Both the hourly charge and the stranded static IP |
| **Speed** | Recreation is fast, but re-establishing routing and any allow-listed egress IP is not — downstream partners may have allow-listed the address |
| **Quality** | Case A: near zero risk when route tables are confirmed unreferenced. Case B: a real availability reduction, which is the point of making it an explicit decision rather than a silent optimization |
| **Carbon** | Minor; managed idle infrastructure still consumes capacity |

## Prevention

- **Tie network scaffolding to workload lifecycle.** If a VPC exists only for one workload, they
  belong in the same IaC module so `destroy` takes both.
- **Environment-tiered network templates.** Production gets per-AZ redundancy; dev and test get a
  single gateway by default. Make redundancy an opt-in with a stated reason rather than the
  inherited default.
- **Consider egress alternatives.** Private endpoints, gateway endpoints, or an egress-free
  architecture can remove the need entirely for workloads whose egress is mostly to provider
  services — that is the structural fix, not an optimization of the wrong thing.
- **Allocate networking cost.** A VPC with no owner accumulates zombies indefinitely. Attribute it
  to the consuming teams — see `showback-chargeback-architect`.
- **Scheduled detection** on the `hourly > 0, processing ≈ 0` signature. It is a cheap query and it
  never produces a false positive worth ignoring.

## Related

- **Agents:** `idle-orphaned-resource-hunter`, `cross-az-egress-investigator`, `platform-sre-cost-lead`
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — `SkuMeter` splitting is the detection mechanism
- **Doctrine:** [`iron-triangle.md`](../doctrine/iron-triangle.md) — Case B trades availability for cost and must say so
- **Playbooks:** [`idle-load-balancer.md`](idle-load-balancer.md) · [`cross-az-chatterbox.md`](cross-az-chatterbox.md)
