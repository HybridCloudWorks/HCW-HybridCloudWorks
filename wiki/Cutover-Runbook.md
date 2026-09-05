# Cutover runbook — Migration-Plan §6

Ordered. Each step says **who** runs it and **how you know it worked**. Nothing
here is reversible by itself except step 3c (DNS), which is the rollback.

Read [Migration-Plan §6](Migration-Plan) for the reasoning; this
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
> | `terraform apply` | Adds `GEMINI_API_KEY`. **The 2 add / 1 change / 2 destroy expectation recorded here is superseded** — the next apply also carries the Go-Live remediation (PR #218), whose shape is **17 add / 5 change / 92 destroy**, 87 of those destroys being the migration rehearsal estate. Approve it against the resource *addresses* and the authorisation record in `TODO.md`, not against a count on this page. The steady-state signature afterwards is 3 add / 1 change / 3 destroy. | — |
> | `deploy-functions` | Adds the `cms/ai-features` route (T-516). Expect **98 functions**, verified by counting registrations on `main`. | 2026-08-22 17:00, commit `a93029d` — predates T-516 |
> | `deploy-azure-frontend` | The deployed site is still the **bare SPA shell**; pre-rendering (T-515) landed after it. Expect the payload check to report **82 HTML documents**. | 2026-08-23 02:17, commit `ca596dc` — predates T-515 |
>
> Until the frontend is redeployed, the preview host serves a shell: generic
> `<title>`, no content for crawlers. Moving DNS in that state would swap a
> pre-rendered Firebase site for a shell at every indexed URL at once, which is
> exactly what T-515 warned about.
>
> **Step 4 — the delta import — was retired on 2026-08-24 and cannot be run.**
> The workflow and the scripts behind it are deleted. The grants it needed are
> deleted from the configuration and are revoked by the next apply — as of
> 2026-08-25 they are still live in Azure, which changes nothing about the step:
> without the workflow there is nothing to run them from. The step is kept below
> as the record of what it was and of what retiring it costs. Every other step
> here is still live.

---

## Step 0 — `az` sign-in, and the ways it goes wrong

Every `az` command in this runbook assumes a session against the estate's
tenant with the right subscription pinned. Five distinct failures cost round
trips on 2026-09-01 and 2026-09-02, and not one of them described its own
cause. This step exists so the next operator pays for none of them.

The estate is **one tenant** — `1a2fce27-b5f6-43c7-a86e-cf0bb74d4672` — holding
four subscriptions:

| Subscription | Id | What lives in it |
| --- | --- | --- |
| `sub-app-site-prod-cus` | `b9e02281-ebb6-49e9-bd7b-f275b1350726` | The workload: Function App, Static Web App, Cosmos, storage, Key Vault |
| `sub-plat-mgmt-prod-cus` | `02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e` | Log Analytics `log-plat-prod-cus-01` and the action group — every telemetry query below |
| `sub-plat-conn-prod-cus` | `8f3c6d82-2d55-4b25-ad40-27c19da5e3d8` | Connectivity |
| `sub-plat-ident-prod-cus` | `10ae90b5-9149-4063-a1b8-9301974ea997` | Identity |

Note the token order in the platform names: the subscription is
`sub-plat-mgmt-prod-cus` while its resource group is `rg-mgmt-plat-prod-cus`.
The two middle tokens swap between the two, which is easy to write backwards
and produces a not-found against a name that looks right.

The tenant id is written out here rather than referenced. It is not a secret —
Entra publishes it for any domain, at
`https://login.microsoftonline.com/hybridcloudworks.com/v2.0/.well-known/openid-configuration`
— and the alternative is a placeholder inside a command meant to be pasted,
which `.claude/CLAUDE.md` forbids for reasons this page has already paid.

Sign in scoped to that tenant:

```powershell
az login --use-device-code --tenant 1a2fce27-b5f6-43c7-a86e-cf0bb74d4672
```

Pin the workload subscription:

```powershell
az account set --subscription b9e02281-ebb6-49e9-bd7b-f275b1350726
```

**Success:**

```powershell
az account show -o json | ConvertFrom-Json | Select-Object name, id, tenantId
```

returns `sub-app-site-prod-cus`, `b9e02281-ebb6-49e9-bd7b-f275b1350726`, and
the tenant above. Anything else and every read that follows is against the
wrong estate.

### The failures, and what each one actually was

**1. `--use-device-code` is not a preference.** Plain `az login` hands off to
the Windows WAM broker and its account picker, which spun indefinitely on
2026-09-02 without erroring. There is nothing to read while it hangs. Use the
device-code flow above as the default on Windows, not as the fallback.

**2. `AADSTS700082 — the refresh token has expired due to inactivity.`** Reads
like a permissions or configuration problem and is neither: the cached token
had simply gone unused past its 90-day window. The fix is the login above.
Nothing in the estate changed.

**3. The cached tenant is not the estate tenant.** `az` will suggest a tenant
it has seen before, and on 2026-09-02 that put the session in an unrelated
tenant. This is the expensive one, because reads then **succeed and return
nothing** rather than failing — an empty result from the wrong estate is
indistinguishable from a real absence. `az account show` naming any tenant
other than `1a2fce27-…` invalidates everything read after it.

**4. A broad login enumerates every tenant, and scripts then hang.** `az login`
with no `--tenant` pulls in every tenant the identity can reach; subsequent
scripted reads slow to the point of appearing stuck. Reset completely and
re-scope — three commands, in this order:

```powershell
az logout
```

```powershell
az account clear
```

```powershell
az login --use-device-code --tenant 1a2fce27-b5f6-43c7-a86e-cf0bb74d4672
```

**5. `AADSTS50076` MFA warnings that are pure noise.** `az account list --all
--refresh` prints authentication failures for other tenants the signed-in
identity can reach, demanding MFA against
`797f4846-ba00-4fd7-ba43-dac1f8f63013` — which is Azure CLI's own first-party
application rather than anything in this estate, so it is not worth chasing.

**None of them is the estate tenant, and on 2026-09-02 one of them was named
`hybridcloudworks.com` while holding none of the estate — which is the trap.**
A tenant named for the domain reads like the right one. The test is not the
name: it is that all four subscriptions in the table above carry
`1a2fce27-…`, so the estate is fully accounted for and nothing behind those
warnings is needed by any command in this runbook.

Which tenants appear is a property of the identity rather than of this estate,
so they are deliberately not listed here — the set changes without anything in
the runbook changing, and a stale list of someone else's tenants would be worse
than none. The warnings matter only because of where they print: several loud
lines *above* the table of results, so a command that fully succeeded reads at
a glance as one that failed.

---

**6. `az monitor log-analytics query` is not core `az`, and a fresh machine
hangs on it.** It ships in the `log-analytics` extension. Without it, az does
not fail — it asks *"Do you want to install it now? (Y/n)"* on stderr, and
`05-verify-timer.ps1` redirects stderr away, so the question is invisible and
the script sits forever after printing its section header. Two evenings in a
row on 2026-09-02/03, on a laptop whose `az extension list` returned nothing.
Install it once; the script now refuses to run without it and says so:

```powershell
az extension add --name log-analytics
```

**Success:** `az extension list -o json | ConvertFrom-Json | Select-Object name, version`
shows `log-analytics`. The only stable-channel version is a preview
(`1.0.0b1` on 2026-09-03); that is expected.

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
client-id/audience mismatch TODO.md calls the highest-risk in the system.

**Then, gate 2.** The role is only half the guard. `admins/{oid}` must also hold
a row. Set `CMS_BOOTSTRAP_ALLOWED_EMAILS` on the Function App, sign in, and call
`POST /api/bootstrapCurrentUserAdmin` once. A token with the `Admin` role and no
registry row is still a 403.

**Verified when:** `az ad app show --id ac696e96-... --query spa.redirectUris`
lists four URIs, and an admin sign-in reaches the UI without a 401 on every call.

---

## Step 2 — Frontend deploy (this is §6 step 1, not a separate thing)

**You run:**

**RETIRED 2026-08-30 (T-727). Skip this step.** It read the SWA deploy token
and stored it as `AZURE_STATIC_WEB_APPS_API_TOKEN`:

```powershell
./scripts/cutover/02-swa-token.ps1
```

`deploy-azure-frontend.yml` now mints the token from ARM under federated
identity at deploy time, so there is no value to store and none to rotate. The
step is kept here rather than deleted because a runbook that silently loses a
step reads as an incomplete procedure to the next person following it.

What the step needs instead is a one-time prerequisite, recorded under
*Frontend release*: the owner creates the `HCW Static Web App Deployer` role
definition and applies the assignment. Without it the deploy fails at the
minting step with an authorization error that names the role.

**The workflow is already enabled.** This step used to describe a
`name: DISABLED - Prototype Frontend Deployment` header and an
`if: ${{ false }}` gate to delete; neither exists. The workflow is called
`Deploy Frontend`, has no gate, and is `workflow_dispatch`-only — which is the
deliberate control now, rather than a disabling condition someone has to
remember to remove.

Two prerequisites replace the edits, and both are owner actions (T-727).

**The role definition is a repository file, so check it is in the working tree
first.** It arrived on `claude/status-check-2vqe7d` and is on `main` only once
that branch merges. Run this from the repository root:

```powershell
Test-Path infra/roles/static-web-app-deployer.json
```

`True` means go on. `False` means fetch it before anything else:

```powershell
git fetch origin claude/status-check-2vqe7d; git checkout origin/claude/status-check-2vqe7d -- infra/roles/static-web-app-deployer.json
```

This check is here because skipping it does not fail in a way that says so.
`az` treats a `@`-prefixed value that is neither valid JSON nor an existing
file as JSON, so a missing file reports **`Failed to parse string as JSON`**
naming the path — an error about the wrong subject entirely. It cost two round
trips on 2026-08-30, the first spent on quoting, which was never the problem.

```powershell
az role definition create --role-definition '@infra/roles/static-web-app-deployer.json'
```

Success echoes the definition back with `"roleName": "HCW Static Web App
Deployer"` and an `"id"` ending in a GUID.

**The assignment reaches Azure by merging, not by `terraform apply`.** The
`hcw-azure` workspace is VCS-connected and refuses a CLI apply outright:

> Error: Apply not allowed for workspaces with a VCS connection

So step 2 is to merge the pull request carrying `infra/oidc.tf`, then watch the
run in HCP Terraform:

https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs

Whether that run applies on its own or waits for a confirmation depends on the
workspace's **Apply Method**, which is read here:

https://app.terraform.io/app/hcw/workspaces/hcw-azure/settings/general

Read it before merging rather than after. Every run in this workspace carries
the permanent diff, which replaces three `azapi` resources and restarts the
function app — so on `Auto apply`, a merge restarts production without asking.

The deploy mints its token from ARM under federated identity, so it needs that
role assigned before its first run. Without it the job fails at the minting
step with an error naming the missing role.

Then dispatch it from **Actions → Deploy Frontend → Run workflow**, on `main`.
The workflow refuses any other ref (T-705).

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

### 3a. Key Vault (TODO.md T-321) — OPTIONAL, not a cutover blocker

Traced 2026-08-23, because this step sent someone looking for two files they
did not have. **Rewritten 2026-08-29: neither file exists any more.**

| Secret | Read by | Missing means |
| --- | --- | --- |
| `GCP-BILLING-API-KEY` | `lib/cloud-tools/pricing/gcp.js`, nothing else | GCP prices absent from the pricing comparison. AWS and Azure still render — each provider is isolated in its own try/catch, which that module calls "the single most important behaviour" it carries |
| `GITHUB-APP-PRIVATE-KEY` | **nothing in the ported code** | nothing |

Neither is on any path a visitor or the admin portal touches. **Skip this step
at cutover.**

`03-keyvault-secrets.ps1` is gone with them. It existed because both of those
secrets were multi-line files that had to be seeded with `az keyvault secret
set --file` and read at run time through a vault SDK client, rather than as an
app-setting reference — which is why the diff that checked the other nineteen
missed them. That is no longer true of either:

- **GCP** is now an API key, which is what Google documents for the Cloud
  Billing Catalog API. It is a single string, it arrives as the app setting
  `GCP_BILLING_API_KEY` → `@Microsoft.KeyVault(…secrets/GCP-BILLING-API-KEY)`,
  and it is seeded like every other secret:
  `./scripts/cutover/06-seed-secret.ps1 -Name GCP-BILLING-API-KEY`.
- **The GitHub App private key** is read by nothing. It has no app setting and
  no seeding path, because seeding a credential nothing reads is how an
  unowned credential ends up in a vault. Whoever needs it can add the setting
  and the reference in the same change that adds the caller.

If the GCP column in the pricing tool is wanted, get the key from the GCP
console (enable the Cloud Billing API, create an API key, restrict it to that
API) and paste it into Admin → Platform → API Keys. That is a console visit, not
cutover work.

**Seeding moved into the portal on 2026-08-29.** Every secret in this runbook is
now pasted at Admin → Platform → API Keys, which writes to the vault from inside
the integration subnet — no firewall window, no `admin_ip_rules` apply, no Azure
CLI. `06-seed-secret.ps1` is kept deliberately: the page runs *in* the Function
App, and a credential is exactly the kind of thing you may need to fix when the
Function App is not serving. Use the script when the app is down or before it is
first deployed; use the page every other time.

`ANTHROPIC-API-KEY` is already set. The inspector, forge, digest, AI cover and
alerts all no-op cleanly without their keys, so nothing here blocks the rest.

### 3b. Custom domains on the Static Web App

**Done 2026-08-23.** Both are bound; `www` is serving. Kept here because the
procedure is not obvious and the previous version of this section was wrong.

The two hostnames validate by **different mechanisms**, and the earlier claim
that binding "does not wait on DNS moving" was false for both. `www` needed a
real CNAME; the apex needed a token Azure generates.

Neither binding moves visitor traffic. Traffic moves in 3c, and only there.

#### www — CNAME validation

`www` did not exist in DNS at all (NXDOMAIN), so there was no live traffic and
nothing to lower a TTL on. Create the record first, then bind:

1. Cloudflare: `CNAME` · name `www` · target the SWA default hostname ·
   **DNS only (grey cloud)** · TTL 60.
2. Then:

```bash
az staticwebapp hostname set -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus --hostname www.hybridcloudworks.com --no-wait
```

Validation is quick; the managed TLS certificate then takes 15–20 minutes.
`Adding` → `Ready`. It does not serve until `Ready`, and HTTPS fails with a
connection error until then — that is the certificate, not a fault.

#### apex — TXT token validation

A root domain cannot be a CNAME, so Azure mints a token instead:

```bash
az staticwebapp hostname set -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus --hostname hybridcloudworks.com --validation-method dns-txt-token --no-wait
az staticwebapp hostname show -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus --hostname hybridcloudworks.com --query validationToken -o tsv
```

Add the token as `TXT` · name `@` in Cloudflare. Azure re-checks on its own —
**nothing to re-run**. The apex already carries several TXT records (Google
verification, `MS=`, SPF, Firebase); TXT records coexist.

#### Use `--no-wait`

Without it the CLI blocks on the long-running operation. For the apex that
**never completes**, because it is waiting for a TXT record you cannot add while
the command is holding the terminal. It is not stuck; it is deadlocked on you.

#### There is no `asuid` record *for the Static Web App*

This section used to say Terraform managed an `asuid` TXT record that served as
the SWA ownership proof. It did not. `cloudflare_record.azure_swa_txt_validation`
published the SWA *hostname* as a TXT value, which validates nothing, and has
been removed — see the comment where it used to be in `infra/main.tf`.

An `asuid` record **does** exist in this estate, and it is correct: Terraform's
`cloudflare_record.azure_functions_domain_verification` publishes
`asuid.api-azure` holding the Function App's `custom_domain_verification_id`.
That is the App Service convention, used properly, for the Function App.

The error was carrying that pattern across to Static Web Apps, which does not
use it — SWA validates a root domain with a generated token instead.

#### Verified when

```bash
az staticwebapp hostname list -n stapp-site-prod-cus-01 -g rg-web-site-prod-cus -o table
```

Both `Ready`. On 2026-08-23 `https://www.hybridcloudworks.com/` returned 200
with 65,577 bytes and the pre-rendered title, which is the whole stack proven:
Static Web App, managed certificate, pre-rendered HTML, own domain.

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

## Step 4 — The delta import — RETIRED 2026-08-24

> **This step cannot be run.** `migrate-data.yml` and the five scripts behind it
> were deleted on 2026-08-24 (`59e471b`), so both commands below fail before
> they reach Azure. The three role assignments that let the CI identity write to
> the production Cosmos database and to the content storage account, and the
> rehearsal estate they wrote to, are deleted from the configuration and are
> revoked and destroyed by the apply that carries the removal — `infra/oidc.tf`
> and `infra/scratch.tf` hold the removal records. **As of 2026-08-25 that apply
> has not run**, so both are still live in Azure; that changes nothing here,
> because the workflow that would have used them is already gone. There is no
> variable to flip back either; those are deleted too. Reinstating a delta
> import means restoring the workflow, the scripts and the grants, which is a
> new decision rather than a re-run of this step.
>
> **What retiring it costs, stated plainly.** The production import ran on
> 2026-08-21 — 8,023 documents / 62 containers, 1,438 blobs. Anything written on
> Firebase after that date does not come across, and DNS moves without a second
> pass. The owner decided that on 2026-08-24 with the rehearsal finished; it is
> not an oversight for the cutover to correct.
>
> The rest of the step is kept because it is still true about the *system*: the
> two live writers below are why `social_posts` and `lab_agents` were the only
> containers that failed to reconcile (D12), and `SYNC_SOCIAL_CALENDAR` is still
> the timer that would make Azure a third writer.

**Pause the live writers first.** Two things rewrite migrated containers every
few minutes, and importing over them produces field mismatches that look like
corruption (D12):

1. Site-Main's `syncSocialCalendarScheduled` Publer sync — rewrites `social_posts`
2. The VPS agent heartbeat (`labs/vps-agent/index.js`) — re-`set()`s `lab_agents`

Keep `SYNC_SOCIAL_CALENDAR` **out of** `enabled_timers` until the import is done,
or Azure becomes the third writer.

**The gate and the import, as they would have been run. Neither command
resolves today — the workflow does not exist:**

```text
gh workflow run migrate-data.yml -f mode=inventory-gate
gh workflow run migrate-data.yml -f mode=rehearse -f target=production
```

The inventory gate must pass immediately before the import — a collection added
upstream in between is exactly what it catches.

**Verified when:** `reconciliation.summary.json` shows `failed: 0` on every
container. `social_posts` and `lab_agents` mismatches mean a writer is still
running.

`migration_writer_enabled = true` was on for this run and was never flipped
back. The readiness review of 2026-08-24 found all three assignments still live
on the CI identity, which is why the remediation branch **deletes** the
declarations rather than setting the gate to `false`: a gate is only off while
the workspace agrees with the checked-in default, and here it demonstrably did
not. `cosmos_scratch_enabled` and `storage_scratch_enabled` are deleted on the
same reasoning, together with the estate they created.

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
the first timer means setting **both**. Since 2026-08-24 both are workspace
variables: the master switch is `schedulers_master_enabled`, default `false`. It
was a hardcoded literal in `main.tf` until then, so `enabled_timers` could not
arm anything at all without a code change, and nothing on this page said so.

### The four gates

Do not advance if any of them fails. Each proves a different link, and the whole
point is that the earlier ones can pass while the later ones fail.

| # | Gate | Proves | How |
| --- | --- | --- | --- |
| 1 | **Deployment** | ARM holds the setting | `az functionapp config appsettings list ... --query "[?name=='FEATURE_FLAG_X']"` |
| 2 | **Runtime** | the *active worker* sees it | the startup log line — presence, never the value |
| 3 | **Behaviour** | the feature reads it | exercise whatever depends on the setting |
| 4 | **Invocation** | the timer actually fired | the timer's own durable side effect — since #321 that is the **primary** witness; `Function.<name>` traces exist only for history before 2026-09-02 17:59Z |

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
creates** — a document write, a queue message, a blob, a timestamp.

**Since 2026-09-02 17:59Z the telemetry half is gone, and the side effect is
the only witness.** #321 dropped `host.json`'s `Function` category to Warning
to take host verbosity off the daily cap. The `Executed` and `ScheduleStatus`
rows this step used to read are Information-level in that category, so the
host stopped writing them the moment that deploy landed. The #321 record
believed it had protected this gate by keeping `Host.Results` at Information —
but that feeds `AppRequests`, which `05-verify-timer.ps1`'s own header says has
been empty for the app's entire life (T-514). The cut kept the table the gate
never read and removed the one it did. Found 2026-09-03 when Wave 2's gates
returned nothing and the sweeper's history stopped dead at 13:00 CDT — the
deploy minute. Owner decision the same day: keep the cut, promote the witness.

`scripts/verify-timer-witness.mjs` reads the witness through the **public
API**, so it needs no `az`, no workspace, and no telemetry plane at all —
three fewer places for the observation to be lost:

```powershell
node scripts/verify-timer-witness.mjs --timer syncRssFeeds --since 2026-09-03T05:00:00Z
```

`--since` is the moment after which you expect a fire — the apply time, or the
last scheduled tick, in ISO 8601 UTC. **Success:** a `PASS` line naming the
witness, a document count, and a `newest` stamp at or after `--since`. `FAIL`
with a count of zero on a container this timer alone writes means it has never
run here. **Exit 2, `NO PUBLIC WITNESS`, is neither** — the timer's side effect
is not publicly readable, nothing was evaluated, and the table below says why.

| Timer | Public witness | Read by the script |
| --- | --- | --- |
| `syncRssFeeds` | `rss_cache.refreshedAt` re-stamped on every feed each run | yes |
| `fetchPodcastFeeds` | `podcasts.updatedAt` re-stamped on every episode each run — **`azure` is the only provider with a configured feed**, so only that page fills | yes |
| `publishScheduledContent` | a `content` document's `publishedAt` inside the window — only if something was actually scheduled; an empty window is not a failure | yes |
| `platformJobSweeper` | re-enqueues on a private queue | no |
| `monitorPublishingPipeline` | read-only watchdog; writes nothing | no |
| `checkAgentHealth` | stamps `lab_agents`, no public route | no |
| `cleanupTempStorage`, `cleanupUnusedCertImages` | dry-run until their `*_DELETE` setting; blobs are private | no |
| `fetchBlogListings`, `scrapeSkillsHubRss`, `forgeScheduled` | draft `content` for review; drafts are not public | no |
| `generateReviewerDigest` | sends mail; writes nothing | no |
| `checkLiveLinks`, `reVerifyCertifications` | annotate documents; the annotation is not projected publicly | no |
| `cleanupSoftDeletedContent` | deletes documents that were never public. **Dry-run until `CONTENT_HARD_DELETE`**, and a mark with neither `deletionRequestedBy` nor `softDeletedReason` is refused. Wave 3a's witness, decided 2026-09-04 (T-766): the per-category `host.json` override `"Function.cleanupSoftDeletedContent": "Information"`, which restores this timer's `Executed` rows and its one summary line per run, idle runs included; remove it when the wave closes | no |
| `cleanupRejectedContent` | marks aged rejections soft-deleted; the mark is reversible (cleared by any status change) and nothing public sees it | no |
| `syncSocialCalendarScheduled` | writes `social_posts`, no public route | no |
| `refreshPlaudToken` | rotates a secret | no |

The script's test asserts this table names exactly the timers the app
registers, so a new timer without a row fails CI rather than arriving at a
cutover with no gate. For a **no**-row timer the choices are to read its
container directly with data-plane access, or to raise that one category —
`"Function.<name>": "Information"` in `host.json` — for the wave and drop it
after, which restores the trace for one timer at a few lines per invocation
instead of the whole host's chatter. That is a per-wave decision, not a
default: every wave's choice is recorded in its row of the T-518 table in
CHANGELOG.md (T-766, closed 2026-09-05 once each row had one; the overrides
came out again on 2026-09-05 when the last wave closed).

If telemetry and the witness disagree, believe the witness.

### Then, per timer

```powershell
pwsh -File scripts/cutover/05-verify-timer.ps1 -Name syncRssFeeds -Hours 24
```

**Read this one for history only.** It still answers correctly for anything
before 2026-09-02 17:59Z — on 2026-09-03 it returned the sweeper's 37
invocations from before the cut with `-05:00` offsets on every `ScheduleStatus`
line, which is what retroactively settled Wave 1 — and it now warns at the top
of its invocation section when `host.json` gates `Function` above Information,
so a zero after the cut reads as "instrument off" rather than "timer dead".

The gate is not "did it run". It is "did it run at the intended **Chicago**
local time". That clock half came from the host's `ScheduleStatus` line and is
not available from a side effect; for a timer on local hours, compare the
witness stamp against the schedule by hand — a `refreshedAt` of `05:00Z` on a
`0 0 */2` timer is 00:00 CDT, which is the even-hour tick it should be.

### Superseded on 2026-09-02: the remaining timers are armed in waves

This step's "one timer per apply" rule was set when the arming mechanism was
unproven. It has since been observed three times, once across the apply
boundary itself, so the owner decided on 2026-09-02 to arm the remaining
fifteen in risk-grouped waves — recorded with its reasoning in TODO.md
under T-518, which is the live plan. Taken literally the rule cost roughly
five weeks and fifteen Function App restarts, three of the fifteen timers
being weekly.

**The four gates below are unchanged, and apply to every timer in a wave.**
So do both ordering constraints in the next section, and the two content
reapers — `CLEANUP_SOFT_DELETED_CONTENT`, dry-run until `CONTENT_HARD_DELETE`,
and `CLEANUP_REJECTED_CONTENT` — are still armed one per apply.

**Completed 2026-09-05: all 18 timers are armed.** Waves 1 and 2 were observed
through the gates; 3a and 3b were armed one per apply, 3a's delete switch
flipped after two zero dry-runs; waves 4, 5 and 6 armed together in the last
apply. The owner then dropped the per-wave observation read as a gate, so the
per-category `host.json` overrides came out the same day. The record, with
the wave table, is in CHANGELOG.md under T-518. This step is now history;
the gates stay documented for the next timer that is ever added.

### Order matters for two of them

- `SYNC_SOCIAL_CALENDAR` — not until after step 4, or Azure becomes a third
  writer to `social_posts` mid-import.
- `CLEANUP_TEMP_STORAGE` and `CLEANUP_UNUSED_CERT_IMAGES` stay **dry-run** even
  when armed, until `TEMP_STORAGE_CLEANUP_DELETE` / `CERT_IMAGE_CLEANUP_DELETE`
  are set. Arming the timer and arming the deletion are two decisions;
  conflating them is how a dry run becomes data loss (T-302).
- `CLEANUP_SOFT_DELETED_CONTENT` is the same shape with a third pin,
  `CONTENT_HARD_DELETE`, and one rule the pin does not lift: a document whose
  deletion mark records no origin — neither an admin's `deletionRequestedBy`
  nor the agers' `softDeletedReason` — is never deleted, only counted, and
  waits for a human in the admin content queue's `soft_deleted` filter. Arm
  it, read at least two dry-run summaries, then flip the pin.

### Before trusting telemetry as evidence at all

Confirm the plane itself is alive, once, at the start of the session. Both
commands need the `log-analytics` extension (Step 0, item 6); without it the
second one prompts on a stream you cannot see and hangs.

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
