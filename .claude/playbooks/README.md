# Playbooks

Named failure patterns. Each one is a trap that has cost real organizations real money — most of
them repeatedly, because the symptom looks like something else.

Naming a pattern is the point. "The numbers went up in March" starts an investigation from
nothing; "this looks like the month-length illusion" starts it from a hypothesis with a known
test. Agents reference these by name so a diagnosis can be communicated in one phrase.

## The catalogue

### Analytical traps — the number is wrong, or means something else

| Playbook | The trap |
|---|---|
| [`month-length-illusion.md`](month-length-illusion.md) | A month-over-month change that is really a calendar artifact |
| [`masked-anomaly.md`](masked-anomaly.md) | A genuine cost spike hidden by a concurrent commitment purchase |

### Waste patterns — resources nobody owns

| Playbook | The trap |
|---|---|
| [`snapshot-sprawl.md`](snapshot-sprawl.md) | Backup snapshots accumulating forever because deletion has no owner |
| [`idle-load-balancer.md`](idle-load-balancer.md) | Load balancers billed hourly with no healthy targets behind them |
| [`zombie-nat-gateway.md`](zombie-nat-gateway.md) | NAT gateways surviving the workload that justified them |
| [`cross-az-chatterbox.md`](cross-az-chatterbox.md) | Inter-zone data transfer charges with no service attribution |

### Program patterns — the organization rejects the work

| Playbook | The trap |
|---|---|
| [`untagged-spend-drift.md`](untagged-spend-drift.md) | Tag coverage decaying because cleanup is manual and creation is not governed |
| [`chargeback-revolt.md`](chargeback-revolt.md) | Chargeback rejected by teams because it skipped showback |
| [`focus-adoption-parallel-run.md`](focus-adoption-parallel-run.md) | A FOCUS cutover with no reconciliation period |

## Template

Every playbook follows the same shape, so an agent can jump straight to the section it needs:

1. **Symptom** — what someone reports, in their words
2. **Why it happens** — the mechanism
3. **Detection** — the FOCUS query or signal that confirms or rules it out
4. **Remediation** — ordered, with the safety check that prevents an outage
5. **Iron Triangle** — what the fix trades against
6. **Prevention** — how to stop it recurring, which is usually a control at creation time
7. **Related** — agents, doctrine, adjacent playbooks

Queries are written against FOCUS columns (see
[`../doctrine/focus-essentials.md`](../doctrine/focus-essentials.md)) so they port across
providers. Where a check genuinely requires a provider-native signal — a metric the billing
dataset does not carry — that is called out explicitly.
