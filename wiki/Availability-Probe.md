# Availability probe — the reachability signal T-519 could not get

> **Status: deployed and armed.** The secret was corrected and
> `availability_probe_alert_enabled` applied on 2026-09-01 (T-519 closed);
> `alert-api-reachability-prod-cus` is live in `rg-web-site-prod-cus`, armed
> only after a full 30-minute window held 6 healthy rows. The procedure below
> is kept for redeploys and secret rotation.

A Cloudflare Worker on a 5-minute cron asks
`https://api-azure.hybridcloudworks.com/api/health` and reports each attempt
to Application Insights as an availability result. The design, and why the
built-in Azure availability test cannot do this job on this Cloudflare plan,
is [ADR 0024](0024-edge-availability-probe); the alert that watches the
results is `edge_probe_availability` in `infra/observability.tf`, and the
Worker source is `edge/availability-probe/` in the repository.

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

From the repository root. PowerShell, one line each — the secret is piped
straight from Azure so the value never reaches a screen, a clipboard, or shell
history, and the portal's Instrumentation-Key-above-Connection-String trap
cannot recur (it did, on 2026-08-31 — see `wrangler.toml`, whose comment this
command mirrors; the resource is `appi-site-prod-cus-01`, instance suffix
included):

```powershell
npx wrangler login
```

```powershell
az monitor app-insights component show --app appi-site-prod-cus-01 -g rg-web-site-prod-cus -o json | ConvertFrom-Json | Select-Object -ExpandProperty connectionString | npx wrangler secret put APPLICATIONINSIGHTS_CONNECTION_STRING --config edge/availability-probe/wrangler.toml
```

```powershell
npx wrangler deploy --config edge/availability-probe/wrangler.toml
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
cd edge/availability-probe && npm test
```

Pure `node:test`, no dependencies, no Workers runtime needed: the probe logic
takes its `fetch` as a parameter. CI runs these on every pull request.
