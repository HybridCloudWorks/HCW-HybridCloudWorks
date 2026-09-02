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

## Status — 2026-09-02

> **Two items are open. Neither can be closed from a checkout.** Each carries what
> to run or click, and what a successful result looks like, so a real failure
> can be told apart from a reporting failure.
>
> **The one live degradation closed overnight.** `T-763` — the manifest route
> merged on 2026-08-30 against a Function App last deployed 84 minutes earlier —
> was fixed by Deploy Functions run 81 at 2026-08-31 23:45 UTC. Verified rather
> than assumed: manifest run 11 at 2026-09-01 00:06 went green end to end and
> reported "No change to the published set", so the committed manifest already
> matched what the API serves. Recorded in CHANGELOG.md and removed from this
> list.
>
> **The detection gap is closed — `T-519` was armed on 2026-09-01.** The probe's
> secret held the Instrumentation Key rather than the connection string; the
> piped command in `edge/availability-probe/wrangler.toml` replaced it, twelve
> `success == 1` / HTTP 200 rows landed on the `*/5` cadence before arming
> (a full PT30M window needs six), and the apply created
> `alert-api-reachability-prod-cus` in `rg-web-site-prod-cus`. The registered
> function count was 122 before and after the apply's restart. Recorded in
> CHANGELOG.md and removed from this list.
>
> **`T-719` and `T-721` closed on 2026-09-02, by owner decision.** The host
> verbosity is cut at the source (#321, `host.json` `default` and `Function` to
> Warning), the deploy was dispatched the same day, and the owner closed both
> without gating on the cap-day reading — the below-cap volume is expected
> confirmation, not a closure criterion. The accepted risk (log alerts sleep
> if the cap ever binds again) is recorded below; the Basic-table-plan move
> stays in reserve in CHANGELOG.md if the reading ever says the cut was not
> enough. What remains is one observation and one procedure.
>
> **The architecture review is closed.** All 62 findings (`T-701`…`T-762`) are
> resolved or carried below as owner gates. The per-finding record — method,
> evidence standard, every failure mode and outcome — is
> [wiki/Architecture-Review-2026-08.md](wiki/Architecture-Review-2026-08.md),
> which is now a dated historical document rather than a live list. Its last
> three owner-gated findings are all closed — `T-749` on 2026-08-31,
> `T-719` and `T-721` on 2026-09-02.
>
> **The `hcw-azure` workspace is VCS-connected, and auto-apply is off.** Merging
> infra code queues a plan that waits for approval at
> https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs — it does not
> apply on its own, and `terraform apply` from a desktop is refused outright.
> Every run carries the permanent diff, which replaces three `azapi` resources
> and restarts the function app.
>
> This file was wrong about that twice in opposite directions, and the reason is
> worth keeping: HCP Terraform's workspace **Description** is free text beside
> the real settings, validated by nothing, and it read "CLI-driven; no VCS
> connection". That sentence was read and reported as configuration. Corrected
> in the workspace on 2026-08-31. A field that contradicts its own workspace
> reads exactly like a setting.

**This table is the list below, and nothing else.** An earlier version counted
five, because the two owner actions left by closed findings were tracked in a
different section from the five findings that carry `T-` numbers — so the
summary said five above a list of seven. That is the T-722 defect, in the
document restructured to prevent it, and it is why there is now one table
rather than a count and a list that can drift apart. Found by review, 2026-08-31.

| # | Open item | Priority | What closes it |
| ---: | --- | --- | --- |
| 1 | `T-726` — the nightly refresh cannot reach `main` | — | Built and configured; waits on the first content change to prove |
| 2 | `T-518` — arm the remaining 15 timers | High | A repeated, observed procedure |

Item 1 carries no severity because it is not a review finding: it is an owner
action left behind by a finding that is closed. Item 2 is a repeated,
observed procedure.

**The table and the sections below are in the same order, and that order is the
one to work them in — not a sort of the Priority column.** Item 1 carries no
severity at all and still sits above a High, because there is nothing left to
run on it — it waits on the first content change, which any published article
supplies in passing. Said this way because an earlier draft claimed "ordered by
priority", which the dash in row 1 plainly contradicts; found in review on
2026-09-01.

The two are checked against each other by number AND by `T-` identity, never by
counting rows. Also from 2026-09-01: an edit reordered the table while
renumbering the sections in document order, and because both still read `1..5`
a digits-only check passed with every row pointing at the wrong section.

**Closed on 2026-08-31 and removed from this list:** seeding `TFC_TOKEN` (done),
and `T-749`, the SCM lock — Terraform owns
`scm_ip_restriction_default_action`, a live read shows `Deny all`, so the
variable is already `true` and the last Deploy Functions run succeeded on
2026-08-30 at 01:21 UTC. The tracker had it open against a reality where it was
applied.

## The attack sequence — one working order across everything open

This section sequences what the rest of this file already tracks; it adds no
items and restates no procedures. Each phase points at the one section that
carries the commands and the success criteria, so this list cannot drift from
those sections the way a restatement would — the T-722 lesson, applied in
advance. The ordering rule is dependency, not priority: the timers arm after
the verbosity cut has deployed, so their volume lands in real headroom.

| Phase | What | Where the procedure lives | Why this position |
| ---: | --- | --- | --- |
| 1 | ~~Fix the probe's secret, wait for six `availabilityResults` rows, arm the reachability alert (`T-519`)~~ | **Done 2026-09-01** — record in [CHANGELOG.md](CHANGELOG.md) | Twelve healthy rows, `alert-api-reachability-prod-cus` live in `rg-web-site-prod-cus`, function count 122 before and after the restart |
| 2 | ~~Settings sweep: delete the three stale workspace variables, set the `production` deployment-branch rule, decide the two ruleset booleans~~ | **Done 2026-09-02** — record in [CHANGELOG.md](CHANGELOG.md) | Three variable rows deleted; `production` restricted to `main`; ruleset decided: branches must be up to date before merge, thread resolution not required |
| 3 | ~~Cut the host verbosity at the source (`T-719`), pull `T-721`'s lever~~ | **Done 2026-09-02** — record in [CHANGELOG.md](CHANGELOG.md) | Closed by owner decision with #321 merged and the deploy dispatched; the below-cap cap-day reading is expected confirmation, not a gate. The SWA tier question moved to [Owner decisions](#owner-decisions-and-external-access) |
| 4 | Arm the remaining 15 timers, one at a time, each observed before the next (`T-518`) | [Section 2](#2-t-518--arm-the-remaining-15-timers--repeated-procedure); the four gates are [Cutover-Runbook step 5](wiki/Cutover-Runbook.md) | After the verbosity cut has deployed (#321), so timer volume lands in real headroom rather than darkening the log-based alerts |
| 5 | Prove the nightly refresh's App-token path (`T-726`) | [Section 1](#1-t-726--built-and-configured-unproven-until-content-moves) | Passive — the first published content change is the test. Publishing anything in Phase 6 doubles as this proof |
| 6 | Optional features: seed the keys and documents you actually want; decide which dark provider sections go live | [Optional, and only if you want the feature](#optional-and-only-if-you-want-the-feature); the provider-pages row in [Owner decisions](#owner-decisions-and-external-access) | Decisions, not repairs — nothing above depends on any of them |
| 7 | Live confirmations as they come due: Entra token claims, the timed restore against RTO 8 h / RPO 24 h ([issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)), third-party webhooks, the authenticated Labs check | [Live confirmation still requiring an authorized operator](#live-confirmation-still-requiring-an-authorized-operator) and [Test coverage follow-up](#test-coverage-follow-up) | Each needs a live environment or a third party on its own schedule; none blocks Phases 1–5 |

The deliberately unscheduled feature backlog — analytics-informed topic
weighting, the voice-drift monitor, stale-post refresh, A/B titles, the
duplicate-angle advisor — stays in
[Blog-Machine § Backlog](wiki/Blog-Machine.md) on purpose: none of it is open
work, and pulling it here would turn this file into a wish list. The one
backlog entry that is also a real route gap, `createContentFromRecording`,
already lives in the AI-providers and third-party rows of
[Owner decisions](#owner-decisions-and-external-access) — it stays in
`.azure/api-surface.json` `notImplemented` until its provider credentials
exist.

## What is open, and exactly what closes it

### 1. T-726 — built and configured; unproven until content moves

**Corrected 2026-08-31, and the correction is the important part.** This item
said, in five places across the repository, that the ruleset listed the Actions
token as a **bypass actor**, and that the App retired that bypass. It does not
exist. Reading
`/repos/HybridCloudWorks/HCW-HybridCloudWorks/rulesets/20680114` returns
`enforcement: active`, **no `bypass_actors`**, and the rules `deletion`,
`non_fast_forward`, `pull_request`, `required_status_checks`.

So the nightly push to `main` was never privileged — it was **refused**, and had
been since the ruleset was last updated on 2026-08-25. The bot's only successful
manifest push is `4b8c36d`, dated 2026-08-23. Every scheduled run from 08-24 to
08-29 reported success because the published set had not moved, so the push was
never attempted. A workflow can be broken for five days and go green every
night, if the only thing that would exercise the broken part is a change that
did not happen.

The App is therefore a **repair**, not a de-escalation, and the third owner
action this item used to carry — "remove the bypass actor" — is deleted, because
there is nothing to remove. The workflow, `scripts/github-app-token.mjs`,
`scripts/open-manifest-pr.mjs` and
`scripts/workflow-write-permissions.test.mjs` all carried the wrong claim and
now carry the correction beside it.

**The repository half is done (2026-08-31).** `publish-content-manifest.yml`'s
`commit` job no longer pushes to `main`. It mints a GitHub App installation
token, pushes a branch and opens a pull request that the required checks run on
— which they do precisely because the pull request is not opened with
`GITHUB_TOKEN`. The job's own permission is now `contents: read`, and
`scripts/workflow-write-permissions.test.mjs` is down to one entry.

**Owner action 1 — create the App, and find the App ID.** The App itself is
created at
https://github.com/organizations/HybridCloudWorks/settings/apps/new — repository
permissions **Contents: Read and write** and **Pull requests: Read and write**,
nothing else, no webhook. Install it on this repository only, then generate a
private key.

**The App ID is not the number in the URL you land on after installing.**
Installing redirects to `.../settings/installations/<number>`, and that number
is the *installation* ID — a different thing, and not what
`scripts/github-app-token.mjs` signs with. The App ID is on the App's own
**General** tab, in a field labelled `App ID`, a six- or seven-digit number.
Reach it from the list of Apps this organisation owns:
https://github.com/organizations/HybridCloudWorks/settings/apps — click the App,
and it is near the top of the General page beside the App's name and slug.

Store both here:
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/variables/actions
— variable `MANIFEST_APP_ID` (that six- or seven-digit App ID), and at
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/secrets/actions
— secret `MANIFEST_APP_PRIVATE_KEY` (the whole PEM, `-----BEGIN` line included).

**Success:** the next nightly run that finds a change opens a pull request
titled `chore: refresh content manifest (N article routes)`. Until both are set
the job warns that the App is not configured and does nothing else — it does not
fail. If the App ID is wrong, the mint step fails with a **401** and the script
says so; if the App exists but is not installed here, a **404**.

**Owner action 2 — enable auto-merge.** ✅ **Done 2026-09-01.**
https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings → Pull
Requests → **Allow auto-merge**.

**Both owner actions are done as of 2026-09-01**, and one open question about
them is now answered from evidence: the ruleset's `pull_request` rule requires
**0 approving reviews**, so nothing blocks the pull request from merging itself
once the checks pass. Every pull request merged on 2026-08-31 and 09-01
(#301-#308) went in with no `APPROVED` review on it — #308 carried two, both
`COMMENTED` — and with no bypass actors on the ruleset each of those merges had
to satisfy the rule on its own terms.

**What is still unproven, and only content can prove it:** the App path runs
only on a night the published set has actually moved. Manifest run 11
(2026-09-01 00:06) went green and reported "No change to the published set", so
every step after that check was skipped, the mint and the pull request
included. The first article published is the test. A wrong App ID fails the
mint with **401**, an App not installed here with **404**, and each is named in
the step's own error.

**What this costs, stated plainly and no longer offset:** one stored
non-expiring App private key, granting push-a-branch and open-a-pull-request on
this repository. It cannot merge past a check and it cannot push to `main`,
because the ruleset exempts nobody. Calling it "strictly less than what it
replaces" — as this file did — was only true of a bypass that was never there.
The honest case is narrower: the nightly refresh has to reach `main` somehow,
every route to `main` goes through a pull request, and a pull request opened
with `GITHUB_TOKEN` runs no checks. The key is the price of that.

**Still untested end to end, and worth knowing why.** Manifest run 11
(2026-09-01 00:06) went green for the first time since the route was deployed,
but it reported "No change to the published set" — so every step after that
check was skipped, the App branch included. The first real exercise of this path
is the first run where the published set has actually moved.

### 2. T-518 — arm the remaining 15 timers — repeated procedure

Three of eighteen are armed and observed: `CHECK_AGENT_HEALTH`,
`CLEANUP_TEMP_STORAGE`, `PUBLISH_SCHEDULED_CONTENT`. `schedulers_master_enabled`
is already `true` and `enabled_timers` is the HCL-typed workspace variable
holding those three.

For each remaining timer, one at a time: add its name at
https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables, approve the run,
then observe it firing before adding the next. The evidence standard is the
observed invocation, not the applied setting — `wiki/Cutover-Runbook.md` step 5
has the four gates.

```powershell
pwsh -File scripts/cutover/05-verify-timer.ps1 -Name publishScheduledContent -Hours 24
```

**Success:** a single summary row with a plausible invocation count and a
`ScheduleStatus` section filtered to that timer. If the count barely changes
between `-Hours 1` and `-Hours 24`, stop — that was the signature of the query
truncation fixed on 2026-08-31, and it means the window is not being applied.

**Note on volume:** arming timers adds `AppTraces` volume. The host
verbosity cut (T-719, closed 2026-09-02, #321) is what made room for it —
if a cap-day reading after arming shows the workspace back near 0.25 GB,
the Basic-table-plan reserve lever in the T-719/T-721 CHANGELOG record is
the next move.

## Optional, and only if you want the feature

None of these blocks anything. Each path no-ops when its key is absent; seed at
**Admin → Platform → API Keys**, which writes straight to Key Vault through a
role that can create a secret version and cannot read one:
https://hybridcloudworks.com/admin/api-keys

| Secret or document | What it turns on | Without it |
| --- | --- | --- |
| `REPLICATE-API-KEY` | AI-generated hero images | The default-hero fallback covers it, once the covers below exist |
| ~8 cover images + `admin_config/default_heroes` | A deterministic hero per provider when generation is off or fails | Posts publish with no cover |
| `admin_config/social_autopost` | Scheduled social posting. Shape: `{ enabled, accountIds: [{ id, provider }], scheduleDelayMinutes }`, with Publer account ids from the Social Hub | No autoposting |
| `YOUTUBE-API-KEY` | Listen & Learn "watch next" links. ~505 of 10,000 daily quota units per certification | Episodes publish with an empty video list |
| `GCP-BILLING-API-KEY` | The GCP column in the public pricing tool. GCP console → enable the Cloud Billing API → create an API key → restrict it to that API. **Not a billing credential** — it reads Google's public price list | The GCP column is absent; AWS and Azure still render |

`GEMINI-API-KEY` already covers Listen & Learn speech; nothing to provide.

## Watch out for

- **Deployment drift is now measured, not noticed.**
  `.github/workflows/monitor-deploy-drift.yml` runs every four hours and fails
  when a service has been behind `main` for **24 hours or more**, emailing the
  owner the way the other monitors do. A failure names the service, the number
  of undeployed commits touching its paths, and the subject of the oldest one.

  **The fix is to dispatch that service's deploy.** Both are dispatch-only by a
  recorded decision, so merging never ships them; this check is the thing that
  says so. Deploying clears it on the next run.

  It measures AGE, not commit count, and that is the whole design: the manifest
  404 was **one** commit behind and the frontend was **thirty-five**. No count
  threshold separates those. Both had sat undeployed for days.

## The long-form records

Everything below is evidence for the items above, not a second list of them.
Each carries how the finding was established, what was observed, and the limits
of that observation — the part a summary loses and the next reader needs before
changing anything.

### T-518 — 15 of 18 timers are still no-ops; the mechanism is proven

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
`CLEANUP_TEMP_STORAGE` in `enabled_timers`. That left sixteen no-ops **at that
moment** — see the paragraph below for where the count stands now — so the
platform still ran almost no scheduled work, but "nothing is scheduled" was no
longer true and the arming mechanism was no longer an assumption.

**`PUBLISH_SCHEDULED_CONTENT` was armed and then observed on the evening of
2026-08-30 Chicago time** — `2026-08-31` in UTC, which is why the surrounding
entries and the timestamps below appear to disagree. Every timestamp in this
section is CDT (`-05:00`), matching what the host itself writes; the two UTC
instants are named as UTC where they appear. The observation is unusually
clean, because it straddles the apply:

```
publishScheduledContent  8 invocations  4 ran  4 skipped
                         first 2026-08-30 18:30:00 CDT  last 2026-08-30 20:15:00 CDT
```

Eight invocations at exactly fifteen-minute spacing with no gap. The four at
18:30, 18:45, 19:00 and 19:15 skipped; the four at 19:30, 19:45, 20:00 and
20:15 ran. The apply that set the flag landed at 00:30 UTC on 2026-08-31, which is
19:30 CDT on 2026-08-30 — so the split falls on the boundary rather than near
it. That is the same timer,
observed skipping and then running, with the flag change as the only variable:
a stronger reading than a bare "it fired", because it also proves the gate the
flag controls.

The clock came from the host in the same run: eight `ScheduleStatus` rows, all
`-05:00`, firing on :00 :15 :30 :45 **Chicago local**. So both halves hold for
this timer independently.

One honest limit, which the script prints itself: a RAN invocation is one whose
traces carry no skip line, and a dropped `.User` trace would look identical.
The durable side effect — content actually transitioning to published — is the
second witness Cutover-Runbook Gate 4 asks for, and it only appears when
something was genuinely due. Nothing was, so the no-op is correct and
unwitnessed by that second path.

So of the eighteen: fifteen remain no-ops, and `CHECK_AGENT_HEALTH`,
`CLEANUP_TEMP_STORAGE` and `PUBLISH_SCHEDULED_CONTENT` are armed and observed.

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
same day to aggregate in the workspace instead.

**That rewrite treated a symptom, and the miscount was root-caused on
2026-08-31 instead.** `az` on Windows is a batch file, which cannot receive an
argument containing a newline, so a multi-line query handed to
`--analytics-query` arrived truncated at the first line break: `AppTraces`
survived and the whole pipeline after it was discarded. The call still exited
0. Azure ran the truncated query and returned every unfiltered row in the
table, so the script rendered tens of thousands of rows with every projected
column blank — and its preflight, truncated the same way, read a missing
column as zero and reported "no worker traces" in the same run. The tell was
in the record for a week: the count barely moved between `-Hours 1` and
`-Hours 24`, and a window that changes 24-fold cannot return the same total
unless the window is not being applied. Fixed by flattening every query before
it leaves PowerShell, and by asserting that returned rows carry the columns the
caller asked for — a truncated query answers a different question rather than
failing, which is why nothing in the error handling ever fired.

**Confirmed end-to-end in the same run** (2026-08-30 CDT / 2026-08-31 UTC), on
the Windows host where it failed:
the same command that had returned 58,265 blank rows returned one correct
summary row, the `ScheduleStatus` section came back filtered to the requested
timer and ordered, and the preflight reported 431 worker traces where it had
been reporting none. That last number is the one worth remembering — the
"telemetry gap" this script reported three times never existed.

The fifteen that remain go one at a time, each observed firing before the next
is added.

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
| Frontend release | Approve whether releases remain manual or become push-triggered. **The credential half of this row is closed (T-727, 2026-08-31):** the deploy mints its token from ARM per run under federated identity, and the stored secret is deleted — there is nothing left to provide or rotate | `deploy-azure-frontend.yml` stays dispatch-only |
| Production infrastructure | Approve HCP Terraform plan/apply and any DNS, custom-domain, or Cloudflare changes | Terraform remains the infrastructure source of truth |
| Timers and the availability test | See items 2 and 3 above for the procedure and what success looks like. Decide whether to arm the remaining 15 schedulers, adding each to `enabled_timers` one at a time and observing it before the next. `schedulers_master_enabled` is already `true`; `CHECK_AGENT_HEALTH`, `CLEANUP_TEMP_STORAGE` and `PUBLISH_SCHEDULED_CONTENT` are armed and proven. The availability half of this row is closed: the edge probe is deployed and its alert armed 2026-09-01 (T-519) | The three proven timers remain armed; the other 15 remain no-ops. The Azure standard availability test stays disabled in Terraform because Bot Fight Mode challenges Azure agents; the reachability signal is served by the ADR 0024 Cloudflare Worker, whose alert `alert-api-reachability-prod-cus` is live |
| Recovery objectives (decided 2026-08-30) | **RTO 8 hours, RPO 24 hours.** Chosen to match what the estate can actually meet today — periodic Cosmos backup, one operator, no on-call — rather than an aspiration nobody has rehearsed. Deliberately not RPO 1 h: that needs the T-707 continuous-backup tier, which costs money while the platform is still nearly idle and would commit to a drill that has never been run. Revisit once scheduled work is generating documents, which is also when T-707 starts to pay for itself. The remaining work in **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)** is now measurement against these numbers — a timed restore — not the numbers themselves | Cosmos carries `Continuous30Days`; content/media storage is RA-GRS with versioning and soft delete; Functions host storage remains LRS with soft delete. No scheduled out-of-account Cosmos export exists, no restore has been timed, and no result is justified against a stated objective |
| Key Vault | Provide only the secrets needed by enabled features; never put values in GitHub variables or Vite config. **The approved procedure changed on 2026-08-29**: seeding is now **Admin → Platform → API Keys**, and the desktop script is break-glass rather than the default path | Code reads secrets server-side and degrades optional integrations when absent |
| Function App vault write (decided 2026-08-29) | **Approved.** The app may create new secret versions, through a CUSTOM role holding only `Microsoft.KeyVault/vaults/secrets/setSecret/action` — not `Key Vault Secrets Officer`, which would also grant get, list, delete and purge. It may also refresh its own Key Vault references (`Microsoft.Web/sites/config/Write`, scoped to the one site, with `config/list/action` excluded so it cannot read its settings back). Weighed against what it replaces: the previous procedure opened the production vault's firewall to a human IP on every rotation, and left it open once | The app cannot read a secret back out of the vault, cannot delete one, and cannot enumerate its own app settings through ARM. `/api/cms/secrets` is `super_admin` on both verbs and returns no value in any response — asserted by scanning the whole serialised body, not by trusting a field list |
| GCP pricing integration | Seed `GCP-BILLING-API-KEY` if the GCP column in the public pricing tool is wanted, or leave it unseeded and that column stays absent. Get it from the GCP console: enable the Cloud Billing API, create an API key, restrict it to that API. **This is not a billing credential** — the Cloud Billing Catalog API serves the public price list, and it is read for the site's comparison tools, not for anything this estate is charged for | No GCP credential is stored in the repository. The service-account JSON this row used to ask for is retired (2026-08-29): the API key is what Google documents for this API, and it removed a vault SDK client, an OAuth library and a bespoke seeding script |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |
| Static Web App tier | Decide whether the Standard tier (about USD 9/month, the workload's one fixed line) buys anything this estate uses — carried here when T-721 closed on 2026-09-02. **Checked against Microsoft's plan comparison on 2026-09-02, correcting what this row said before:** Free also provides custom domains with managed SSL (2 per app, against 5), global distribution, SPA routing, 100 GB included bandwidth — and **3 preview environments per app**, so "PR staging is Standard-only" was wrong. Standard-only and **none of it in use here**: `networking.allowedIpRanges` (absent from `staticwebapp.config.json`, which carries only `navigationFallback`, `globalHeaders`, `routes`, `responseOverrides`, `trailingSlash`), bring-your-own-Functions linking (the API is a separate app on its own hostname), custom auth registrations and function-assigned roles (admin auth is MSAL in the browser), private endpoints. So downgrading gives up exactly two things: the 99.95% SLA, and bandwidth overage — Free has **none**, so past 100 GB the site stops serving rather than billing USD 0.20/GB, which Cloudflare caching in front makes unlikely but not impossible. Verify two Free limits first: at most 2 custom domains (`az staticwebapp hostname list --name stapp-site-prod-cus-01 --resource-group rg-web-site-prod-cus -o json \| ConvertFrom-Json \| Select-Object name, status`) and a build under 250 MB | The tier stays Standard until decided; the change is `sku_tier`/`sku_size` in `infra/frontend.tf` plus an approved run, and Microsoft documents moving between Free and Standard in either direction — a two-way door, unlike purge protection |
| Provider-section go-live | Decide when each dark section ships. 24 pages across `frontend/src/pages/finops`, `gcp`, `github` and `terraform` return `ComingSoonPage` behind a two-line guard; several carry fully written components behind the early return. Re-enabling a page is two edits in one change: delete its two `// TODO: remove to re-enable` marker lines, and move its path from `GUARDED_FILES` to `LIVE_FILES` in `frontend/scripts/validate-provider-pages.js` — the validator asserts both directions, so either edit alone fails the build. Decide per **section**, not per file: some pages render content that needs its RSS or content route live first. This row exists because the gate previously lived only in the inline markers and the validator, outside this tracker | The `aws` and `azure` sections are live. The four dark sections stay guarded, and `frontend/scripts/validate-provider-pages.js` fails the build if a guarded page's markers are altered rather than cleanly removed |

## Live confirmation still requiring an authorized operator

- Verify the Entra role claim and API audience in a newly issued access token.
- Verify the admin registry record and the resulting `getCurrentAdminStatus`
  response in the deployed environment.
- Confirm the public API and Static Web App custom domain after any DNS or edge
  change.
- ~~**Observe an alert actually being delivered.**~~ **Done 2026-08-30.** A
  sample budget alert from `ag-plat-prod-cus-01` arrived in the `ops-email`
  receiver's inbox (fired 21:36 UTC; receiver status `Enabled`). The email path
  is proven end to end, across the subscription boundary, for the first time.

  **Use the CLI, not the portal button.** The portal's **Test action group**
  reported *"There was a problem completing this test"* with status **Unknown**
  on two attempts and delivered nothing. The same operation through the CLI
  returned `"Status": "Succeeded"` / `"state": "Complete"` and the email arrived
  a minute later:

      az monitor action-group test-notifications create \
        --action-group ag-plat-prod-cus-01 \
        --resource-group rg-mgmt-plat-prod-cus \
        --subscription 02dfb8ad-ec22-42e3-8cdc-17fd6e00b17e \
        --alert-type budget -a email ops-email <address> usecommonalertschema

  The API response and the inbox are two independent witnesses, which is the
  standard the Cutover-Runbook asks for and what the portal alone could never
  supply — its `Unknown` was a verdict on nothing. Note also the argument shape:
  it is `-a email <name> <address> <schema>`, not a `--email-receiver` flag, and
  the whole thing is one line — a backtick continuation pasted into Git Bash
  gets read as a command name.

  Second, this file named the group `ag-ops-prod-cus` until the same day, which
  is no resource: `observability.tf:36` builds
  `ag-plat-${environment}-${region_abbreviation}-${instance}`, `hcw-ops` is only
  the short name, and it lives in `rg-mgmt-plat-prod-cus` in the **Management**
  subscription because the action group follows its resource group there.

  **The SMS channel was proven the same evening** and T-709 is closed. Same
  command shape, `-a sms <name> <countryCode> <phoneNumber>` in place of
  `-a email …`; read the values off the action group rather than retyping them.
  Both channels have now been observed delivering, which is the first time this
  estate has had a second path to fall back on.
- Confirm any third-party webhook or scheduled integration after its owner has
  approved a real external mutation test.
- ~~Apply the Terraform change that creates the `listenandlearn` blob
  container.~~ **Applied 2026-08-30.** `az storage container-rm show` reports
  `listenandlearn` with `publicAccess: None` — private, as intended;
  `PUBLIC_MEDIA_CONTAINERS` in `blob-paths.js` is what makes an episode
  reachable, not the container ACL. The same apply declares the fallback
  `AZURE_SPEECH_*` settings, which stay unresolved and inert.

## Accepted risks

A decision to live with a finding rather than fix it. An accepted risk with no
record is indistinguishable from an unfixed one: the next reviewer re-raises it,
or someone "fixes" it without knowing it was a choice.

| Risk | Accepted | Reasoning, and what compensates |
| --- | --- | --- |
| **Log-based alerts sleep when the ingestion cap binds.** If daily volume ever again reaches the 0.25 GB cap, `function_http_5xx` and `function_response_time` stop evaluating from cap-hit until the 08:00 UTC reset — a partial failure in that window surfaces the next morning. Accepted with the T-719 decision | Owner, 2026-09-02 | A personal content site with RTO 8 h does not need same-hour paging on partial failures. The exposure was daily and unrecorded while host verbosity pinned the cap; after the verbosity cut the cap is headroom and the window should not recur. Compensating controls: the T-519 edge probe pages on unreachability twelve times an hour on a pipeline the cap cannot touch, and `logs_daily_cap` alerts at 80% of quota before the blindness starts |
| **Key Vault purge protection is off** on `kv-site-prod-cus-01`, which holds 18 live secrets. Raised as Go-Live blocker B2 on 2026-08-24 | Owner, 2026-08-24 | Enabling it is a **one-way** switch: once on it cannot be turned off, a deleted vault can no longer be purged, and its name stays reserved for the retention period — which removes the teardown-and-recreate path a single-environment estate depends on. The secrets are seeded and resolving, so the exposure is not "unprotected during setup". Compensating control: soft delete at 90 days, which still makes an accidental delete recoverable. What is given up is protection against a *deliberate* purge by someone already holding the rights to perform one. Recorded in the same terms in `infra/variables.tf` and `infra/README.md` |
| ~~**The Static Web Apps deployment token is a Terraform output** (`swa_token`)~~ Raised as T-722, 2026-08-28 | **CLOSED (T-727).** The output was deleted on 2026-08-30 and the owner deleted the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret on 2026-08-31; the deploy mints the token from ARM under federated identity, per run. No stored, non-expiring credential remains in this repository's secrets. Not an accepted risk any more, and kept in this table only so the row does not appear to have been quietly dropped | The token is in state via `azurerm_static_web_app.hcw.api_key` whether or not the output exists, so deleting the output would hide it rather than retire it. `sensitive` keeps it out of logs and plan output; it is still visible on the HCP Terraform Outputs tab to anyone with state read. It is the estate's **last long-lived credential** — everything else a workflow uses is federated OIDC. Compensating control, 2026-08-28: `deploy-azure-frontend.yml` now isolates it in a job that installs nothing, so a compromised build dependency cannot reach it (T-727). Retiring it means moving the SWA deploy to OIDC, or at minimum making this an environment secret on a *protected* `production`; both need owner access. The `outputs.tf` header now names the exception instead of contradicting it |
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
