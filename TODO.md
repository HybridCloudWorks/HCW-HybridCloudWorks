# TODO

**The one open-work document for the HybridCloudWorks website.** Engineering
work, owner decisions, production approvals, credentials, external access and
live-environment operations all live here. Verified completion belongs in
[CHANGELOG.md](CHANGELOG.md); the required-inputs inventory is
[Required-Inputs](wiki/Required-Inputs.md) in the Wiki.

`REVIEW.md` held the owner-gated half until 2026-08-29, and every item in it was
already mirrored here under **Gate: owner** so that this file could answer "what
is still open" on its own. Two files, one restating the other, is one file too
many. Its work sections are below, unabridged.

**Nothing changed about what those items require.** Nothing here is resolved by
an engineer working from a checkout if it needs tenant, Cloudflare or
repository-admin access — the carried-over sections say so in their own words,
and `Gate: owner` still marks the rest.

## Status — 2026-08-28

> **The Blog Machine program and four remediation passes are closed.** All
> seven Blog Machine phases (T-601…T-607) and 55 of the architecture review's
> 62 findings are merged; their entries are in [CHANGELOG.md](CHANGELOG.md),
> the per-finding record is
> [wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md),
> and the program of record is [wiki/Blog-Machine.md](wiki/Blog-Machine.md).
> Nothing about that work is repeated below; this file carries only what is
> still open.
>
> **T-526 is closed, and this file was wrong about it.** The Telegram webhook
> was already registered against Azure — `getWebhookInfo` on 2026-08-28 returned
> `https://api-azure.hybridcloudworks.com/api/telegram/webhook`, and `/help`
> answered in the chat, which is the acceptance criterion this file itself
> specified. It had been carried here as "the one deadline on this list" and a
> countdown against the GCP deletion, for work that was already done. Nobody
> re-ran anything to close it; running `-Mode Show` to *start* the work is what
> revealed it. Entry in [CHANGELOG.md](CHANGELOG.md).
>
> **There is no deadline on this list any more.** The GCP deletion no longer
> silences anything, which was the only time-bound consequence here.
>
> The `hcw-azure` workspace is **VCS-connected** (2026-08-26), working
> directory `infra`, auto-apply off. Merged infra code reaches HCP Terraform on
> its own; before that it only arrived when someone ran `terraform` from a
> checkout, which is why several merged changes sat unapplied.

| Priority | Open items |
| --- | ---: |
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 1 |
| Total | 6 |

Four of the six are architecture-review findings still to be worked
(`T-714`, two Medium — both owner-gated — and one Low). The other
two are the pre-program platform gates: **T-518** (High) and **T-519**
(Medium). Both carry **Gate: owner** and have no repository-side half — what is
left of them is a Worker deployment and a set of feature flags, each needing
tenant or edge access. They are listed anyway, because a tracker that omits
them is quietly shorter than the truth.

**T-522 moved to [issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)**
on 2026-08-26 — the recovery objectives and the Cosmos export that would
support them, joined on 2026-08-28 by the remainder of T-707 (an out-of-account
copy of media, which no account setting can provide). Neither is closed and
neither is abandoned; both are tracked where a feature with a design, a cost
model and acceptance criteria belongs, rather than as a tracker line that only
ever said "two numbers are missing".

## Owner actions left behind by closed findings

These are the residue of remediated findings: the code half is merged and
in [CHANGELOG.md](CHANGELOG.md), and what remains needs access this repository
does not have. They are not counted in the nine above, because the
engineering work on them is done.

- **`production` deployment-branch rule (from T-705).** Reduced to one setting
  by an owner decision on 2026-08-29: **required reviewers are deliberately not
  configured**, because this is a single-operator estate and a reviewer you
  approve yourself is not a control — it is a click that produces an audit
  trail implying oversight that did not happen. The half that still matters and
  costs nothing: Settings → Environments → `production` → Deployment branches →
  *Selected branches* → `main`. Without it the environment-scoped federated
  credential matches from any branch, so `workflow_dispatch` can ship an
  unreviewed ref past all 12 required contexts. The guard step in both
  workflows stays as the backstop — nothing in a checkout can prove an
  environment rule set outside the repository is still set.
- **Action-group delivery test (from T-709).** An optional SMS receiver is
  wired as an independent second channel, via a `dynamic` block so an unset
  variable leaves the action group byte-identical. Run
  `az monitor action-group test-notifications` and set `ops_sms_receiver`;
  delivery has still never been observed.
- **Ruleset bypass for the manifest push (from T-726).** The workflow is now
  two jobs, so nothing holding `contents: write` also holds the Azure identity
  or runs `npm ci`. What remains: for that push to land on a main protected by
  twelve required contexts, the ruleset must bypass the Actions token — so
  every workflow with `contents: write` can push past all checks. Narrow the
  bypass to a deploy key scoped to `frontend/data/content-manifest.json`, or
  replace the push with an auto-merging pull request.
- **Retire or gate the SWA token (from T-727).** It is the estate's last
  long-lived credential and is now isolated in a job that installs nothing.
  Retiring it means OIDC-based SWA deployment; short of that, make it an
  environment secret on a *protected* `production` and set a rotation cadence.
  Recorded as an accepted exception in [TODO.md](TODO.md).
- **A TFC API token for the plan assertion (from T-724).**
  `scripts/assert-expected-plan.mjs` fails when a plan contains anything but the
  known permanent diff, but the plan lives in HCP Terraform and
  `iac-validate.yml` has no workspace token, so it is run by hand today.
  **`scripts/check-tfc-plan.mjs` is now that hand-run**, in one command:

      TFC_TOKEN=... node scripts/check-tfc-plan.mjs

  It resolves the workspace's latest run, fetches the JSON plan, calls
  `checkPlan` directly and reports the verdict. Needs a HCP Terraform **user or
  team** token with admin access to `hcw/hcw-azure` — an *organization* token
  cannot read `json-output` and fails with 404, which reads like a missing plan
  rather than a permissions problem. Wiring the same check into
  `iac-validate.yml` needs that token as a repository secret and is still open;
  the script is already Node so it runs on `ubuntu-latest` unchanged.
- **A scheduled-query alert on `unresolvedSecrets` (from T-720).**
  `/api/health` now reports how many app settings arrived as an unresolved
  `@Microsoft.KeyVault(…)` reference. It is 0 in a healthy estate; an alert on
  "greater than 0 for 15 minutes" turns four silent failure classes into one
  page. Needs an apply.
- **Vault seeding and seeded documents (from the Blog Machine program).**
  `PREVIEW-SIGNING-SECRET` (staging links; the preview route 404s and
  notifications say "link unavailable" until then), `REPLICATE-API-KEY` (AI
  heroes; the default heroes cover its absence once the ~8 covers are uploaded
  and `admin_config/default_heroes` is seeded), and
  `admin_config/social_autopost` `{ enabled, accountIds: [{ id, provider }],
  scheduleDelayMinutes }` with the Publer account ids from the Social Hub.
  Absent or disabled, every one of these paths no-ops rather than failing.
- **`GCP-BILLING-API-KEY`, if the GCP column in the public pricing tool is
  wanted.** GCP console: enable the Cloud Billing API, create an API key,
  restrict it to that API. It reads a public price list for the site's
  comparison tools — this estate bills on Azure and nothing here touches that.
  Unseeded, the GCP column is absent and the AWS and Azure columns still render.

**These are now portal work, not desktop work.** Every secret above is seeded at
**Admin → Platform → API Keys**, which writes straight to Key Vault through a
role that can create a secret version and cannot read one. No firewall window,
no `admin_ip_rules` apply, no Azure CLI. `scripts/cutover/06-seed-secret.ps1`
stays as the break-glass path for the case the page cannot serve — the app being
down is exactly when you might need to fix a credential. Two things still need
a Terraform apply first, because they are new: the page's own role assignments,
and the `FUNCTION_APP_RESOURCE_ID` setting that the refresh call reads.

## The architecture review — open findings

Six specialist reviews, one per technology layer, run against merged main at
`31f9613`: Azure platform, Terraform IaC, backend Functions, frontend React,
CI/CD, and the remaining ops surfaces (Cloudflare Worker, PowerShell scripts,
Python harness, VPS agent). 62 findings, `T-701`…`T-762`; **55 resolved** as of 2026-08-28
(#249 records; #250, #257, #258 and the CI/Terraform pass remediate).

**The review of record is
[wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md)** —
it carries the method, the evidence standard, every finding's failure mode,
recommendation and outcome, the cross-cutting observations, and the areas that
came back sound, organised by layer. The entries below carry only what "open"
means for each finding, in the order they should be worked. This split follows
the Blog Machine precedent: the Wiki holds the narrative, this file holds the
list.

Every finding cites `file:line`. Three evidence levels are distinguished in the
Wiki page: **verified** (re-read against the code by a second reader after the
finding was written), **reported** (the anchor resolves but no second reader
re-derived it), and **verify** (could not be settled from the repository —
exactly one finding, T-705).

Deliberately **not** re-reported, being owner gates rather than findings:
T-518, T-519, the unseeded Key Vault secrets, the unseeded
`admin_config` documents, and the absent analytics provider.

### High — 1 of 12 open

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-714 | frontend | **Needs an owner decision.** The 104 pre-rendered documents are discarded at boot (`createRoot`, not `hydrateRoot`). The seed mechanism exists but is deliberately never mounted in the browser, and switching to `hydrateRoot` without wiring it trades a spinner for hydration mismatches on every page. This is an architectural change needing real-browser verification, not a quiet fix | `main.jsx`, `hooks/prerenderData.js` |

### Medium — 2 of 30 open

**Open, owner-gated:** T-719 (measure workspace volume on an uncapped day),
T-721 (telemetry vs SWA tier cost decision).

### Low — 1 of 15 open

| ID | Layer | Finding | Anchor |
| --- | --- | --- | --- |
| T-749 | ci | SCM lock flip — **Gate: owner**, overlaps T-520 | `functionapp.tf`, workspace variable |

## High

### T-518 — 16 of 18 timers are still no-ops; the mechanism is proven

**Gate: owner** — [TODO.md](TODO.md), *Timers and the availability test*.

`functions/src/functions/schedulers.js` checks `FEATURE_FLAG_SCHEDULERS` first
and skips the handler *before* reading the per-timer flag. Until 2026-08-24 that
setting was a hardcoded literal in `main.tf`, which meant `enabled_timers` could
not arm anything at all and no document said so; it is now
`var.schedulers_master_enabled`. Arming needs **both** it and a name in
`enabled_timers`, through the four gates in
[Cutover-Runbook](wiki/Cutover-Runbook.md) step 5 — where the acceptance
criterion is the observed invocation, not the applied setting.

**The master switch went `true` on 2026-08-30**, with `CHECK_AGENT_HEALTH` and
`CLEANUP_TEMP_STORAGE` in `enabled_timers`. The remaining sixteen are still
no-ops, so the platform still runs almost no scheduled work — but "nothing is
scheduled" is no longer true, and the arming mechanism is no longer an
assumption.

It gates two other things, which is why it outranks its own blast radius:
the Blog Machine's scheduled throughput (`forgeScheduled`,
`publishScheduledContent`), and the Cosmos backup-tier change from T-707,
which only pays for itself once scheduled work is generating documents. It also
gates any meaningful cost measurement — a bill taken while nothing is scheduled
prices an idle platform (Migration-Plan §7).

**Both halves of the gate passed on 2026-08-30.** The clock half needed nothing
armed: `app.timer()` registers on the real schedule unconditionally and the flag
is checked *inside* the handler, so every timer had been firing since deploy and
logging `disabled — skipping`, with the host writing `ScheduleStatus` carrying
`WEBSITE_TIME_ZONE` offsets each time. `cleanupTempStorage` reported
`"Last":"2026-08-29T00:00:00.005764-05:00"`, `"Next":"2026-08-30T00:00:00-05:00"`
— local midnight, offset applied, which is the §7 comparison delivered by the
platform rather than computed by a script.

The handler half came from `checkAgentHealth` after arming: twelve invocations
between `04:55:00Z` and `05:50:00Z`, exactly five minutes apart with no gaps, no
`disabled — skipping` anywhere in the window, and the handler's own
`[checkAgentHealth] 0 agent(s) marked offline` on each one. Host row and `.User`
row are separate emitters, which is what "two independent witnesses" means; the
zero is a correct no-op, not a missing witness.

Two departures from the runbook are worth recording. Both timers were armed in a
single apply rather than one at a time — safe here only because
`TEMP_STORAGE_CLEANUP_DELETE` pins `cleanupTempStorage` to dry-run
(`functionapp.tf`), so the second timer could not touch data. And the evidence
above was read with direct KQL, not through
`scripts/cutover/05-verify-timer.ps1`: that script reported a tally of tens of
thousands of invocations for a query returning two rows, and was rewritten the
same day to aggregate in the workspace instead. Its miscount was never
root-caused — see the note above its query.

The sixteen that remain go one at a time, each observed firing before the next
is added.

## Medium

### T-519 — Reachability is the one signal with no alert behind it

**Gate: owner (Worker deploy)** — [ADR 0024](wiki/0024-edge-availability-probe.md);
[TODO.md](TODO.md), *Timers and the availability test*.

`availability_test_enabled` defaults to `false` and both the standard web test
and its alert are gated on it, for a measured reason: Cloudflare's Bot Fight
Mode serves datacenter clients — which is exactly what Azure's availability
agents are — a 403 interstitial for `https://api-azure.<domain>/api/health`,
and a WAF skip rule against it was built, applied and confirmed **inert**,
because Bot Fight Mode does not run on the Ruleset Engine. It matters more
than one rule out of six suggests: every other alert needs the app healthy
enough to emit telemetry, and reachability is the only signal that survives
the app being completely down.

**The gate changed shape on 2026-08-28.** ADR 0024 routes around Bot Fight
Mode instead of waiting on it: `edge/availability-probe` is a Cloudflare
Worker on a 5-minute cron whose same-zone subrequest is not challenged,
reporting every `/api/health` attempt to Application Insights, with a
success-counting alert (`edge_probe_availability`, gated on
`availability_probe_alert_enabled`, default `false`) in the same fabric as
every other rule. What remains is owner-held but no longer a plan decision:
deploy the Worker with wrangler, seed the connection-string secret, observe a
`success == 1` row, then flip the variable
([Availability-Probe](wiki/Availability-Probe.md) is the procedure). The standard
web test stays in Terraform, disarmed, for the day #127 upgrades the plan.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [TODO.md](TODO.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

## Owner-gated work, carried from REVIEW.md

Everything from here to the end arrived from `REVIEW.md` on 2026-08-29. These
need tenant administration, production approval, a credential, external access,
or a live confirmation — none of them can be closed from a checkout.

**One section was deleted rather than carried: "Immediate: restore admin
access".** It described a live `403` from `POST /api/bootstrapCurrentUserAdmin`
and asked for the Entra `Admin` app role to be assigned. The owner confirmed on
2026-08-29 that the admin portal loads and signs in immediately, so the role is
assigned and the 403 is gone. It had been sitting at the top of the document
marked *Immediate* — the loudest item in the tracker, describing something that
was already fixed. The `Admin` app role assignment survives as one clause of the
Entra row below, which is where it belongs.

## Owner decisions and external access

| Item | Human action required | Safe repository-side state |
| --- | --- | --- |
| Entra application | Confirm SPA client ID, tenant ID, API audience/scope, redirect URIs, consent, and the `Admin` app role assignment | `frontend/.env.example` documents names; no client secret is committed |
| Frontend release | Approve whether releases remain manual or become push-triggered; provide/rotate the Static Web App deployment credential through the approved Azure/GitHub path | `deploy-azure-frontend.yml` stays dispatch-only |
| Production infrastructure | Approve HCP Terraform plan/apply and any DNS, custom-domain, or Cloudflare changes | Terraform remains the infrastructure source of truth |
| Timers and the availability test | Decide whether to arm the 18 schedulers (`schedulers_master_enabled`, then `enabled_timers` one name at a time) and the `/api/health` availability test (`availability_test_enabled`). All three are workspace edits in `hcw-azure` | Every one defaults to the safe value, so the repository state is "nothing armed" and stays that way without a decision. Arming the availability test needs a Cloudflare change first: Bot Fight Mode answers Azure's availability agents with a 403, and a WAF skip rule against it was built, applied and confirmed inert |
| Recovery objectives | State the RTO and RPO the platform is held to, so backup and recovery settings are measured against a number instead of chosen (S6). Tracked as **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)** since 2026-08-26, with the design, cost model and acceptance criteria | Cosmos carries continuous backup on the free 7-day tier and both storage accounts carry versioning and soft delete — but both are `LRS`, and every mechanism sits inside the subscription it protects, so none of it survives account loss. None of it is justified against a stated objective, and nothing here has ever been recovery-tested |
| Key Vault | Provide only the secrets needed by enabled features; never put values in GitHub variables or Vite config. **The approved procedure changed on 2026-08-29**: seeding is now **Admin → Platform → API Keys**, and the desktop script is break-glass rather than the default path | Code reads secrets server-side and degrades optional integrations when absent |
| Function App vault write (decided 2026-08-29) | **Approved.** The app may create new secret versions, through a CUSTOM role holding only `Microsoft.KeyVault/vaults/secrets/setSecret/action` — not `Key Vault Secrets Officer`, which would also grant get, list, delete and purge. It may also refresh its own Key Vault references (`Microsoft.Web/sites/config/Write`, scoped to the one site, with `config/list/action` excluded so it cannot read its settings back). Weighed against what it replaces: the previous procedure opened the production vault's firewall to a human IP on every rotation, and left it open once | The app cannot read a secret back out of the vault, cannot delete one, and cannot enumerate its own app settings through ARM. `/api/cms/secrets` is `super_admin` on both verbs and returns no value in any response — asserted by scanning the whole serialised body, not by trusting a field list |
| GCP pricing integration | Seed `GCP-BILLING-API-KEY` if the GCP column in the public pricing tool is wanted, or leave it unseeded and that column stays absent. Get it from the GCP console: enable the Cloud Billing API, create an API key, restrict it to that API. **This is not a billing credential** — the Cloud Billing Catalog API serves the public price list, and it is read for the site's comparison tools, not for anything this estate is charged for | No GCP credential is stored in the repository. The service-account JSON this row used to ask for is retired (2026-08-29): the API key is what Google documents for this API, and it removed a vault SDK client, an OAuth library and a bespoke seeding script |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- **Observe an alert actually being delivered.** `az monitor action-group
  test-notifications` against `ag-ops-prod-cus`, then set `ops_sms_receiver` so
  there is a second channel independent of email. The optional SMS receiver is
  merged and inert until the variable is set; delivery through *either* channel
  has never been observed, which means the alerting fabric is unproven end to
  end no matter how many rules are enabled ([TODO.md](TODO.md), from T-709).
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.
- Apply the Terraform change that creates the `listenandlearn` blob container.
  Until it runs, Listen & Learn generation saves episodes and their transcripts
  but the audio upload has nowhere to land. The same apply declares the fallback
  `AZURE_SPEECH_*` settings, which stay unresolved and inert.

## Accepted risks

A decision to live with a finding rather than fix it. An accepted risk with no
record is indistinguishable from an unfixed one: the next reviewer re-raises it,
or someone "fixes" it without knowing it was a choice.

| Risk | Accepted | Reasoning, and what compensates |
| --- | --- | --- |
| **Key Vault purge protection is off** on `kv-site-prod-cus-01`, which holds 18 live secrets. Raised as Go-Live blocker B2 on 2026-08-24 | Owner, 2026-08-24 | Enabling it is a **one-way** switch: once on it cannot be turned off, a deleted vault can no longer be purged, and its name stays reserved for the retention period — which removes the teardown-and-recreate path a single-environment estate depends on. The secrets are seeded and resolving, so the exposure is not "unprotected during setup". Compensating control: soft delete at 90 days, which still makes an accidental delete recoverable. What is given up is protection against a *deliberate* purge by someone already holding the rights to perform one. Recorded in the same terms in `infra/variables.tf` and `infra/README.md` |
| **The Static Web Apps deployment token is a Terraform output** (`swa_token`), which `outputs.tf`'s own header otherwise says does not exist. Raised as T-722, 2026-08-28 | Recorded 2026-08-28; owner decision outstanding on retiring it (T-727) | The token is in state via `azurerm_static_web_app.hcw.api_key` whether or not the output exists, so deleting the output would hide it rather than retire it. `sensitive` keeps it out of logs and plan output; it is still visible on the HCP Terraform Outputs tab to anyone with state read. It is the estate's **last long-lived credential** — everything else a workflow uses is federated OIDC. Compensating control, 2026-08-28: `deploy-azure-frontend.yml` now isolates it in a job that installs nothing, so a compromised build dependency cannot reach it (T-727). Retiring it means moving the SWA deploy to OIDC, or at minimum making this an environment secret on a *protected* `production`; both need owner access. The `outputs.tf` header now names the exception instead of contradicting it |
| **`cloudflare_origin_secret` is a real shared-secret value in Terraform state.** Raised as T-723, 2026-08-28 | Recorded 2026-08-28 | Unavoidable rather than chosen: Terraform configures the Cloudflare end of the origin handshake, so the value has to pass through it. It was simply never written down, which is the part that is fixed here. **Rotation consequence, which is the reason this needs a record:** the value must change in three places in one window — the HCP Terraform workspace variable, Key Vault `CF-ORIGIN-SECRET`, and the Cloudflare transform rule Terraform writes — and a mismatch throws on *every anonymous request*, so a partial rotation is a full outage of the public API rather than a degradation. The companion exposure — the azapi read-back exporting the whole live app-settings map into state — is not accepted but *bounded*: it is safe only while every secret-shaped setting is a Key Vault reference, and `functions/src/functions/app-settings-secrets.test.js` now fails CI if one is not |

## Handling rules

- Never paste secret values, private keys, access tokens, or personal data into
  this file, issues, logs, or the Wiki.
- A missing credential is not an engineering task. Record its name, owner, and
  approved storage location only.
- Historical migration pages and the two archived plans are evidence, not
  current instructions for restoring Firebase services.

---

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
