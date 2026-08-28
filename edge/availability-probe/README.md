# Availability probe — the reachability signal T-519 could not get

A Cloudflare Worker on a 5-minute cron asks
`https://api-azure.hybridcloudworks.com/api/health` and reports each attempt
to Application Insights as an availability result. The design, and why the
built-in Azure availability test cannot do this job on this Cloudflare plan,
is [ADR 0024](../../wiki/0024-edge-availability-probe.md); the alert that
watches the results is `edge_probe_availability` in `infra/observability.tf`.

Why a Worker: Bot Fight Mode answers datacenter clients — Azure's
availability agents, GitHub runners, every external monitoring vendor — with
a 403 interstitial, and it does not run on the Ruleset Engine, so no WAF rule
can exempt them. A same-account Worker's subrequest to its own zone is the
one external-shaped client Bot Fight Mode does not challenge, and it still
traverses the transform rules (origin secret) and reaches the origin from
Cloudflare egress IPs (which the Function App's IP allowlist admits).

## Deploy (owner, once)

Needs the Cloudflare account and the Application Insights connection string —
both owner-held, neither in CI, matching how every other Cloudflare change in
this estate is made.

```bash
cd edge/availability-probe
npx wrangler login
npx wrangler secret put APPLICATIONINSIGHTS_CONNECTION_STRING
# paste the connection string of appi-site-prod-cus (portal → resource → Connection String)
npx wrangler deploy
```

The connection string is a write-only ingestion credential: it can submit
telemetry, nothing else.

## Verify — the acceptance criterion is the observed result, not the deploy

Run one execution by hand rather than waiting for the cron:

```bash
npx wrangler dev --test-scheduled
# in another terminal:
curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"
```

Then confirm the row landed (ingestion can lag a few minutes):

```kusto
availabilityResults
| where name == "edge-api-health"
| order by timestamp desc
| take 5
```

Only after rows with `success == 1` are visible, set
`availability_probe_alert_enabled = true` in the `hcw-azure` workspace and
apply — arming the alert before the first observed success creates a rule
that fires immediately on the missing data it watches for.

## Tests

```bash
npm test
```

Pure `node:test`, no dependencies, no Workers runtime needed: the probe logic
takes its `fetch` as a parameter.
