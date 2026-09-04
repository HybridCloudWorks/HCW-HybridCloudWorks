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
| 2 | `T-518` — arm the remaining timers | High | Risk-grouped waves, each observed before the next; the two destructive timers stay solo |
| 3 | `T-764` — the podcast pages have no data and only Wave 2 can give them any | Medium | The writer was observed on 2026-09-04; what remains is the `azure` podcast page rendering an episode |
| 4 | `T-765` — `ai_insights` has a reader and no writer | Low | An owner decision on whether the insights panel is a feature or is retired |
| 5 | `T-766` — the timer-observation gate lost its telemetry witness to #321 | High | A witness for every timer in a wave before it is armed: the public side effect where one exists, a per-category `host.json` override decided per wave where it does not |

Item 1 carries no severity because it is not a review finding: it is an owner
action left behind by a finding that is closed. Item 2 is a repeated,
observed procedure, now sequenced into waves. Items 3 and 4 were found on
2026-09-02 by tracing every container the public read layer reads back to
whatever writes it — the audit that the empty news pages prompted. Item 5
was found on 2026-09-03 when Wave 2's gates returned nothing: two workstreams
had collided, and it is High because waves 2 through 6 cannot produce their
own evidence until it is settled.

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
| 4 | Arm the remaining timers in risk-grouped waves, each wave observed before the next (`T-518`), which is also the only thing that can fill the podcast pages (`T-764`) — and each wave needs its witness settled first (`T-766`) | [Section 2](#2-t-518--arm-the-remaining-timers-in-waves), [Section 3](#3-t-764--the-podcast-pages-have-no-data-and-only-wave-2-can-give-them-any) and [Section 5](#5-t-766--the-timer-observation-gate-lost-its-telemetry-witness-to-321); the four gates are [Cutover-Runbook step 5](wiki/Cutover-Runbook.md) | After the verbosity cut has deployed (#321), so timer volume lands in real headroom rather than darkening the log-based alerts. Wave 2 landed 2026-09-04 and proved `T-764`'s writer; that row now waits only on the `azure` podcast page rendering |
| 5 | Prove the nightly refresh's App-token path (`T-726`) | [Section 1](#1-t-726--built-and-configured-unproven-until-content-moves) | Passive — the first published content change is the test. Publishing anything in Phase 6 doubles as this proof |
| 6 | Optional features: seed the keys and documents you actually want; decide whether the AI insights panel is a feature or is retired (`T-765`) | [Optional, and only if you want the feature](#optional-and-only-if-you-want-the-feature) and [Section 4](#4-t-765--ai_insights-has-a-reader-and-no-writer) | Decisions, not repairs — nothing above depends on any of them |
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

### 2. T-518 — arm the remaining timers, in waves

Armed and observed: `CHECK_AGENT_HEALTH`, `CLEANUP_TEMP_STORAGE`,
`PUBLISH_SCHEDULED_CONTENT`, Wave 1's `PLATFORM_JOB_SWEEPER` and
`MONITOR_PUBLISHING_PIPELINE`, and Wave 2's `SYNC_RSS_FEEDS` and
`FETCH_PODCAST_FEEDS`. `schedulers_master_enabled` is already `true` and
`enabled_timers` is the HCL-typed workspace variable holding every one of
them. The wave table below is the list of what remains.

**Owner decision, 2026-09-02: arm in waves, not one at a time — a deliberate
departure from [Cutover-Runbook](wiki/Cutover-Runbook.md) step 5, recorded
here so the two documents do not disagree silently.** Taken literally, one
timer per apply serialises into roughly five weeks and fifteen applies, each
one restarting the Function App through the workspace's permanent `azapi`
diff — and three of the fifteen fire *weekly*, so their observation windows
alone are three weeks. What the one-at-a-time rule exists to prove is that
arming works at all, and that is settled: the mechanism has been observed
three times, once across the apply boundary itself
(`publishScheduledContent`, four skipped invocations then four ran, with the
flag as the only variable). What remains is per-handler behaviour, which
groups by risk. There is precedent: `CHECK_AGENT_HEALTH` and
`CLEANUP_TEMP_STORAGE` were armed in a single apply on 2026-08-30, recorded
as a departure with its justification.

**What does not group.** The two timers that delete documents with no
dry-run pin — `CLEANUP_SOFT_DELETED_CONTENT` and `CLEANUP_REJECTED_CONTENT` —
stay one per apply, observed before the next. Grouping is a concession to
calendar arithmetic, not to destructive operations.

| Wave | Timers | Why grouped | Observable in |
| ---: | --- | --- | --- |
| 1 | ~~`PLATFORM_JOB_SWEEPER`, `MONITOR_PUBLISHING_PIPELINE`~~ | **Done 2026-09-02** — record in [CHANGELOG.md](CHANGELOG.md) | All four gates observed; the pipeline's `ScheduleStatus.Last` landed on its intended Chicago hour |
| 2 | ~~`SYNC_RSS_FEEDS`, `FETCH_PODCAST_FEEDS`~~ | **Done 2026-09-04** — record in [CHANGELOG.md](CHANGELOG.md) | Both witnessed through the public side effect, the T-766 path: `rss_cache.refreshedAt` at its 02:00 Chicago boundary on 2026-09-03, `podcasts.updatedAt` at the 13:30Z firing on 2026-09-04. The first podcast firing left no stamp and its cause is not recoverable; the next miss is readable since #330 |
| 3a | `CLEANUP_SOFT_DELETED_CONTENT` | **Destructive, solo.** Purges soft-deleted documents, no dry-run pin | 4 h |
| 3b | `CLEANUP_REJECTED_CONTENT` | **Destructive, solo.** Deletes rejected documents, no dry-run pin | 24 h |
| 4 | `FORGE_SCHEDULED`, `GENERATE_REVIEWER_DIGEST`, `FETCH_BLOG_LISTINGS` | Each spends money or sends outbound mail — decide each on its merits before the wave, then arm together | 24 h |
| 5 | `REFRESH_PLAUD_TOKEN`, `SYNC_SOCIAL_CALENDAR` | Both need owner-held third-party credentials. Arm only if Plaud and Publer are seeded; an armed timer with no credential is an erroring loop, not a no-op | 12 h |
| 6 | `CHECK_LIVE_LINKS`, `REVERIFY_CERTIFICATIONS`, `SCRAPE_SKILLS_HUB_RSS`, `CLEANUP_UNUSED_CERT_IMAGES` | The three weekly timers fire on Monday, Sunday and Friday — non-overlapping windows, so one week observes all three. The fourth is dry-run pinned by `CERT_IMAGE_CLEANUP_DELETE` | 7 days |

**This table is the plan, and no count above it is.** Wave 3 is one risk
group but two applies — `3a` and `3b` are the destructive pair, which never
share one — so the table is seven applies across six groups, and any summary
that states a single number will be wrong from one side or the other. The
rows are the authority; that is the T-722 lesson applied to this plan rather
than re-learned on it.

Per wave: add the names at
https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables (keep **HCL**
ticked — `enabled_timers` is a typed list), approve the run, expect the
Function App restart, then observe every timer in the wave firing before
starting the next. The evidence standard is the observed invocation, not the
applied setting — [Cutover-Runbook](wiki/Cutover-Runbook.md) step 5 has the
four gates, and its two ordering constraints still bind: `SYNC_SOCIAL_CALENDAR`
is the live writer of `social_posts`, and arming a cleanup timer is a separate
decision from arming its deletion (T-302).

Gate 1 for a wave, one timer at a time — bracket-free, because `az --query`
with `[?...]` is re-parsed by PowerShell and fails (`.claude/CLAUDE.md`):

```powershell
az functionapp config appsettings list --name func-site-prod-cus-01 --resource-group rg-web-site-prod-cus -o json | ConvertFrom-Json | Where-Object name -eq FEATURE_FLAG_PLATFORM_JOB_SWEEPER | Select-Object name, value
```

**Success:** one row, value `true`. Substitute the flag name for each timer in
the wave.

Gates 3 and 4 read the timer's **durable side effect**, not telemetry —
since #321 the host writes no invocation traces (Section 5). For the three
timers with a public witness:

```powershell
node scripts/verify-timer-witness.mjs --timer syncRssFeeds --since 2026-09-03T05:00:00Z
```

**Success:** `PASS`, a document count, and a `newest` stamp at or after
`--since` (the apply time or the last scheduled tick, ISO 8601 UTC). `FAIL`
with zero documents on a container only this timer writes means it has never
run here. Exit 2 means the timer has no public witness and nothing was
evaluated — settle that before arming its wave, per Section 5.

`05-verify-timer.ps1 -Hours 24` still reads correctly for history before
2026-09-02 17:59Z, and warns when the cut makes its invocation section blind.

**Note on volume:** arming timers adds `AppTraces` volume. The host
verbosity cut (T-719, closed 2026-09-02, #321) is what made room for it —
if a cap-day reading after arming shows the workspace back near 0.25 GB,
the Basic-table-plan reserve lever in the T-719/T-721 CHANGELOG record is
the next move.

### 3. T-764 — the podcast pages have no data, and only Wave 2 can give them any

`podcasts` has exactly one **production** writer:
`functions/src/lib/timers/podcasts.js`, reached from `schedulers.js` as the
`fetchPodcastFeeds` timer and from nowhere else that runs in Azure.
`FETCH_PODCAST_FEEDS` was never `true` before Wave 2 armed it on 2026-09-03,
so until then the container held only the migrated documents and every
provider podcast page rendered empty.

**What makes this different from the news pages it was found beside.** The
empty news pages had a manual escape hatch — `fetch-rss-feeds` is a registered
platform job with a Run Now button at
https://hybridcloudworks.com/admin/ops-health, and running it on 2026-09-02
filled `rss_cache` from 21 feeds in one click. There is no equivalent for
podcasts: `createPodcastIngest` has no job registration and no admin route, so
**arming Wave 2 is the only way to put data in that container.** Outside its own
definition, the only callers are `schedulers.js` and
`functions/src/lib/timers/ingestion-timers.test.js` — nothing that a human or a
queue can reach.

**The writer is now observed.** On 2026-09-04 the 13:30Z firing re-stamped
`podcasts.updatedAt`, read through the public API by
`scripts/verify-timer-witness.mjs` — the first execution of this handler in
this environment, and the first after the #330 deploy. The firing before it
left no stamp, and why is not recoverable: it predates #330, so whatever went
wrong was logged at Information and dropped by the Warning gate. From here an
erroring loop is readable — a failed feed writes an Error row and an empty
feed a Warning row in the `Function.fetchPodcastFeeds` category — and
re-delivery is safe by construction: `processFeed` reads each episode by id
and preserves `createdAt` before upserting.

The first half is done. Closes when **the `azure` podcast page** renders an
episode: https://hybridcloudworks.com/azure/audio-architecture — success is
at least one episode card with a title and a play control, and the newest
episode on the podbean feed being the newest on the page. Only azure: `PODCAST_FEEDS` in
`functions/src/lib/timers/podcasts.js` holds exactly one feed, so the aws, gcp
and vmware podcast pages stay empty after this closes — by configuration, not
by fault. Adding feeds for them is a content decision, not part of this row.
Corrected 2026-09-03; the earlier wording implied all four pages.

### 4. T-765 — `ai_insights` has a reader and no writer

`GET /api/public/feed` returns an `insights` array beside `rssCache`, and the
news pages render it as a panel. Nothing in this repository writes
`ai_insights`. Eleven files name it and every one of them reads, declares or
describes: the query in `functions/src/lib/public-reads.js` and its test, the
container definitions in `infra/cosmos-containers.json`,
`scripts/generate-cosmos-container-spec.mjs` and `.azure/api-surface.json`, the
client-side doc comment in `frontend/src/lib/publicApi.js`, and
`scripts/lib/migration-manifest.mjs`, which lists it `disposition: 'migrate'`.
No write helper is called against it anywhere.

**So the panel is frozen, not necessarily empty** — and the distinction is the
point. Whatever insights came across in the migration are still served, filtered
by `active !== false`; nothing has generated one since, and nothing will. A
reader looking at a populated panel would have no way to tell it has been
static since the cutover.

This is a **product decision rather than a defect**, which is why it is Low and
why the closing condition is a decision rather than a fix. Either the generator
is a Site-Main feature that was deliberately not ported and the panel should be
retired from `NewsPage`, or it is an intended feature whose writer is missing.
Recorded without a recommendation because the original intent is not visible in
this repository — the answer lives in Site-Main's history or in the owner's
memory, not in code that can be read here.

### 5. T-766 — the timer-observation gate lost its telemetry witness to #321

Cutover-Runbook step 5's fourth gate proved a timer fired by reading
`Function.<name>` traces from `AppTraces` — `Executed 'Functions.…'` and
`Trigger Details: ScheduleStatus: {…}`, which the host writes at
**Information** level. #321 dropped `host.json`'s `Function` category to
Warning on 2026-09-02, deployed 17:59Z, to take host verbosity off the daily
cap. From that minute the host wrote nothing for a successful invocation.

**Two workstreams collided, and the record shows why nobody saw it.** The #321
CHANGELOG entry says `Host.Results` was kept at Information *"because it feeds
`AppRequests`, which … the timer-observation gate read."* But
`05-verify-timer.ps1`'s own header says `AppRequests` has been empty for the
app's whole life and is not the oracle (T-514); it reads `Function.*` rows in
`AppTraces`. The cut protected the table the gate never used and removed the
one it did. Neither document mentioned the other.

Found 2026-09-03: Wave 2's gates returned nothing, the workspace was
`RespectQuota`, the app was demonstrably running (the admin RSS job had
processed 21 feeds three hours after the deploy), and `platformJobSweeper
-Hours 24` showed 37 invocations ending at **13:00:00 CDT — 18:00Z, the deploy
minute** — then silence. That read also settled Wave 1 retroactively: it was
real, and the #323 record stands.

**Owner decision 2026-09-03: keep the cut, make the side effect the witness.**
`scripts/verify-timer-witness.mjs` reads it through the public API, with no
`az`, workspace or telemetry plane involved. Three timers have a public
witness — `syncRssFeeds`, `fetchPodcastFeeds`, `publishScheduledContent` —
and the other fifteen do not; the runbook's table says why, per timer, and
the script's test pins that table to what the app registers. Wave 2 closed on
that witness on 2026-09-04 — the first wave observed with no host trace at
all.

**What stays open, and why this is High.** Waves 3 through 6 are entirely
timers with **no** public witness. Each wave needs its evidence settled before
the apply, and there are two honest options per timer: read its container
directly with data-plane access, or raise that single category —
`"Function.<name>": "Information"` in `host.json` — for the wave and remove it
after. The override restores the trace for one timer at a few lines per
invocation rather than the whole host's chatter, so it does not reopen T-719;
but it is a `host.json` change and a deploy per wave, which is a real cost
against the volume it saves. Decide per wave, at arming time, and record
which was chosen in the wave's row.

Closes when every wave in the T-518 table has a stated witness, and no wave
is armed against a timer whose evidence path is "none".

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
| Timers and the availability test | See items 2 and 3 above for the procedure and what success looks like. Decide whether to arm the remaining schedulers, adding each wave to `enabled_timers` and observing every timer in it before starting the next — the wave table in item 2 is the plan. `schedulers_master_enabled` is already `true`; `CHECK_AGENT_HEALTH`, `CLEANUP_TEMP_STORAGE`, `PUBLISH_SCHEDULED_CONTENT`, Wave 1's `PLATFORM_JOB_SWEEPER` and `MONITOR_PUBLISHING_PIPELINE`, and Wave 2's `SYNC_RSS_FEEDS` and `FETCH_PODCAST_FEEDS` are armed and proven. The availability half of this row is closed: the edge probe is deployed and its alert armed 2026-09-01 (T-519) | The proven timers remain armed; the rest remain no-ops. The Azure standard availability test stays disabled in Terraform because Bot Fight Mode challenges Azure agents; the reachability signal is served by the ADR 0024 Cloudflare Worker, whose alert `alert-api-reachability-prod-cus` is live |
| Recovery objectives (decided 2026-08-30) | **RTO 8 hours, RPO 24 hours.** Chosen to match what the estate can actually meet today — periodic Cosmos backup, one operator, no on-call — rather than an aspiration nobody has rehearsed. Deliberately not RPO 1 h: that needs the T-707 continuous-backup tier, which costs money while the platform is still nearly idle and would commit to a drill that has never been run. Revisit once scheduled work is generating documents, which is also when T-707 starts to pay for itself. The remaining work in **[issue #231](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/231)** is now measurement against these numbers — a timed restore — not the numbers themselves | Cosmos carries `Continuous30Days`; content/media storage is RA-GRS with versioning and soft delete; Functions host storage remains LRS with soft delete. No scheduled out-of-account Cosmos export exists, no restore has been timed, and no result is justified against a stated objective |
| Key Vault | Provide only the secrets needed by enabled features; never put values in GitHub variables or Vite config. **The approved procedure changed on 2026-08-29**: seeding is now **Admin → Platform → API Keys**, and the desktop script is break-glass rather than the default path | Code reads secrets server-side and degrades optional integrations when absent |
| Function App vault write (decided 2026-08-29) | **Approved.** The app may create new secret versions, through a CUSTOM role holding only `Microsoft.KeyVault/vaults/secrets/setSecret/action` — not `Key Vault Secrets Officer`, which would also grant get, list, delete and purge. It may also refresh its own Key Vault references (`Microsoft.Web/sites/config/Write`, scoped to the one site, with `config/list/action` excluded so it cannot read its settings back). Weighed against what it replaces: the previous procedure opened the production vault's firewall to a human IP on every rotation, and left it open once | The app cannot read a secret back out of the vault, cannot delete one, and cannot enumerate its own app settings through ARM. `/api/cms/secrets` is `super_admin` on both verbs and returns no value in any response — asserted by scanning the whole serialised body, not by trusting a field list |
| GCP pricing integration | Seed `GCP-BILLING-API-KEY` if the GCP column in the public pricing tool is wanted, or leave it unseeded and that column stays absent. Get it from the GCP console: enable the Cloud Billing API, create an API key, restrict it to that API. **This is not a billing credential** — the Cloud Billing Catalog API serves the public price list, and it is read for the site's comparison tools, not for anything this estate is charged for | No GCP credential is stored in the repository. The service-account JSON this row used to ask for is retired (2026-08-29): the API key is what Google documents for this API, and it removed a vault SDK client, an OAuth library and a bespoke seeding script |
| AI providers | Decide which external providers should be enabled and provide their keys through Key Vault | The AI router only enables a provider when its server-side key is present |
| Third-party integrations | Provide owner-controlled Publer, Klaviyo, YouTube, Telegram, Hostinger, or other credentials and approve webhook changes before activation | Integration secrets are server-side and optional paths remain gated |
| Listen & Learn speech | Nothing to provide: it synthesises with Gemini TTS on the existing `GEMINI-API-KEY`. Audio is billed against that key at roughly $0.17 an episode / $0.87 a certification on the default model; every run is logged to the AI Engine usage tab under "Breakdown by Feature", so the spend is checkable there rather than estimated. Azure AI Speech is a written, tested fallback for the day the preview Gemini TTS models are retired; using it means creating a Cognitive Services resource, which is a spend decision and is not assumed | Provider is chosen by key presence, Gemini first. With no key at all the feature still publishes each episode's transcript, takeaways and videos and records `audioError` instead of failing |
| Listen & Learn video links | Seed `YOUTUBE-API-KEY` if the curated "watch next" links are wanted. One certification costs ~505 of the default 10,000 daily quota units | Optional. Without it, episodes generate and publish with an empty video list |
| VPS Labs agent | Provide the host operator, Entra client/certificate, API scope, and deployment approval for the Hostinger agent | `vps-agent/` uses the API and holds no database credential |
| Static Web App tier | Decide whether the Standard tier (about USD 9/month, the workload's one fixed line) buys anything this estate uses — carried here when T-721 closed on 2026-09-02. **Checked against Microsoft's plan comparison on 2026-09-02, correcting what this row said before:** Free also provides custom domains with managed SSL (2 per app, against 5), global distribution, SPA routing, 100 GB included bandwidth — and **3 preview environments per app**, so "PR staging is Standard-only" was wrong. Standard-only and **none of it in use here**: `networking.allowedIpRanges` (absent from `staticwebapp.config.json`, which carries only `navigationFallback`, `globalHeaders`, `routes`, `responseOverrides`, `trailingSlash`), bring-your-own-Functions linking (the API is a separate app on its own hostname), custom auth registrations and function-assigned roles (admin auth is MSAL in the browser), private endpoints. So downgrading gives up exactly two things: the 99.95% SLA, and bandwidth overage — Free has **none**, so past 100 GB the site stops serving rather than billing USD 0.20/GB, which Cloudflare caching in front makes unlikely but not impossible. Verify two Free limits first: at most 2 custom domains (`az staticwebapp hostname list --name stapp-site-prod-cus-01 --resource-group rg-web-site-prod-cus -o json` — no pipe, so it pastes as-is out of this table) and a build under 250 MB | The tier stays Standard until decided; the change is `sku_tier`/`sku_size` in `infra/frontend.tf` plus an approved run, and Microsoft documents moving between Free and Standard in either direction — a two-way door, unlike purge protection |
| ~~Provider-section go-live~~ | **Done 2026-09-02** — record in [CHANGELOG.md](CHANGELOG.md) | Owner decided all 24 pages ship at once. Every provider page is live; `GUARDED_FILES` in `frontend/scripts/validate-provider-pages.js` is now empty and the guard mechanism is retained for the next page that needs it |

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
