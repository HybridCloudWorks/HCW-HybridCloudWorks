# Cutover runbook — Migration_Plan §6

Ordered. Each step says **who** runs it and **how you know it worked**. Nothing
here is reversible by itself except step 3c (DNS), which is the rollback.

Read [Migration_Plan.md §6](../../Migration_Plan.md) for the reasoning; this
file is the mechanics.

> **State — updated 2026-08-23.** Production data imported (8,023 documents /
> 62 containers, 1,438 blobs); API live at `api-azure.hybridcloudworks.com`
> behind Cloudflare with the origin locked. Firebase is still live and still
> serving visitors, and DNS has not moved.
>
> The Static Web App **no longer serves Azure's placeholder** — the frontend
> deployed to the preview host on 2026-08-23 (§6 step 1 done). It is reachable
> at `calm-ground-0d0e6a010.7.azurestaticapps.net`.
>
> **Three deploys are pending, and all three must land before DNS moves:**
>
> | What | Why | Last deployed |
> | --- | --- | --- |
> | `terraform apply` | Adds `GEMINI_API_KEY`. Expect **2 add / 1 change / 2 destroy** — the two azapi resources are the T-511 strip pair and are replaced on every settings change. | — |
> | `deploy-functions` | Adds the `cms/ai-features` route (T-516). Expect **98 functions**, verified by counting registrations on `main`. | 2026-08-22 17:00, commit `a93029d` — predates T-516 |
> | `deploy-azure-frontend` | The deployed site is still the **bare SPA shell**; pre-rendering (T-515) landed after it. Expect the payload check to report **82 HTML documents**. | 2026-08-23 02:17, commit `ca596dc` — predates T-515 |
>
> Until the frontend is redeployed, the preview host serves a shell: generic
> `<title>`, no content for crawlers. Moving DNS in that state would swap a
> pre-rendered Firebase site for a shell at every indexed URL at once, which is
> exactly what T-515 warned about.

---

## Step 1 — Entra sign-in

**Already done, verified against the live tenant:** the `HCWSite API`
registration (`ac696e96-e203-47be-ade8-c35ece8a6c4a`) exposes `access_as_admin`
and carries the `Admin` and `LabAgent` app roles. The three build variables are
set in the repository:

| Variable | Value |
| --- | --- |
| `VITE_ENTRA_CLIENT_ID` | `ac696e96-e203-47be-ade8-c35ece8a6c4a` |
| `VITE_ENTRA_TENANT_ID` | `1a2fce27-b5f6-43c7-a86e-cf0bb74d4672` |
| `VITE_ENTRA_API_SCOPE` | `api://ac696e96-e203-47be-ade8-c35ece8a6c4a/access_as_admin` |

**You run:**

```powershell
./scripts/cutover/01-entra-spa.ps1 -WhatIf     # look first
./scripts/cutover/01-entra-spa.ps1
```

Adds the SPA redirect URIs and assigns the `Admin` app role. It uses a SPA
platform on the existing registration rather than a second one, so the SPA
requests a scope on its own app — that consents automatically and removes the
client-id/audience mismatch REVIEW §2.2 calls the highest-risk in the system.

**Then, gate 2.** The role is only half the guard. `admins/{oid}` must also hold
a row. Set `CMS_BOOTSTRAP_ALLOWED_EMAILS` on the Function App, sign in, and call
`POST /api/bootstrapCurrentUserAdmin` once. A token with the `Admin` role and no
registry row is still a 403.

**Verified when:** `az ad app show --id ac696e96-... --query spa.redirectUris`
lists four URIs, and an admin sign-in reaches the UI without a 401 on every call.

---

## Step 2 — Frontend deploy (this is §6 step 1, not a separate thing)

**You run:**

```powershell
./scripts/cutover/02-swa-token.ps1
```

Reads the SWA deploy token and stores it as `AZURE_STATIC_WEB_APPS_API_TOKEN`.
The repository currently holds **no secrets at all**, and any token recorded
before the centralus rebuild is dead — the rebuild reissued it.

**Then enable the workflow.** `deploy-azure-frontend.yml` is gated with
`if: ${{ false }}`. Enabling it is a deliberate, reviewed change — REVIEW §2.4.
Two edits:

```diff
-name: DISABLED - Prototype Frontend Deployment
+name: Deploy Frontend

   build-and-deploy:
-    if: ${{ false }}
     name: Build and Deploy to Azure Static Web Apps
```

Then `gh workflow run "Deploy Frontend" --ref main`.

**This is safe while Firebase is live.** The first run publishes to
`calm-ground-0d0e6a010.7.azurestaticapps.net` — the §6 step 2 preview host. DNS
does not move until step 3c.

**One thing that must land first:** that origin is not in the CORS allowlist
compiled into `functions/src/lib/auth/cors.js`, which only knows
`hybridcloudworks.com` and `www`. Without it every API call from the
parallel-running site fails CORS, and it presents as a broken API. Set the
`cors_extra_origins` workspace variable and apply **before** the first frontend
deploy:

```
cors_extra_origins = ["https://calm-ground-0d0e6a010.7.azurestaticapps.net"]
```

Empty it again after DNS moves.

**Verified when:** the preview hostname serves the real site and the browser
console shows no CORS failures.

---

## Step 3 — Secrets, domains, DNS

> **Before any script in this step: you need a data-plane role on the vault.**
>
> The vault is RBAC-authorised (`enable_rbac_authorization = true`) with zero
> access policies. Terraform grants the Function App *Key Vault Secrets User*
> and the HCP Terraform service principal *Key Vault Secrets Officer* — and no
> human anything. **Being subscription Owner does not help**: Owner is
> control-plane, secret values are data-plane.
>
> Without it, every script here opens its firewall window exactly as designed
> and is then refused with `ForbiddenByRbac`, which reads as a broken script.
> That cost an hour on 2026-08-23.
>
> Grant it through Terraform, so it is reviewed and revoked deliberately rather
> than clicked in the portal and forgotten. In HCP Terraform:
>
> ```
> admin_object_ids = ["<your Entra object id>"]
> ```
>
> Your object id: `az ad signed-in-user show --query id -o tsv`. Apply, do the
> work in this step, then **empty it and apply again** — the same window
> discipline as `admin_ip_rules`, and for the same reason.

### 3a. Key Vault (TODO.md T-321)

**You run:**

```powershell
./scripts/cutover/03-keyvault-secrets.ps1 `
    -GcpServiceAccountJsonPath .\gcp-sa.json `
    -GitHubAppPrivateKeyPath   .\github-app.pem
```

Nineteen of twenty-one secrets are seeded; these two are not. Both are
multi-line and both are read by `getSecret()` at runtime rather than through an
app-setting reference, which is why the diff that checked the other nineteen
missed them.

The script seeds with `--file` (never `--value`, which folds newlines and stores
something that parses as neither JSON nor PEM), opens a Key Vault firewall
window for your IP, and always closes it — including on Ctrl-C. It reads both
secrets back and re-parses them, because a mangled secret that stored
successfully looks done and fails much later.

`ANTHROPIC-API-KEY` is already set. The inspector, forge, digest, AI cover and
alerts all no-op cleanly without their keys, so nothing here blocks the rest.

### 3b. Custom domains on the Static Web App

```powershell
az staticwebapp hostname set -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus `
    --hostname hybridcloudworks.com
az staticwebapp hostname set -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus `
    --hostname www.hybridcloudworks.com
```

Binding does **not** wait on DNS moving: Terraform already manages the `asuid`
TXT record (`cloudflare_record.azure_swa_txt_validation`), which is the
ownership proof.

### 3c. Move DNS — the visitor-facing moment

At Cloudflare, repoint the apex and `www` CNAMEs from the Firebase origin to
`calm-ground-0d0e6a010.7.azurestaticapps.net`.

**Lower the TTL at least 48 hours beforehand.** `api-azure.` does not move — it
has been on Azure since Phase 2.

**Rollback is DNS**, for as long as Firebase stays deployed. Do not decommission
anything in GCP until Azure has run a full week including every scheduled job —
the daily and weekly timers are exactly what a short soak misses.

### 3d. Telegram — re-run setWebhook

The receiver was missing until 2026-08-22; §6 step 6 assumed one existed. It is
now `POST /api/telegram/webhook` (T-512), ported rather than retired.

**Deploying it changes nothing on its own.** The URL and its secret token are
registered with **Telegram**, not in code, so the bot keeps POSTing at the Cloud
Functions URL until `setWebhook` is re-run — and nothing breaks until GCP is
decommissioned, at which point it goes quiet with no error anywhere in Azure.

**You run, after the functions deploy:**

```powershell
./scripts/cutover/04-telegram-webhook.ps1 -Mode Show   # what is registered now
./scripts/cutover/04-telegram-webhook.ps1              # point it at Azure
```

It derives the secret the same way the running code does (`sha256` of the bot
token — one secret, nothing to keep in sync), and preflights the receiver first:
an unauthenticated POST must return **401**, which proves both that the route is
deployed and that the secret gate is running. A webhook pointed at a 404 makes
Telegram back off, so the bot stays broken for a while after you fix it.

**Verified when:** `/help` in the chat comes back with the command list. If it
does not, an unauthorized chat id is ignored *silently* by design — check
`TELEGRAM_CHAT_ID`, then App Insights traces for `[telegram]`, then
`-Mode Show` for Telegram's own `last_error_message`.

---

## Step 4 — The delta import

**Pause the live writers first.** Two things rewrite migrated containers every
few minutes, and importing over them produces field mismatches that look like
corruption (D12):

1. Site-Main's `syncSocialCalendarScheduled` Publer sync — rewrites `social_posts`
2. The VPS agent heartbeat (`labs/vps-agent/index.js`) — re-`set()`s `lab_agents`

Keep `SYNC_SOCIAL_CALENDAR` **out of** `enabled_timers` until the import is done,
or Azure becomes the third writer.

**Gate, then import:**

```bash
gh workflow run migrate-data.yml -f mode=inventory-gate
gh workflow run migrate-data.yml -f mode=rehearse -f target=production
```

The inventory gate must pass immediately before the import — a collection added
upstream in between is exactly what it catches.

**Verified when:** `reconciliation.summary.json` shows `failed: 0` on every
container. `social_posts` and `lab_agents` mismatches mean a writer is still
running.

`migration_writer_enabled = true` is already on for this run. Flip it, plus
`cosmos_scratch_enabled` and `storage_scratch_enabled`, off afterwards.

---

## Step 5 — Arm the timers, one at a time

> **The acceptance criterion changed on 2026-08-22.** It used to be "the
> setting is applied". It is now "the invocation was observed". That is not
> pedantry — `CORS_ALLOWED_ORIGINS` was applied correctly, confirmed in ARM
> byte-for-byte, and the running app never honoured it (T-513). ARM is
> **desired** state. It is not evidence of **effective runtime** state, and the
> gap between the two is silent.

**Turning a timer on is a workspace variable edit, not a code change.** Add its
flag suffix to `enabled_timers` in HCP Terraform and apply:

```
enabled_timers = ["SYNC_RSS_FEEDS"]
```

An unrecognised name fails the plan rather than silently arming nothing — a typo
here is indistinguishable from a timer that does not fire.

**`FEATURE_FLAG_SCHEDULERS` is a separate master kill switch** and is still
`"false"`. It holds every timer off regardless of `enabled_timers`, so arming
the first timer means setting **both**.

### The four gates

Do not advance if any of them fails. Each proves a different link, and the whole
point is that the earlier ones can pass while the later ones fail.

| # | Gate | Proves | How |
| --- | --- | --- | --- |
| 1 | **Deployment** | ARM holds the setting | `az functionapp config appsettings list ... --query "[?name=='FEATURE_FLAG_X']"` |
| 2 | **Runtime** | the *active worker* sees it | the startup log line — presence, never the value |
| 3 | **Behaviour** | the feature reads it | exercise whatever depends on the setting |
| 4 | **Invocation** | the timer actually fired | `Function.<name>` traces **and** the timer's own durable side effect |

The evidence chain, in order, with nothing skipped:

```
enabled_timers configured
  -> new worker/revision active
  -> timer registration visible at startup
  -> scheduled invocation occurs
  -> handler enters
  -> expected downstream action or log occurs
```

### Gate 4 needs two independent witnesses

Telemetry alone is not an oracle here, and 2026-08-22 is why: **there are three
planes that can fail independently**, and a silent timer looks identical in all
three.

```
configuration plane   enabled_timers  -> did the worker receive it?
execution plane       timer scheduled -> did it actually invoke?
telemetry plane       log written     -> did it survive filters and the cap?
```

`AppRequests` was empty for the entire life of this app because `host.json` set
`Host.Results` to `Error`, and every trace after 01:33Z on 2026-08-22 was
discarded because the workspace was over its ingestion cap. Either fault alone
turns "the timer did not fire" and "the timer fired and nobody heard it" into
the same observation.

So pair the telemetry with a **durable side effect the timer necessarily
creates** — a document write, a queue message, a blob, a timestamp:

| Timer | Durable witness |
| --- | --- |
| `checkAgentHealth` | `lab_agents` documents get a fresh health field |
| `syncRssFeeds` | new `rss_cache` / `content` documents, or an updated marker |
| `publishScheduledContent` | a `content` document moves to `published` |
| `cleanupTempStorage` | a dry-run summary in the logs; blobs unchanged until `TEMP_STORAGE_CLEANUP_DELETE` |

Read the witness directly from Cosmos or Storage. If telemetry and the witness
disagree, believe the witness.

### Then, per timer

```powershell
./scripts/cutover/05-verify-timer.ps1 -Name syncRssFeeds
```

The gate is not "did it run". It is "did it run at the intended **Chicago**
local time". A timer firing five hours early passes a naive "fired once" check
and fails the real one; the script prints both zones so the comparison is
against the local column.

### Order matters for two of them

- `SYNC_SOCIAL_CALENDAR` — not until after step 4, or Azure becomes a third
  writer to `social_posts` mid-import.
- `CLEANUP_TEMP_STORAGE` and `CLEANUP_UNUSED_CERT_IMAGES` stay **dry-run** even
  when armed, until `TEMP_STORAGE_CLEANUP_DELETE` / `CERT_IMAGE_CLEANUP_DELETE`
  are set. Arming the timer and arming the deletion are two decisions;
  conflating them is how a dry run becomes data loss (T-302).

### Before trusting telemetry as evidence at all

Confirm the plane itself is alive, once, at the start of the session:

```bash
# ingestion is not capped
az monitor log-analytics workspace show -g rg-mgmt-plat-prod-cus -n log-plat-prod-cus-01   --subscription 02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e   --query "workspaceCapping.dataIngestionStatus" -o tsv     # expect: RespectQuota

# WORKER logs are arriving, not just host ones
az monitor log-analytics query -w cf80dc24-2499-49a0-8c66-9522bcc294ed --analytics-query   "AppTraces | where TimeGenerated > ago(15m) | extend cat=tostring(Properties.Category)    | where cat startswith 'Function' | summarize count() by cat"
```

**Send traffic first, and keep sending it.** `always_ready = 0`, so the app
scales to zero and a worker torn down between flush intervals takes its
buffered telemetry with it. On 2026-08-22 a handful of probes produced nothing
for twenty minutes, while three sustained minutes produced rows within four.
**An empty result from a cold app is not evidence of anything.**

**`AppRequests` is empty and is not the oracle.** Zero rows for this app's
entire history. `Host.Results` was `Error` until 2026-08-22, which explains the
history, but the table stayed empty after that was corrected and redeployed —
unexplained, tracked in T-514. Use the `Function.<name>` traces, which are
strictly better here because they carry the schedule:

```
Function.syncSocialCalendarScheduled       Executed 'Functions.…' (Succeeded, Id=…, Duration=…)
Function.syncSocialCalendarScheduled       Trigger Details: ScheduleStatus: {"Last":"…03:40:00-05:00","Next":"…03:45:00-05:00"}
Function.syncSocialCalendarScheduled.User  [syncSocialCalendarScheduled] disabled — skipping
```

`Last` and `Next` are already in **Chicago local time**, which is the
comparison §7 actually asks for — `AppRequests` would not have given that. The
`.User` row is the handler's own `context.log`, and it is how you tell "the
timer fired and the flag gate skipped it" from "the timer never fired".

**Query the workspace, never `az monitor app-insights query --app <appId>`.**
The component is workspace-based with the workspace in another subscription, and
that proxy returns **zero rows for every query** rather than erroring — it
produced two wrong conclusions on 2026-08-22 (T-514).

## Then watch

24–48 hours before touching GCP, and a **full week including every scheduled
job** before decommissioning anything. Firebase Storage stays warm the whole
time: migrated documents still carry their original `imageUrl` / `storagePath`
values until the re-pointing step in §5.7 runs, deliberately, so a rollback
needs nothing rewritten.
