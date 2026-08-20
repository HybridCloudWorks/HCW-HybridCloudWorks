---
title: Deploying an app with no credentials anywhere
subtitle: Locking the origin to your CDN, wiring GitHub Actions by OIDC, and the two settings that silently break both.
date: 2026-08-20
track: how-to
part: 2 of 2
tags: [azure, github-actions, oidc, cloudflare, terraform]
reading: 11
---

Part 1 built the platform. This deploys an application onto it, and closes the
gap that platform still has: the API origin is publicly reachable, so anything
the application believes about *where a request came from* is currently
unenforceable.

By the end, the origin accepts traffic from your CDN and nothing else, GitHub
Actions deploys with no stored secret, and the whole chain is verifiable from a
terminal.

## What you'll have at the end

| Piece | Result |
| --- | --- |
| Origin lock | The Function App refuses every caller outside your CDN's IP ranges |
| Shared-secret header | The app can prove a request came *through* the CDN, not around it |
| OIDC deploy | GitHub Actions authenticates with a per-run token; nothing stored |
| Client wiring | Every caller — browser, CI, scripts — addresses the CDN, never the origin |
| A verified deploy | Application code running, health endpoint answering through the full path |

## What it costs

Nothing. Every piece here is a configuration change to resources you already
pay for, plus CDN rules that are free on any paid plan.

---

## Why this shape

### Lock the origin, don't just check a header

Your CDN passes the visitor's real IP in a header, and your rate limiter counts
against it. That is only trustworthy if nobody can skip the CDN.

They can, by default. `func-app-prod-cus-01.azurewebsites.net` resolves
publicly. Anyone who finds it sends a forged client-IP header, mints unlimited
quota per invented address, and bypasses your WAF at the same time.

**The two halves are worthless apart:**

- *Header only* — anyone who learns the secret replays it straight at the origin.
- *IP restriction only* — the app still cannot distinguish a proxied request
  from a direct one, so it must either trust a spoofable header or fail closed.

Together they make the client IP trustworthy, which is what the rate limiter
needed all along.

### Fail closed, not open

Where the application cannot establish that a request came through the CDN, it
should refuse rather than fall back to trusting the header:

```js
if (!trusted && !allowUnverifiedOrigin) {
  throw new Error('Refusing to rate-limit on an unverified origin.');
}
```

Rate limiting on a spoofable identifier is not rate limiting, and silently
degrading to one is how a limiter becomes decorative — passing tests, appearing
in dashboards, stopping nobody.

### OIDC for deploys, not a publish profile

Function App publish profiles and service principal secrets are long-lived
credentials that live in your CI secret store, get copied into a second one, and
eventually leak. OIDC issues a token per run, scoped to a repository and a
branch, that expires in minutes.

Gate it to one ref:

```hcl
subject = "repo:acme/platform:ref:refs/heads/main"
```

A token from any other branch does not match, so a pull request from a fork
cannot deploy. That property is the reason to gate on the ref rather than the
repository.

### One address for clients, derived not typed

Once the origin is locked there are two hostnames and only one of them works
from outside. Do not leave that as something people must remember — derive it:

```hcl
output "api_base_url" {
  description = "Public API base — the only address clients can reach"
  value       = "https://api.${var.domain}/api"
}

output "function_url" {
  description = "The ORIGIN. Not reachable by browsers or CI while the lock is on"
  value       = "https://${azurerm_function_app_flex_consumption.app.default_hostname}"
}
```

Every client-facing setting reads the first. The second exists for diagnostics
and says so in its own description, because the next person to wire something up
will read exactly one line before choosing.

---

## Prerequisites

- Part 1 complete: an empty plan, an app with a managed identity.
- A CDN in front of your domain, proxying to the origin.
- A CDN API token with permission to create **transform rules** — a
  DNS-only token applies every record cleanly and fails on the rule alone.
- The Function App's own secret store seeded with the shared secret you are
  about to configure on the CDN side.

---

## The steps

### 1. Generate the shared secret, and put it in two places

```bash
openssl rand -base64 32
```

It goes in the vault, which the application reads at runtime, and in your IaC
variable store, which configures the CDN rule. **The two must match exactly.** A
mismatch is not a partial failure — every anonymous request is treated as
bypassing the CDN and throws.

Read it from the vault when setting the second copy, rather than pasting the
same string twice. Copying from the source of truth removes an entire class of
"I'm sure they match".

**Verify:** both are set; neither is in a file.

### 2. Stamp the header at the CDN

```hcl
resource "cloudflare_ruleset" "origin_secret" {
  count = var.origin_secret == "" ? 0 : 1   # see below

  zone_id = var.cdn_zone_id
  kind    = "zone"
  phase   = "http_request_late_transform"

  rules {
    action     = "rewrite"
    expression = "(http.host eq \"api.${var.domain}\")"

    action_parameters {
      headers {
        name      = "x-origin-secret"
        operation = "set"
        value     = var.origin_secret
      }
    }
  }
}
```

Three choices worth copying:

**The late-transform phase**, so the rule runs after any other transform rules
and after the CDN's own managed headers. Nothing downstream can strip or
overwrite it.

**Scoped to one hostname**, not the whole zone. A secret is safest where it is
not sent to things that do not need it.

**The `count` guard.** With an empty secret the rule would stamp an empty header,
the app would compare empty to empty, and *every caller on earth would pass the
check*. Failing to create the rule is the safer failure, and it is one line to
make it the only possible one.

**Verify:** the rule exists, its phase is `http_request_late_transform`, and its
header value is non-empty.

### 3. Restrict the origin

```hcl
site_config {
  dynamic "ip_restriction" {
    for_each = var.origin_lock_enabled ? var.cdn_ip_ranges : []
    content {
      action     = "Allow"
      ip_address = ip_restriction.value
      priority   = 100 + index(var.cdn_ip_ranges, ip_restriction.value)
      name       = "cdn-${replace(replace(ip_restriction.value, ".", "-"), "/", "-")}"
    }
  }

  dynamic "ip_restriction" {
    for_each = var.origin_lock_enabled ? [1] : []
    content {
      action     = "Deny"
      ip_address = "0.0.0.0/0"
      priority   = 65000
      name       = "deny-all-non-cdn"
    }
  }
}
```

**Keep the ranges as a literal list, not an `http` data source.** A data source
puts a network call inside every plan, and a fetch that fails or truncates
during an apply silently rewrites the allow-list of the only door into your app.
A list is reviewable in a diff and fails at plan time when wrong. Re-check it
when your CDN announces a change.

**The `Deny` is last by construction.** App Service applies an implicit "allow
all" only when the list is *empty*, so this is either absent entirely or ends in
an explicit deny. There is no half-written state that quietly allows everything.

**Make it a variable.** `origin_lock_enabled = false` is a one-step rollback,
and the failure this guards against — your CDN changes ranges, or a legitimate
caller needs the origin — is a same-day problem, not a next-sprint one.

### 4. Point every client at the CDN

This is the step that is easy to skip and expensive to skip.

Anything holding the origin hostname must now hold the CDN hostname:

- the frontend build's API base variable
- your CI smoke test
- any local script, `.env.example`, or usage string
- **your Content Security Policy** — `connect-src` must name the CDN host

CSP is enforced against the URL the browser actually requests. Change the base
URL without the policy and you swap a `403` for a CSP refusal: a different
confusing error, not a fix. Both move together or neither does.

Source them all from the `api_base_url` output rather than typing the hostname,
so this cannot drift back.

**Verify:** grep your repository for `azurewebsites.net`. Every remaining hit
should be a comment explaining why not to use it.

### 5. Federate the deploy identity — and check what your CI actually sends

```hcl
resource "azurerm_federated_identity_credential" "deploy" {
  audience = ["api://AzureADTokenExchange"]
  issuer   = "https://token.actions.githubusercontent.com"
  subject  = "repo:acme/platform:ref:refs/heads/main"
}
```

**Do not trust the documented subject format.** Verify what your provider
actually presents:

```bash
gh api /repos/acme/platform/actions/oidc/customization/sub
```

GitHub has begun composing subjects with numeric organisation and repository IDs
embedded:

```
repo:acme@<org-id>/platform@<repo-id>:ref:refs/heads/main
```

rather than the documented `repo:<org>/<repo>:ref:<ref>`. If that is what your
repository returns, a credential built from the documented form **can never
match** — and because the failure is at login, no workflow gets far enough to
tell you anything more specific.

Trust both forms rather than swapping:

```hcl
locals {
  subject_prefixes = toset([
    "repo:acme/platform",
    "repo:acme@<org-id>/platform@<repo-id>",
  ])
}
```

The rollout is your provider's to reverse, and a credential that silently stops
matching fails every deploy with an error naming nothing that changed. Federated
credentials are free and capped at twenty.

**Verify:** output every trusted subject, so a failing token has something to be
compared against:

```hcl
output "federated_subjects" {
  value = [for c in azurerm_federated_identity_credential.deploy : c.subject]
}
```

### 6. Write the deploy workflow

```yaml
name: Deploy Functions
on:
  workflow_dispatch:        # start here; add the push trigger after one green run

permissions:
  contents: read
  id-token: write           # without this, there is no OIDC token to exchange

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: '22', cache: npm }
      - run: npm ci
        working-directory: functions

      - uses: azure/login@<sha>
        with:
          client-id:       ${{ vars.CLIENT_ID }}
          tenant-id:       ${{ vars.TENANT_ID }}
          subscription-id: ${{ vars.SUBSCRIPTION_ID }}

      # The host storage account denies by default and this runner has a public
      # dynamic IP, so the package upload needs a window opened and closed.
      - name: Open storage firewall window
        id: fw
        run: |
          RUNNER_IP=$(curl -sS https://api.ipify.org)
          echo "runner_ip=$RUNNER_IP" >> "$GITHUB_OUTPUT"
          az storage account network-rule add \
            --resource-group "${{ vars.RESOURCE_GROUP }}" \
            --account-name "${{ vars.FUNCTIONS_STORAGE_ACCOUNT }}" \
            --ip-address "$RUNNER_IP" --output none
          sleep 30            # the rule is eventually consistent

      - uses: Azure/functions-action@<sha>
        with:
          app-name: ${{ vars.FUNCTION_APP_NAME }}    # a variable, never a literal
          package: functions/

      - name: Close storage firewall window
        if: ${{ always() && steps.fw.outputs.runner_ip != '' }}
        run: |
          az storage account network-rule remove \
            --resource-group "${{ vars.RESOURCE_GROUP }}" \
            --account-name "${{ vars.FUNCTIONS_STORAGE_ACCOUNT }}" \
            --ip-address "${{ steps.fw.outputs.runner_ip }}" --output none

      - name: Smoke test
        run: |
          # Through the CDN. Never the origin — the lock refuses runners too.
          curl -fsS "${{ vars.API_BASE_URL }}/health"
```

Four details:

- `id-token: write` — without it `azure/login` has nothing to exchange and fails
  before reaching Azure.
- The firewall window is **always** closed, including on failure. `always()`
  plus the guard.
- `app-name` from a variable. A hardcoded name survives exactly until the first
  rename, then fails with "app not found" — which reads as a permissions or
  wrong-subscription problem long before it reads as a stale string.
- The smoke test goes through the CDN, because after step 3 the origin returns
  403 to your runner as designed.

### 7. Dispatch manually before enabling auto-deploy

Enabling a workflow and enabling deploy-on-merge are two decisions. Make the
first, run it, and only then make the second.

The first deploys against an app that has never held code are the ones most
worth watching, and a red auto-deploy on `main` is discovered by whoever next
visits the site.

---

## How to know it worked

**The origin lock, proved by a pair of responses — neither alone is evidence:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://func-app-prod-cus-01.azurewebsites.net/api/health
# 403  — refused

curl -s -o /dev/null -w "%{http_code}\n" https://api.example.com/api/health
# 200  — arrives
```

Before the lock both return the same code. Afterwards they differ, and that
difference is the test. Checking only the CDN path proves nothing: it answered
before too.

**The deploy:** the workflow is green, and

```bash
az functionapp function list -n func-app-prod-cus-01 -g rg-web-app-prod-cus \
  --query "length(@)"
```

returns your route count rather than `0`.

**The header handshake:** the only proof is application behaviour. Call an
anonymous rate-limited endpoint through the CDN. If it answers, the header
arrived and matched. If it throws, the two copies of the secret differ — roll
back with `origin_lock_enabled = false` and compare them.

---

## When it doesn't work

**`AADSTS700213` / `AADSTS70021` at Azure Login** — the presented subject
matches no federated credential. The error contains the exact subject presented.
Compare it against your `federated_subjects` output. Most common causes: the
ID-embedded format from step 5, a branch that is not the gated ref, or a
workflow running from a fork.

**`403` from the API, in a browser, with no body** — you are calling the origin,
not the CDN. It reads as an authentication or CORS problem because from the
client's side the firewall is invisible. Check the API base variable and the CSP
together.

**CSP refusal in the console after fixing the base URL** — the policy still
names the old host. Both move together.

**Anonymous endpoints throw after enabling the lock** — the two copies of the
shared secret differ, or the CDN rule is not stamping. Check the rule's phase
and that its value is non-empty.

**`Authentication error (10000)` creating the CDN rule** — the API token lacks
transform-rule permission. DNS records will have applied cleanly, which makes
this look like broken configuration rather than a short credential.

**Deploy succeeds, app returns 404 for everything** — the package uploaded but
no functions registered. Check the entry point in `package.json` and that the
route prefix matches what you are calling.

---

## What you have now

An application deployed by a workflow that stores no credential, running on
infrastructure with no keys in it, behind an origin that refuses everything but
your CDN — and every one of those claims verifiable with a single command.

The remaining work is application work: endpoints, data, cutover. The platform
underneath it is finished, and it is finished in the sense that matters — you
can prove each property rather than believing it.
