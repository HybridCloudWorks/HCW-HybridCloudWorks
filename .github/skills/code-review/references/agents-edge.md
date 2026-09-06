# VPS agent and edge probe review — `vps-agent/`, `edge/`

Two small, high-trust components that run *outside* Azure:

- `vps-agent/` — an API-authenticated, **pull-based** Labs job executor. It
  polls the Functions API (`lab-agent-http.js`) for jobs and runs them in
  Docker on a VPS. It holds a credential and executes code, so its diff gets
  security-first review.
- `edge/availability-probe/` — the Cloudflare availability probe
  (ADR-0024), part of the alerting fabric (ADR-0022).

## What to check in the diff — `vps-agent/`

- **Pull, never push.** The agent initiates all connections outbound to the
  Functions API (`lib/api.js`). A diff that opens a listening port, accepts
  inbound commands, or adds a new remote-control channel changes the
  security model and is blocking without an ADR.
- **Capability scoping.** `lib/capabilities.js` defines what jobs the agent
  may run; `lib/docker-runner.js` executes them in containers. Check that
  new capabilities stay allowlist-shaped (explicit commands/images, not
  interpolated user input), that job payload fields never reach a shell
  string unescaped, and that container runs keep whatever resource/network
  limits the runner sets today.
- **Credential handling.** The agent's API credential comes from its
  environment/config — never logged, never echoed into job containers,
  never committed. Token handling changes here must be reviewed together
  with `functions/src/functions/lab-agent-http.js` (the server side of the
  same contract).
- Tests are co-located (`capabilities.test.js`, `docker-runner.test.js`);
  behavior changes need test movement.

## What to check in the diff — `edge/availability-probe/`

- The probe exists to tell "site down" from "monitoring down". Review that
  failure of the probe itself is distinguishable from failure of the site
  (see ADR-0024 and `docs/runbooks/availability-probe.md`), that probe targets and
  thresholds match what `verify-alert-state.yml` / the alert fabric expect,
  and that any secret (API tokens for Cloudflare) stays in the platform's
  secret store, not in code or wrangler config committed to Git.
- Probe changes usually pair with `infra/observability.tf` alert wiring —
  review them together, and check the alert actually fires on the new
  condition (the repo's history includes an alert armed on the wrong gate).

## Verification commands

Both use Node's built-in test runner (`node --test`), not Vitest:

```bash
cd vps-agent && npm test
cd edge/availability-probe && npm test
```
