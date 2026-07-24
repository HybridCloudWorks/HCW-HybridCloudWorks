# Idle Load Balancer

> Load balancers bill by the hour whether or not anything is behind them.

## Symptom

- A steady, unremarkable hourly charge that has never been questioned because no single instance
  of it is large.
- Load balancers in non-production accounts outnumbering the services those accounts run.
- Networking spend that does not move when application traffic moves.
- Load balancers whose target groups are empty, or whose targets are all unhealthy — and have been
  for months.

## Why it happens

A load balancer has an **hourly charge that is independent of traffic**. Zero requests does not
mean zero cost. This is the property that makes them accumulate:

1. **The service behind it was decommissioned**; the instances were terminated because they were
   the visible, obviously-expensive thing. The load balancer was not, and survived.
2. **Blue/green and canary deployments** that provision a second load balancer and never
   deprovision it after the cutover.
3. **Environments per branch or per developer** created by automation that creates but does not
   destroy.
4. **"We'll need it again next quarter."** Sometimes true. Usually not, and never revisited.

Individually each one is small enough to stay below anyone's attention threshold. Collectively, in
an estate with dozens of accounts, it is a material and entirely recoverable line.

## Detection

The billing dataset shows the cost; the *idleness* signal is provider-native and must be joined in.

```sql
-- Load balancer spend by account and region, ranked
SELECT
    SubAccountId,
    RegionId,
    ResourceId,
    ResourceName,
    SUM(EffectiveCost)                          AS lb_cost,
    MIN(ChargePeriodStart)                      AS first_seen,
    MAX(ChargePeriodStart)                      AS last_seen
FROM focus_costs
WHERE ServiceCategory = 'Networking'
  AND ChargeCategory  = 'Usage'
  AND LOWER(SkuMeter) LIKE '%load balancer%'   -- meter naming is provider-specific; verify
GROUP BY 1, 2, 3, 4
ORDER BY lb_cost DESC;
```

Then join provider-native signals. **The billing data cannot tell you a load balancer is idle** —
an idle one and a busy one with the same hourly charge look identical until you add:

| Signal | Source | Confidence that it is dead |
|---|---|---|
| Zero registered targets | Inventory API | Very high |
| Registered targets, all unhealthy for > 30 days | Health checks | Very high |
| Zero processed bytes / request count over 30 days | Provider metrics | High |
| No data-processing charges, only hourly charges | **Billing** — `SkuMeter` split | High, and available without inventory access |
| No DNS record resolves to it | DNS zone | Corroborating |

The fourth row is worth emphasising: a load balancer with hourly charges but **no
data-processing meter charges at all** is carrying no traffic, and that is visible in FOCUS data
alone via `SkuMeter`. It is the fastest first pass when you have billing access but not yet
inventory access.

## Remediation

1. **Confirm zero traffic over a full business cycle** — at least 30 days, and long enough to
   cover any monthly or quarterly batch process. A load balancer fronting a month-end job is idle
   for 29 days and essential on the 30th.
2. **Check DNS and client configuration** before deleting. An endpoint referenced by a hardcoded
   client somewhere will fail loudly and at the worst time.
3. **Notify the owning team** via the allocation key. If there is no owner, that is the finding —
   see [`untagged-spend-drift.md`](untagged-spend-drift.md).
4. **Disable before deleting.** Remove targets or take it out of DNS rotation, wait a grace period,
   then delete. Deletion is irreversible and the endpoint address is not recoverable.
5. **Capture the configuration** (as IaC, ideally) before deletion so recreation is cheap if the
   call was wrong. This is what makes the grace period honest rather than theatrical.

## Iron Triangle

| Dimension | Effect |
|---|---|
| **Cost** | Direct, immediate, recurring. Small per unit, meaningful in aggregate |
| **Speed** | If it is genuinely needed again, recreation takes minutes — but DNS propagation and endpoint re-registration take longer, and a changed endpoint address may require client changes |
| **Quality** | Real risk if the traffic analysis window was too short. The 30-day-plus-business-cycle rule exists precisely to protect against this |
| **Carbon** | Minor but real — idle managed infrastructure still consumes capacity |

## Prevention

- **Own the load balancer with the service.** Define it in the same IaC module as the workload it
  fronts, so `destroy` removes both. This eliminates the largest generator outright.
- **TTL tags on ephemeral environments.** Per-branch and per-developer environments get an
  expiry tag at creation and are reaped automatically.
- **Automated idle detection on a schedule** — zero targets or zero traffic for 30 days raises a
  ticket to the owning team, routed by allocation key rather than to a central queue.
- **Deployment automation must deprovision.** A blue/green pipeline that creates a load balancer
  and does not delete the retired one is the bug; fix the pipeline rather than sweeping up after it.

## Related

- **Agents:** `idle-orphaned-resource-hunter`, `platform-sre-cost-lead`, `allocation-policy-architect`
- **Doctrine:** [`focus-essentials.md`](../doctrine/focus-essentials.md) — `SkuMeter` separates hourly charges from data-processing charges, which is the whole detection trick here
- **Playbooks:** [`zombie-nat-gateway.md`](zombie-nat-gateway.md) — same hourly-charge dynamic · [`snapshot-sprawl.md`](snapshot-sprawl.md) · [`untagged-spend-drift.md`](untagged-spend-drift.md)
