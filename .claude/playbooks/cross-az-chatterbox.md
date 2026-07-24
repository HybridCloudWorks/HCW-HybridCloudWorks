# Cross-AZ Chatterbox

> "Cross-AZ" on the bill means "I wish I knew which service."

## Symptom

- A large, growing inter-zone data transfer line with no attribution to any workload.
- Data transfer cost growing faster than compute — often much faster.
- The charge appears at account or VPC level with no `ResourceId`, so no team owns it.
- Nobody can name a service responsible, and every team assumes it is someone else's.

## Why it happens

Availability-zone redundancy is the correct default for production, and the cloud charges for
traffic that crosses zone boundaries. The cost is a direct consequence of a good architectural
decision — which is why it is rarely questioned, and why it grows unchecked.

The mechanisms that generate real volume:

1. **Zone-oblivious service meshes and load balancing.** Requests are distributed evenly across
   all replicas regardless of zone. With three zones, roughly **two-thirds of all internal
   requests cross a zone boundary** by default. Every hop in a microservice call chain multiplies
   this.
2. **Chatty microservices.** A request path with ten internal hops incurs the cross-zone
   probability ten times. Architecture that looks clean on a diagram is expensive in a
   multi-zone deployment.
3. **Replicated data stores.** Databases, caches, and streaming platforms replicating across zones
   for durability generate continuous background traffic proportional to write volume.
4. **Storage and logging pipelines** shipping high-volume telemetry to a collector in one zone.

The attribution problem is what makes this hard: **the billing record frequently has no
`ResourceId`**, because the charge is levied at the VPC or account level. The cost is real,
material, and structurally unattributable from billing data alone.

## Detection

Size it from billing; attribute it from network telemetry. Both steps are necessary — billing
alone will never tell you which service is responsible.

```sql
-- Size the exposure and its trend relative to compute
SELECT
    DATE_TRUNC('month', ChargePeriodStart)  AS month,
    SubAccountId,
    RegionId,
    SUM(EffectiveCost)                      AS cross_az_cost
FROM focus_costs
WHERE ServiceCategory = 'Networking'
  AND ChargeCategory  = 'Usage'
  AND (LOWER(SkuMeter) LIKE '%inter%availability%zone%'
    OR LOWER(SkuMeter) LIKE '%cross%az%'
    OR LOWER(SkuMeter) LIKE '%intra%region%')   -- naming varies by provider; verify
GROUP BY 1, 2, 3
ORDER BY month, cross_az_cost DESC;
```

Track it as a **ratio to compute spend in the same account**. The absolute number is hard to
judge; a ratio that is rising is unambiguous.

For attribution you need flow-level telemetry — this is the step teams skip, and it is the only
step that produces an actionable answer:

| Source | What it gives you |
|---|---|
| VPC flow logs | Source/destination IP and byte counts; join to instance/pod inventory and zone to get service-pair volumes |
| Service mesh telemetry | Request volume by service pair and zone — the cleanest signal if a mesh is deployed |
| Container platform metrics | Pod-to-pod traffic with zone labels |
| Managed data store metrics | Replication traffic volume, usually separable from client traffic |

The deliverable is a ranked table of **service pairs by cross-zone bytes**. Almost always a very
small number of pairs account for most of the volume, which is what makes the fix tractable.

## Remediation

Ordered by effort. The first option resolves most cases.

1. **Zone-aware routing.** Configure the mesh or load balancer to prefer same-zone endpoints,
   falling back cross-zone only when no healthy local endpoint exists. This is a configuration
   change, not an architecture change, and it typically removes the majority of the volume while
   preserving the failover behaviour that justified multi-zone in the first place.
2. **Co-locate chatty pairs.** For the top service pairs, schedule them into the same zone using
   topology constraints or affinity rules. Zone-spread is still maintained at the *pair* level.
3. **Reduce the traffic itself.** Caching, batching, and payload compression cut cost and latency
   together — the rare case where the Iron Triangle points the same way on both axes.
4. **Re-examine replication topology.** Confirm the durability requirement genuinely needs
   cross-zone replication for *this* data. Some caches and derived data stores do not.
5. **Consolidate zones in non-production.** Dev and test rarely need multi-zone at all; a
   single-zone deployment removes the charge entirely.

**The trap to avoid:** naive same-zone pinning that removes the redundancy the multi-zone
deployment exists to provide. Zone-aware routing with cross-zone fallback preserves availability;
hard affinity does not. Get this distinction right or the first zone failure will make the saving
very expensive.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Often large and fast-growing. Zone-aware routing alone commonly removes the majority of it |
| **Speed** | **Improves.** Same-zone calls have lower latency than cross-zone. This is the unusual case where cost and speed align |
| **Quality** | The real risk. Zone-aware routing with proper fallback is availability-neutral; hard affinity or zone consolidation reduces resilience and requires an explicit decision with the service owner |
| **Carbon** | Minor reduction — less network transit work per request |

## Prevention

- **Zone-aware routing as the platform default**, configured once in the mesh or ingress layer
  rather than per service. This is the single highest-leverage control.
- **Make data transfer visible in architecture review.** Network cost is invisible on an
  architecture diagram, which is why it never enters the design conversation — surface it in the
  ADR template. See `platform-sre-cost-lead`.
- **Allocate the cost to consuming teams**, even approximately, using flow-log-derived shares.
  Unattributed cost is unmanaged cost by definition.
- **Alert on the cross-AZ-to-compute ratio**, not the absolute figure.
- **Single-zone non-production by default.**

## Related

- **Agents:** `cross-az-egress-investigator`, `platform-sre-cost-lead`, `kubernetes-finops-engineer`
- **Doctrine:** [`iron-triangle.md`](../doctrine/iron-triangle.md) — availability is the currency; cost and latency move together here
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — why `ResourceId` is frequently null on these rows
- **Playbook:** [`zombie-nat-gateway.md`](zombie-nat-gateway.md) — gateway consolidation shifts cost into this pattern
