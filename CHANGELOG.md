# CHANGELOG

Completed features, fixes, enhancements, security fixes, and released changes.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file records **completed work only**. Outstanding engineering work belongs in
[TODO.md](TODO.md); human-resolvable blockers in [REVIEW.md](REVIEW.md);
required inputs in [REVIEW.md](REVIEW.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project has not cut a tagged release; entries are grouped under
`[Unreleased]` and reference the pull request that landed them.

---

## [Unreleased]

### Added

- **The alert fabric can now be verified against what is actually deployed.**
  `.github/workflows/verify-alert-state.yml` reads the three workload rules
  through ARM with the existing OIDC deployment identity and prints
  `autoMitigate`, mute duration, frequency, window and severity into the job
  summary; a stateless or missing rule fails the run and is named in the table.

  It closes a gap that only became visible while trying to confirm the previous
  entry had taken effect. Applies run in HCP Terraform Cloud on a human's
  confirmation, and a green TFC run proves ARM **accepted** the change — not
  that the deployed rule behaves differently. Those come apart exactly at
  `autoMitigate`, the attribute that decides whether a firing rule mails once or
  every five minutes, and which is invisible from the repository, from CI and
  from the TFC run list. Nothing short of asking ARM answers it.

  The identity's new grant is **Monitoring Reader on `rg-web-site-prod-cus`**
  (`infra/oidc.tf`), chosen over Reader deliberately: both carry the `*/read`
  the operation needs, and Monitoring Reader does not carry `listKeys` on the
  workspace — so the identity cannot read ingestion keys and cannot forge or
  drown the telemetry the rules evaluate. That is the same reasoning that chose
  Log Analytics Reader for the alert rules' own identities in ADR 0022 decision
  4. Scope is the resource group rather than the individual rules, so renaming a
  rule cannot silently break the verification path.

  Two constraints shaped it. The job declares **no `environment:`** — doing so
  changes the OIDC subject GitHub presents from `ref:` to `environment:`, which
  the branch credential cannot match (the AADSTS700213 failure documented in
  `infra/oidc.tf`). And it is `workflow_dispatch` only: this reads production,
  so a human decides when.

  Note the sequencing — **the workflow cannot report until the apply carrying
  its own role assignment has landed.** Until then it fails at `azure/login` or
  on the read, which is the self-arming behaviour the `vars.CLIENT_ID` gate
  already models elsewhere.

- **Listen & Learn (T-411).** One study podcast per weighted skill area of a
  certification's official study guide, with the videos worth watching next.
  Ported from Site-Main `functions/listen-and-learn/` (088f458) with the
  pipeline intact — study guide → skill areas → videos per area → dialogue →
  MP3 → draft — and three deliberate departures:

  *Audio is Gemini TTS, on the key the site already holds.* Upstream
  authenticated to Cloud Text-to-Speech with Application Default Credentials, a
  GCP identity this Function App cannot hold — the same reason Vertex was
  dropped from the AI router. The replacement is the Gemini API's own
  multi-speaker TTS through `GEMINI_API_KEY`, which is the capability the
  feature was actually for: a two-host deep dive read from source material is
  what a NotebookLM audio overview is, and these are the models that produce it.
  It costs no new service, no new resource and no new credential. Its contract
  shapes the module in three ways: multi-speaker takes at most two speakers,
  which is exactly the number here; the dialogue is a prompt rather than markup,
  so the transcript's speaker labels must match the `speech_config` names or a
  label is read aloud instead of switching voice; and a 32k-token session
  comfortably holds a whole 9,000-byte script, so an episode is one request with
  nothing to chunk.

  *Episode audio is encoded to MP3, and that is not cosmetic.* Gemini returns
  headerless 24 kHz 16-bit mono PCM with no format option — 48 KB per second, so
  a nine-minute episode is about 26 MB. `readBlobForDelivery` buffers a whole
  blob into memory and the media route returns it as one body with no range
  support, so that would hold 26 MB per concurrent listener, bill Function
  execution for the entire transfer, and make the player wait for the whole file
  before starting. At 64 kbps mono the same episode is about 4.5 MB (measured
  5.8x on a 24 kHz tone). `@breezystack/lamejs` is the encoder: pure JavaScript,
  no native build, no dependencies of its own; it is LGPL-3.0 and imported
  unmodified, and it is the only copyleft dependency in the package.

  *Azure AI Speech is kept as the fallback, not deleted.* Every Gemini TTS model
  is a **preview** model, and preview endpoints get retired on notice. Azure
  Speech is GA, and having the second path written and tested is the difference
  between a model retirement being a config change and being an outage. It needs
  a Cognitive Services resource, which is a spend decision, so nothing assumes
  one exists and an unseeded `AZURE_SPEECH_KEY` simply means the provider is not
  offered. Its own hazard is pinned by tests: that REST API silently TRUNCATES
  at ten minutes of audio rather than erroring, so its dialogue chunking
  estimates duration with a slow voice — being wrong the other way deletes the
  end of an episode and looks like a complete one.

  Provider selection follows the AI router's rule — a key makes a provider
  possible, and the first configured one in preference order runs — with
  `LISTEN_AND_LEARN_TTS_PROVIDER` to pin one outright. A pin that is not
  configured FAILS rather than falling through, because falling through would
  produce episodes in a voice nobody chose. Both providers return MP3, so the
  blob path, the stored `contentType` and the `<audio>` element are identical
  whichever ran. Each episode records `speechProvider`, `speechModel` and
  `durationSeconds` — provenance for AI-generated study content, and the only
  thing that answers "why does this one sound different" after a model change.

  *The script no longer asserts the hosts' gender.* Upstream's prompt said both
  hosts were women because the Google voices it used were documented female. The
  Gemini voice list publishes a descriptor per voice and no gender at all, so
  the claim is not one the audio can keep. The default pairing is by descriptor
  and follows the roles the prompt already assigns — Kore (*Firm*) leads and
  frames, Leda (*Youthful*) asks the question a learner would ask — and both are
  overridable per host.

  *Generation is a job, not a request.* An Azure Functions HTTP response is
  bounded at 230 seconds by the load balancer and one certification is five
  model calls, five syntheses and five uploads, so the admin page enqueues
  `generate-listen-and-learn` and polls, as the RSS ingest does. The run still
  saves area by area, so a timeout leaves the finished episodes behind.

  *A missing speech key degrades; a broken one fails.* Upstream treated any
  synthesis failure as a failed area. `SpeechNotConfiguredError` — no provider
  configured — now still saves the episode with its transcript,
  takeaways and videos and records `audioError`, which the admin page renders
  in place of the player. Every other synthesis failure still fails the area,
  because those are faults to fix rather than a state to ship in. The feature
  is useful the day it deploys and gains audio the day the key lands.

  Approval is unchanged and is the point: episodes are AI-written summaries of a
  paid exam's objectives, generated as drafts, and `GET
  /api/public/listen-and-learn` filters on `status === 'published'` with an
  equality test — an unrecognised status stays hidden. `listen_and_learn` and
  `listen_and_learn_episodes` already existed in the Cosmos container spec;
  `listenandlearn` is a new private blob container served through the media
  route. GitHub exams are enabled alongside Azure and AWS, since they are
  hosted on Microsoft Learn and parse with the same adapter.
- **draw.io hotspot tooling (T-410).** `lib/drawio/parseDrawio.js` and
  `lib/drawio/hotspotGeometry.js` port from Site-Main unchanged, with their
  test and fixture. A hotspot now stores a draw.io **shape id** and its position
  is derived from the diagram XML on every render (`useResolvedHotspots`), so
  re-uploading an edited diagram moves every pin with its shape instead of
  stranding it. `DiagramSourcePanel` replaces typing x/y percentages into two
  number inputs and eyeballing the result. Nothing renders the `.drawio` file —
  vendor stencils are most of what makes a cloud diagram readable, and the
  exported image stays what visitors see. Hand-positioned hotspots, the only
  kind this repository could write before, pass through untouched, and the
  admin preview now resolves through the same code as the public page.

### Changed

- **The apex serves the Azure site (T-517 closed, 2026-08-28).** The cutover
  this repository was built toward is done: `hybridcloudworks.com` — the
  canonical hostname, the one host that was still Firebase — now resolves to
  `calm-ground-0d0e6a010.7.azurestaticapps.net` and serves the Static Web
  App. Evidence, in the order it arrived: the owner-supplied Cloudflare zone
  export of 2026-08-27 23:47 showed the apex `CNAME` at the SWA with **no
  Firebase record remaining anywhere in the zone** (the Runbook §3c repoint);
  the owner then verified serving on 2026-08-28 — the acceptance criterion
  this tracker holds cutovers to, because DNS state is desired state and
  T-513 is the recorded case where the two disagreed.

  Two owner decisions recorded with the close-out. First, **the DNS rollback
  is forgone**: rather than holding the Firebase deployment through the
  Runbook's one-week soak, GCP is scheduled for deletion. Second, that
  decision converts the Telegram webhook re-registration (Runbook §3d) from a
  dormant follow-through into a deadline — the bot's webhook still points at
  the old Cloud Functions URL, and once GCP is deleted it goes quiet with no
  error anywhere in Azure. Tracked as **T-526**, to be run before the
  deletion.

  The Runbook §3c soak criterion ("a full week including every scheduled
  job") could never have completed as written — no timer is armed (T-518) —
  so the owner's decision also resolves a dead-lock this tracker had flagged
  between the two items.

- **The two `data-migration` federated credentials are retired (T-524 closed,
  2026-08-26).** `infra/oidc.tf` trusted six OIDC subjects and now trusts four.
  The pair granted no permission of its own — a federated credential decides
  which subject may act *as* the deploy identity — and with the production-write
  grants already revoked, a `data-migration` token inherited the same reduced
  role set a branch token gets. What it removed was a standing trust
  relationship for a job that cannot run.

  Held back from the earlier cleanup deliberately: retiring a trust
  relationship is an identity change rather than a Terraform tidy-up, which is
  why the remediation branch escalated it instead of deleting it. The owner
  authorised it on 2026-08-26.

  **Validated before the change, not after.** Nothing in `.github/workflows`
  names that environment; its only consumer, `migrate-data.yml`, was deleted in
  `59e471b`. Of the four workflows that call `azure/login`, one declares
  `environment: production` and three declare none, so they present the `ref`
  form — `deploy-azure-frontend.yml` names an environment but deploys through
  `Azure/static-web-apps-deploy` and never logs into Azure at all.

  `scripts/oidc-subjects.test.mjs` was then run against three variants of the
  deletion, because the check that matters is the one that fails:

  | Variant | Guard |
  | --- | --- |
  | Both credentials removed | **passes** |
  | Only the name form removed | **fails** — no immutable-ID-form credential |
  | Branch pair swept up with them | **fails** — names all three ref-form workflows |

  Both forms went together for the reason the second row states: one without the
  other is half a credential and fails on whichever form the token happens to
  carry. If a migration workflow is ever rebuilt it needs both back.

- **The migration-era rehearsal estate is destroyed and the three
  production-write grants are revoked (B6/B7, applied 2026-08-25).** The apply
  reported **3 added, 2 changed, 92 destroyed**. The destroy count matched the
  authorisation in `REVIEW.md` exactly — 90 real destroys plus the 2 azapi
  resources replaced on every apply — which is the number that mattered, since
  the record insisted on approving against addresses rather than a count. The
  adds and changes came in below the recorded 17/5, and that is not a short
  apply: that figure was written before any of it ran, most of those adds were
  the alert rules, and #218 and #219 had already created them (ten of thirteen
  targeted resources, then the remaining three after ARM rejected them at
  create time). By the time this run planned, they were no longer adds.
  Everything was verified after the apply rather than inferred from the plan:
  `rg-db-site-sbx-cus` no longer exists; all four alert rules are still present
  and enabled; and the deploy identity is down to four operational roles — HCW
  Cosmos Container Definition Writer on the production account, Storage Account
  Contributor and Storage Blob Data Contributor on `stsitefuncprodcus01` (the
  Functions **host** account, needed for the deploy firewall window), and
  Website Contributor on the Function App. The three revoked grants were scoped
  to `dbs/hcw` and to `stsiteprodcus01`, the **content** account; none of them
  appears. What this cost is already recorded: with the grants gone the deploy
  identity has no write path into the production Cosmos database or the content
  account, so the delta import is retired for good. The two `data-migration`
  federated credentials survive — `federated_subjects` still emits
  `environment:data-migration` twice — and remain an owner decision (T-524).

- **`REVIEW.md` §4.10 listed the wrong number of Terraform outputs.** It said
  twenty-three and omitted `deploy_principal_id`, because it was assembled by
  reading `infra/outputs.tf` alone while three outputs live in `infra/oidc.tf`.
  There are **twenty-four**, and the section now lists them by file. Corrected
  against the apply's own output block, which is the only listing guaranteed to
  be complete. Recorded rather than quietly fixed because it is precisely the
  drift Part 4 exists to prevent, and it was introduced by the change that
  restored Part 4 four commits earlier.

- **The IaC checks are required to merge, and the three orphaned repository
  variables are gone (T-523 owner half, T-525, 2026-08-25).** Ruleset
  `20680114` now requires **12** contexts rather than 10, the two additions
  being `fmt, validate, tflint` and `Trivy IaC misconfiguration scan`. Every
  "CI enforces this" line in `CONTRIBUTING` is now true when nobody is
  watching, where before a branch with a red Trivy run merged exactly as
  easily as one with a green run. The ordering the item insisted on held:
  #220 removed the `paths:` filter from the `pull_request` trigger first, and
  PR #221 — which touches only `tooling/agent-registry.yml` and no
  infrastructure at all — then confirmed the skip path end to end, its
  `fmt, validate, tflint` job reporting green in 22s with `Detect infra
  changes` succeeded and all six Terraform steps `skipped`. Had the ruleset
  been changed first, that same pull request would have been unmergeable.
  `COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT` and
  `SCRATCH_RESOURCE_GROUP` were deleted in the same pass; `gh variable list`
  now returns 20 names and `REVIEW.md` §4.2 lists exactly those 20, so the
  inventory and the live repository agree with no residue to reconcile. The
  variables named resources that will stop existing when the rehearsal
  teardown applies, and a value nothing reads is a value the next person
  assumes is load-bearing.

- **The frontend is on ESLint 10 (D-001 closed).** The item said two plugins
  blocked it, on the strength of their declared peer ranges. That was half
  right and the wrong half was load-bearing, so it is worth recording what the
  block actually was.

  Dependabot's bump failed at `npm ci`, not at lint — an ERESOLVE refusal from
  `eslint-plugin-jsx-a11y`'s `eslint@"…|| ^9"` peer range. That is metadata, and
  npm `overrides` pinning both plugins' `eslint` peer to `$eslint` clears it.
  What remained was one real incompatibility: every rule that consults the React
  version died with `contextOrFilename.getFilename is not a function`, because
  ESLint 10 removed `context.getFilename()` and `eslint-plugin-react` calls it
  while DETECTING the React version. Detection only runs when
  `settings.react.version` is the literal `'detect'`, so supplying the version
  skips the removed API entirely. The config now reads it from the installed
  `react/package.json` rather than pinning a literal, so an upgrade cannot leave
  the linter reasoning about the wrong React.

  Verified beyond a green run, because a plugin that silently loaded no rules
  would also look green: a probe file confirmed `react/jsx-key`,
  `react/no-unescaped-entities`, `jsx-a11y/alt-text` and
  `react-hooks/rules-of-hooks` all still report on ESLint 10, and `npm ci` — the
  command that actually failed — now succeeds.

  One rule stays off, for a new reason. `jsx-a11y/label-has-associated-control`
  was disabled because it crashed on ESLint 9; on 10 it runs and reports 20 real
  unlabelled form controls. That is an accessibility fix rather than an upgrade,
  so it is tracked as A-001 and the config comment now says so — the stale one
  would have told the next reader the rule was unusable.
- **Listen & Learn spend appears in the portal, and `ai_usage` has one writer.**
  The Usage tab has read that container since the port; until now only the AI
  playground wrote to it, so a Listen & Learn run — the second thing here that
  spends money on a model — would have been invisible. Each run now records a
  row per model call: one for the script, one for the synthesis, tagged
  `listen-and-learn:script` and `listen-and-learn:audio`.

  The writer moved into `ai/usage.js` and `ai/proxy.js` now uses it, because the
  Usage tab does its arithmetic client-side over whatever rows it finds — a
  second writer with a slightly different shape would not error, it would
  silently total zero. Recording is best-effort by design, and a test pins the
  regression that made it otherwise: pricing a row used to happen outside the
  try, so a caller passing an `ai` without `getCostEstimate` threw a TypeError
  that propagated out and failed the episode whose cost it was recording.

  TTS rates are in `COST_TABLE` from the published paid-tier pricing read on
  2026-08-24 — `gemini-2.5-flash-preview-tts` at $0.50 in / $10.00 out per 1M
  tokens, the other two at double that, which is why the flash model is the
  default. Token counts come from the API's own `usage` object; when a response
  omits it the audio count is derived from duration at the documented 32
  tokens/second and the row is flagged `estimatedTokens`, which the portal shows
  as "est." so a derived figure is never read as a billed one. On those rates a
  nine-minute episode is about $0.17 and a five-area certification about $0.87.

  The tab gains a **Breakdown by Feature** table beside the provider one:
  provider answers "which vendor", which is useless when one vendor serves
  several features at rates an order of magnitude apart. The Listen & Learn page
  also reports the run's own cost when the job finishes. A test holds the tab's
  source labels against the backend's `USAGE_SOURCES` so a new source cannot
  ship as a raw slug — the same drift guard `DEFAULT_PROVIDERS` already has.
- **`QueuePage.jsx` is decomposed (T-412).** 1,310 lines became a 320-line page
  over `queue/itemHelpers.jsx`, `queue/QueueList.jsx`, `queue/constants.js` and
  `queue/useQueueActions.js`. The hook is the reason for the split: the bulk
  paths transition many documents one at a time and each partial failure has to
  be attributed back to its own card, and that code could previously only be
  reached by rendering four hundred lines of card markup. It now has 22 tests
  covering the partial-failure paths — a run that half-works removes exactly the
  documents that moved, leaves the ones that did not, and writes a reason under
  each — plus the paging loop's zero-count guard and the rejected-filter
  refusal. Behaviour is unchanged with one fix found by the move: `handleConfirm`
  was `useCallback(..., [confirmTarget])` while closing over handlers rebuilt
  every render, so it could act on `items` and `selectedIds` as they were when
  the modal opened. It is no longer memoized; the dependencies changed every
  render regardless, so nothing was gained by it.
- **Publicly readable blob containers now declare their writer.**
  `PUBLIC_MEDIA_CONTAINERS ⊂ UPLOAD_CONTAINERS` held only because every public
  container happened to be one people upload to. Listen & Learn audio is written
  by a job, so `GENERATED_MEDIA_CONTAINERS` names that category and the test
  asserts each public container has exactly one declared writer and that the two
  sets are disjoint. Satisfying the old relation would have meant opening the
  episode container to the admin upload route, where any editor could put an
  arbitrary file behind an anonymous URL.

### Fixed

- **The alert rules re-notified every five minutes, because a scheduled query
  rule is stateless by default.** `alert-app-exceptions-prod-cus` fired at 23:06
  on 2026-08-25 — the first firing of any rule on this platform — and then kept
  firing. That was not the rule detecting anything new. `autoMitigate` defaults
  to false on `azurerm_monitor_scheduled_query_rules_alert_v2`, and a stateless
  log rule notifies on *every* evaluation whose condition is met, so at `PT5M`
  Azure sends a fresh Sev1 mail every five to ten minutes for as long as the
  condition holds. The window makes it worse rather than better: `PT15M`
  evaluated every `PT5M` means the same burst of exceptions is counted by three
  consecutive evaluations, so the mail continues for a full fifteen minutes
  after the last exception was thrown. `alert-func-latency` was the worst of the
  three at a `PT30M` window — half an hour of mail about latency that had
  already recovered.

  `auto_mitigation_enabled = true` on `alert-func-http5xx`, `alert-func-latency`
  and `alert-app-exceptions`. Each now fires once, stays fired while the
  condition holds, and sends one Resolved mail after the condition has been
  clear for three evaluation periods.

  **Detection is unchanged and nothing is suppressed** — same evaluation
  frequency, same query, same threshold, same severity. That is the entire
  reason this change was made on one night's evidence rather than waiting for
  the week of firing data ADR 0022 asks for: it is the only available remedy
  that does not trade coverage for quiet. Every other lever — filtering the
  query, requiring two failing periods, raising the threshold, lowering the
  severity from Sev1 — makes the rule detect less, and none of them should be
  pulled before the diagnostic query now in
  [Alerting and support](wiki/Alerting-And-Support.md) says what is actually
  throwing. Those levers are documented and ordered there; the thresholds
  themselves remain the first estimates ADR 0022 declared them to be.

  `mute_actions_after_alert_duration` is mutually exclusive with auto-mitigation
  and stays where it already was, on `alert-logs-capacity` alone: its condition
  cannot clear before the 08:00 UTC cap reset, so there is nothing for
  auto-resolution to resolve. The two metric alerts needed no change — metric
  alerts are stateful by default. Recorded as decision 6 in
  [ADR 0022](wiki/0022-alerting-fabric.md).

- **The SCM lock is armed, and the per-run window is proven under `Deny`
  (T-520 closed, 2026-08-25).** `functions_scm_lock_enabled` was set to `true`
  on the `hcw-azure` workspace and applied; `az functionapp config
  access-restriction show` now reports
  `scmIpSecurityRestrictionsDefaultAction: Deny` with a single `Deny all` rule.
  The Kudu endpoint no longer answers the internet.

  Deploy run **32902534458** is the evidence that matters, because arming a
  lock is only half a claim until something has to get through it:

  ```
  scm default action before the window: Deny
  Will use Kudu https://<scmsite>/api/publish to deploy since Flex consumption
    plan is detected.
  Successfully deployed web package to Function App.
  functions registered after sync: 109
  scm window closed — default action 'Deny', no temporary rules left
  ```

  Every part of the design did what it was written to do. The open step read
  the baseline as `Deny` rather than assuming `Allow`, which is why the same
  steps worked unchanged before and after the flip. The deploy published
  through Kudu with the standing default denying everyone else. The close step
  removed the rule, confirmed the posture it found was the posture it left, and
  confirmed no `ci-deploy-scm-*` rule survived — the assertion that keeps a
  window which silently failed to close from passing as a green deploy.

  Sequencing mattered and is recorded because it is the part that would bite on
  a repeat: the window shipped in #220 and was observed working under `Allow`
  (run 32894382986) **before** the variable was flipped. The first deploy after
  a premature flip is the one that cannot get in to fix itself.

  This closes the reachability half of the exposure. The credential half was
  already closed — basic authentication is off on both SCM and FTP — so the
  endpoint now requires an Entra token *and* an allow-listed source.

- **Production deploys could not authenticate at all, and the cause was a
  workflow edit rather than an identity problem.** `de99aa0` put
  `deploy-functions.yml` behind `environment: production` to gate production
  deploys. That is correct in itself and had a consequence nothing accounted
  for: **declaring an environment changes the OIDC subject GitHub composes.**
  It becomes `repo:<org>/<repo>:environment:<name>` rather than
  `repo:<org>/<repo>:ref:<ref>`, so the branch credential cannot match a job
  that names an environment — the ref form is simply not what is presented.
  `infra/oidc.tf` trusted `ref:refs/heads/main` and `environment:data-migration`
  and nothing else, so every production deploy failed at `azure/login`:

  ```
  AADSTS700213: No matching federated identity record found for presented
  assertion subject 'repo:HybridCloudWorks@312844660/
  HCW-HybridCloudWorks@1268997852:environment:production'
  ```

  Observed on run 32892582041, the first dispatch after that merge. It had been
  broken since 2026-08-24 and stayed invisible because no deploy ran in
  between — the failure is silent until someone deploys, and by then it reads
  as a permissions or tenant problem rather than as the consequence of a
  workflow edit.

  Fixed by trusting `environment:production` in both the name and
  immutable-ID forms, matching the existing pair for every other subject: six
  federated credentials against a cap of 20. The branch pair is **not**
  redundant now and must not be swept up in a future `data-migration` cleanup —
  `heal-computed-properties.yml` and `publish-content-manifest.yml` declare no
  environment, so they still present the ref subject. The rule is per-workflow,
  not per-repository.

  **A guard now fails the build instead of a deploy.** `scripts/oidc-subjects.test.mjs`
  cross-references every workflow that uses `azure/login` against the subjects
  `infra/oidc.tf` declares, and fails naming the missing credential and the
  error it would have produced. No linter or `terraform validate` could have
  caught this — both files were individually valid, and only the relationship
  between them was wrong. The guard was verified by reverting the fix and
  confirming it fails, rather than assumed to work because it passes. It also
  asserts both subject forms exist for each environment, since one without the
  other is half a credential that fails on whichever form the token carries.

- **SCM reachability is closed by a per-run deploy window (T-520, #220).**
  `scm_ip_restriction_default_action` was the literal `"Allow"` while the
  front-end origin was locked to `Deny`. Verified against the live app
  2026-08-25: SCM default `Allow`, main site `Deny` with 17 rules,
  `scmIpSecurityRestrictionsUseMain` false. Changing the literal was never the
  fix — the Flex Consumption deploy publishes *through* Kudu and GitHub-hosted
  runners have no stable egress IPs, so a standing `Deny` breaks every deploy.
  `deploy-functions.yml` now opens a window before the deploy and unwinds it
  before the storage window closes. Three things differ from the storage window
  and each is deliberate: no default-action flip is needed, because App Service
  honours SCM IP rules normally where the storage firewall ignores them for
  same-region callers, so the standing posture is never widened; the baseline is
  read rather than assumed and the close step asserts the posture it found is
  the posture it left, which is correct both before and after arming, where
  asserting "`Deny` is back" would fail every deploy until the flip; and the
  open step fails if `scmIpSecurityRestrictionsUseMain` is not false, since SCM
  would then inherit the Cloudflare-only origin lock and the runner would be
  refused with the window apparently open. The close step also asserts no
  `ci-deploy-scm-*` rule survives — a window that silently failed to close is
  worse than one that never opened, because the deploy stays green while the
  endpoint stays admitted. `functions_scm_lock_enabled` defaults to `false`, so
  the apply is a no-op on behaviour; arming it is a workspace edit and the
  window must be observed working on a real deploy first. The credential half
  was already closed: basic authentication is off on both SCM and FTP.

- **`iac-validate` reports on every pull request, so it can become required
  (T-523, #220).** Both jobs are meant to be required contexts on the `main`
  ruleset, and adding them while the workflow stayed path-filtered to `infra/**`
  would have deadlocked the repository: GitHub does not auto-satisfy a required
  context whose workflow was filtered out, so every pull request not touching
  `infra/` would have held at *"Expected — waiting for status to be reported"*
  indefinitely. The trigger therefore changes before the ruleset does.
  `pull_request` loses its `paths:` filter and the filtering moves inside each
  job — check out, diff against the base commit, skip the expensive steps when
  `infra/` did not change — while the job still completes and posts its context.
  `push` keeps its path filter, because required contexts are a pull request
  concern. Two details fail silently if got wrong and are recorded in the
  workflow: `fetch-depth: 0`, since a shallow clone does not contain the base
  commit; and the detect step overriding the terraform job's
  `working-directory: infra`, since run from `infra/` the `^infra/` prefix match
  never matches. Skipping is at step level rather than job level because whether
  a *skipped* context satisfies a required check is behaviour worth not
  depending on. The ruleset half remains owner-gated.

- **The unlabelled form controls are associated, and the rule that finds them
  now runs (A-001, #220).** The rule could not run at all, so the twenty
  violations recorded against it had never been observed: it crashed with
  `(0 , _minimatch.default) is not a function` on the first file containing a
  label, and an ESLint rule crash aborts the entire run. The cause was this
  repository's own supply-chain override rather than the ESLint version.
  `eslint-plugin-jsx-a11y` declares `minimatch: ^3.1.2` and imports it as a
  default export, while `package.json` overrode minimatch to `^10` tree-wide to
  carry the brace-expansion advisory fix — and minimatch v10 exports no default.
  The override that closed one supply-chain hole had silently disabled an
  accessibility rule. Repaired with a scoped override giving the plugin
  minimatch `^3.1.2` (resolves 3.1.5, past the 3.0.5 ReDoS fix) and
  brace-expansion `^1.1.12` (resolves 1.1.18, past the advisory), leaving the
  rest of the tree on 10.2.5; the lockfile change is 38 lines, all additions.
  With the rule running, the twenty findings proved to be two different things.
  Seventeen are genuine — a `<label>` that is a sibling of its control with no
  association, so a screen-reader user gets no field name — fixed by pairing
  `htmlFor`/`id` across `ArchitectureReviewBoard` (2, keyed per hotspot id since
  they render in a map), `FrameworkReviewBoard` (4), `MetadataTab` (4) and
  `SpeakingEventsPage` (7). The other three are not defects: in
  `ListenAndLearnPage` the label already wraps its control, which is an
  association, and the rule reported them only because it cannot see a custom
  `<Input>` as a control. Those are fixed by configuring `controlComponents`,
  because rewriting working markup to satisfy a misconfigured linter would have
  been the wrong repair. The rule is now `error` rather than `off`, so neither
  half can regress.

- **`REVIEW.md` Part 4 is restored as the required-inputs inventory (T-521,
  #220).** `59e471b` cut `REVIEW.md` from 1,011 lines to 58 and moved the
  narrative to the Wiki, leaving twelve references to `PART 4 — REQUIRED INPUTS`
  across eight files pointing at a section that no longer existed. Two of them
  were live procedure with nowhere to land: `CONTRIBUTING` tells a contributor
  to record new required inputs there, and the Deployment Runbook tells an
  operator to move an entry from `SET` to `VERIFIED` after an apply. The defect
  was the absent section rather than the references, so the section is restored
  and all twelve pointers are untouched. Only the inventory comes back — the
  original §4.0 naming and placement rules are now
  `wiki/Variables-And-Secrets.md`'s job, and restoring them verbatim would have
  recreated exactly the duplication the Wiki move ended; each file's intro now
  names the other. The statuses do not share one confidence level and the
  section says so rather than presenting a uniform claim: GitHub variables (23),
  secrets (1) and environments (3) were enumerated live on 2026-08-25, so their
  presence is observed; Key Vault was **not** readable, `az keyvault secret
  list` returning `ForbiddenByRbac` because the caller holds no data-plane role,
  which is itself the correct posture, so §4.6 lists the nineteen secrets
  `infra/main.tf` references — establishing each name and consumer but not its
  presence; and the HCP Terraform workspace was likewise not read, so §4.1's
  statuses are labelled as carried forward from 2026-08-20. The Terraform tables
  are generated from the configuration rather than transcribed: 8 of 58
  variables have no default and must be set in the workspace, and the seven
  posture switches are listed with what arming each one does, since those are
  the entries most likely to be misread as settings. The same live pass is what
  confirms T-525's three scratch variables are still set with no reader, and
  that the `data-migration` environment outlives the workflow deleted in
  `59e471b`.

- **The anonymous feed endpoint is bounded in articles, not just in feeds
  (T-319).** `GET /api/public/feed` capped how many `rss_cache` documents it
  returned but not how many items each one carried, and one document is one
  whole feed — so a hundred bounded documents could still be an unbounded
  response. Each surviving document is now trimmed to its newest twenty items
  by `pubDate`, with `itemCount` rewritten to match so the count cannot
  describe items that are not in the response. Undated items sort last and are
  dropped first (`Date.parse('')` is NaN, and a missing date is not "now", so
  one malformed item cannot evict a dated article); an all-undated feed keeps
  its stored order, and a document whose `items` is absent or not an array is
  passed through untouched rather than turned into a plausible-looking empty
  feed. The read ceiling is a second copy of the ingest writer's
  `MAX_CACHE_ITEMS_PER_FEED` because `public-reads.js` deliberately has no
  imports; `public-reads.test.js` asserts the two agree so they cannot drift.
- **The ingest cap keeps the newest items rather than the first (T-319).**
  `buildCacheItems` sliced the parsed feed in arrival order. Feed order is
  conventionally newest-first but nothing enforces it, and both readers of the
  array sort by `pubDate` — `buildHomepageFeedItems` and `useNewsData.js` — so
  a feed publishing oldest-first cached its archive and never showed its recent
  articles, with the cache looking full throughout. The sort now happens before
  the slice, and `processSingleFeed` no longer pre-slices in feed order, which
  would have decided the selection before `buildCacheItems` could. Drafting is
  unchanged: it still walks the first ten items of the parsed feed.
- **`PATCH /api/cms/{ai-providers|mcp-servers}/{id}` no longer persists the
  `hasOauthToken` read artefact.** `stripOAuthToken` synthesises the flag on
  every read in place of the write-only token, so a form PATCHing a field it
  read back sent the boolean with it — and `putConfig` already dropped it for
  exactly that reason while `patchConfig` did not. Reads recompute the flag, so
  it shadowed nothing; it was a stale copy of a secret's state written next to
  the secret, which a later revoke would not have cleared. A PATCH body left
  with no updatable field after `id` and `hasOauthToken` are dropped is now a
  `400` rather than a write that touches only `updatedAt` and reports success.

### Added

- **The three repository-resolvable test-coverage follow-ups.**
  *API base resolution* — the original line asked for `api.js` with
  `VITE_BACKEND_PROVIDER=azure`, a switch that no longer exists because the GCP
  backend is gone and the Azure base is the only one. `functionsBase.test.js`
  now pins what replaced it: `getEndpoint` composes an authenticated route onto
  the configured base in both topologies and throws naming the route when it is
  unset, an anonymous `publicApi` read goes to the same base, and a source scan
  fails if `VITE_BACKEND_PROVIDER` or any `VITE_GCP_*` variable reappears —
  a reintroduced switch would mean a second resolution path, which is the
  defect that file exists to prevent.
  *Public content limits* — `limit` and `offset` come straight off an anonymous
  query string, so `public-reads.test.js` now covers non-numeric, empty, zero,
  negative, fractional, oversized, `Infinity` and at-the-ceiling values on both
  `listContent` and `listPodcasts`, including that a negative limit clamps up to
  one item rather than producing an empty slice, that an offset past the end is
  an empty page with an honest `total`, and that `limit=0` reads as unset.
  *Partial configuration updates* — `admin-integrations.test.js` now pins that
  a PATCH omitting `oauthToken` never sends the key (so the merge cannot clear
  it), that the untouched token stays out of the response built from the merged
  document, that the read artefact is dropped, that a revoke remains an
  explicit empty-string write, and that an `ai-providers` patch touches only
  the fields it names. `ai_providers` documents hold `apiKeyEnvVar`, the name of
  a server-side setting, never a key — `oauthToken` on `mcp_servers` is the only
  secret value either collection stores.

### Changed

- **Every backend dependency has a live consumer (T-407); nothing was
  removed.** The item asked whether `cheerio`, `rss-parser`,
  `google-auth-library` and the other non-route packages in
  `functions/package.json` still had one. All of them do, and each consumer is
  reachable from a registered function: `cheerio` from `cms/content-quality.js`,
  `content/scrape.js`, `rss/feeds.js` and `sanitize-html.js`; `rss-parser` from
  `rss/ingest.js` (the `fetch-rss-feeds` job and the `syncRssFeeds` timer) and
  `timers/podcasts.js`; `google-auth-library` from
  `cloud-tools/pricing/gcp.js` via the pricing index; and `turndown`,
  `jsonwebtoken`, `jwks-rsa`, `@aws-sdk/client-pricing` and the four Azure SDK
  packages from token verification, scraping, pricing, Key Vault, Blob and
  Cosmos. Recorded rather than closed silently, because "no packages were
  removed" is the finding.
- **The remaining upstream feature candidates are evaluated (T-410).** Measured
  against the Site-Main checkout at `088f458`, the same baseline the T-409
  delta used:
  *draw.io hotspot tooling* is the one candidate worth porting.
  `lib/drawio/parseDrawio.js` and `lib/drawio/hotspotGeometry.js` are 258 lines
  of pure client-side XML parsing with no Firebase coupling and an upstream test
  and fixture; `DiagramPanel`'s only backend seam is an image upload, which maps
  onto the existing `POST /api/cms/uploads/{container}`. It replaces manual
  hotspot authoring — today `ArchitectureReviewBoard` requires each hotspot's
  coordinates and label to be typed by hand — with generation from an uploaded
  `.drawio` file, and `InteractiveDiagram` already consumes the resulting shape.
  *Admin queue improvements* split in two. The bulk select, bulk reject, bulk
  delete and confirm-modal paths already exist in this repository's 1,310-line
  `QueuePage.jsx`; the upstream delta is a decomposition into five modules with
  tests, plus two additional actions (`bulkApprove`, `bulkForge`). The
  decomposition is worth doing against this repository's own file rather than
  porting upstream's, which is written against Firestore-era helpers.
  *The Architecture listing pages* are not worth porting as they stand.
  `ArchitectureDesignsPage` and `ArchitectureCreatePage` are 163 lines between
  them, but they are thin wrappers over `ContentReviewBrowser` (744 lines) and
  the `components/admin/browser/` subsystem, `useAdminBrowser` and
  `lib/adminBrowser` — roughly 1,500 further lines — and their data seam,
  `fetchContentList`, is built from Firestore `where()` clauses. That is the
  whole-branch shape T-410 was written to refuse, and `EditorListPage` already
  filters admin content by type, `architecture` included. Which candidate is
  actually built is a product decision and now sits in
  [REVIEW.md](REVIEW.md).
- **The ESLint 10 upgrade is still blocked, and by fewer plugins (D-001).**
  Re-checked against the registry on 2026-08-24: `eslint-plugin-react-hooks`
  7.1.1 and `@typescript-eslint/eslint-plugin` 8.67.0 now declare
  `eslint@^10`. `eslint-plugin-react` 7.37.5 still caps its peer range at
  `^9.7` and `eslint-plugin-jsx-a11y` 6.10.2 at `^9`, so the frontend stays on
  the ESLint 9 line.

- **Retired the completed migration surface and reset the repository around the
  HybridCloudWorks website.** Removed the old Firebase Functions package and
  Labs agent, the completed Firestore/GCS migration workflow and one-shot
  import tooling, the disabled infrastructure-delivery workflow, and unused
  Firebase hosting, scaffolding, screenshot, generator, and debug scripts.
  Retained the Azure container specification because Terraform still consumes
  it, and retained active Azure operations, CI, deployment, and smoke tooling.
- **Reconciled repository documentation.** `README.md` now documents the
  website's features, architecture, local development, and delivery model;
  `TODO.md` contains only engineer-resolvable pending work; `REVIEW.md`
  contains only human-owned access, approval, credential, and live-verification
  items; and both plans are archived records rather than active instructions.
- **Moved Wiki-as-code to `wiki/`.** The sync workflow and repository policy
  now use the root `wiki/` staging directory, and the Wiki home/sidebar point
  at current website and Azure documentation. All repository workflows use
  GitHub-hosted runners.
- **Removed remaining active cleanup residue.** Deleted the unused Functions
  parity contract and duplicate Markdown bug template, updated current
  infrastructure metadata and operator helpers to reference the website state,
  and allowlisted the repository's reusable `.github/templates/` directory.
- **Retired the unused frontend Firebase platform surface.** Removed the old
  `frontend/firebase.json`, Firebase rules/indexes/storage files, GCP Terraform
  configuration, and dangling test/lint exclusions; the current frontend
  package now validates only the live `src/` tree.

### Security

- **The data-migration workflow can no longer publish production data.** The
  repository is public, and `migrate-data.yml` uploaded `scripts/reports/` —
  document ids and 240-character field samples — as a workflow artifact, while
  the import dry-run printed document samples to the job log. Every migration
  script now writes a `*.summary.json` (counts, container names, warning
  tallies) beside its full report; only summaries are uploaded, with 1-day
  retention; the export lives in `$RUNNER_TEMP` and dies with the runner;
  `MIGRATION_CI=1` makes `--show-samples` an error; and the upload step refuses
  any non-summary JSON it finds.
- **No stored credential on either cloud for the migration.** Firestore and
  GCS reads authenticate through Workload Identity Federation
  (`google-github-actions/auth` + `applicationDefault()`); `connectFirestore()`
  refuses a `service_account` key file in CI, `connectCosmos()` refuses to
  start if `COSMOS_KEY` is set, and `FIREBASE_SERVICE_ACCOUNT_JSON` is retired
  before it was ever provisioned. The `azcopy` storage script — whose GCS
  source accepts only a downloaded key — was replaced by a Node copier on the
  same federated credentials.
- **Production Cosmos is locked by RBAC, not by a YAML guard.** The deploy
  identity's database-scope Data Contributor and blob-write roles on
  production exist only behind `migration_writer_enabled` (default `false`);
  the workflow's refusal of `target=production` for write modes is the second
  lock, not the only one.
- **Every GitHub Actions reference pinned to a commit SHA** — 35 `uses:`
  lines across all 12 workflows. A tag is a mutable pointer: whoever controls
  the action's repository can move `@v4` to different code at any time, and
  the March 2026 Aqua incident that broke this repository's Trivy step was
  exactly that. CodeQL's Actions pack raises one alert per unpinned
  third-party reference, so this closes that class of finding as well as the
  real supply-chain exposure. Each pin carries the version it was cut from as
  a trailing comment (`@ff2f1c6… # v4`), because a bare 40-character hex
  string tells a reviewer nothing; Dependabot's `github-actions` ecosystem
  was already configured and keeps SHA pins current the same way it keeps
  tags current. The repository standard already required this — one
  `actions/checkout` reference had been pinned and the other eleven had not.

### Fixed

- **`CORS_ALLOWED_ORIGINS` could never have worked — the name collides with a
  platform-injected variable** (T-513). App Service injects read-only CORS
  environment variables derived from `siteConfig.cors.allowedOrigins`, which is
  a `string[]`. Ours is unset, so the worker received the serialisation of an
  empty array — the literal two characters `[]` — in place of whatever was
  written to the app setting. `parseExtraOrigins` split that on comma and
  produced one "origin" called `[]`, which matches nothing.

  Renamed to `EXTRA_ALLOWED_ORIGINS`. Nothing here may be called `CORS_*` or
  `WEBSITE_*` again.

  **Three independent writers proved it, and the last one was conclusive.**
  Terraform via azurerm, Terraform via the azapi strip, and a plain
  `az functionapp config appsettings set` each put the correct value in ARM; all
  three times the worker reported `[]`. The final experiment carried **three
  keys in one CLI write** — `RUNTIME_CONFIG_GENERATION`,
  `RUNTIME_CONFIG_WRITER` and the origins. The worker reported the first two
  verbatim and the third as `[]`. Same write, same instant, same process, two
  distinct `HostInstanceId`s. Only the name differed.

  That sequence also **exonerated Terraform and the azapi rewrite**, which had
  been the prime suspect on the reasonable grounds that they were the newest
  thing rewriting the whole settings collection. They were innocent, and the
  generation/writer sentinel is what showed it: the workers reported
  `writer=azapi-strip` and later `writer=cli` with the *current* generation
  every time, so they were never stale and never missed a write. Without the
  writer dimension the conclusion would have been "stale worker" and the search
  would have continued in the wrong place.

- **Telemetry had been dead since 01:33Z and request telemetry had never worked
  at all** (T-514). Two faults wearing one coat, both in `host.json`.

  `log-plat-prod-cus-01` caps ingestion at **0.25 GB/day** and read
  `OverQuota`. What filled it was not the application: `Azure.Core` logged
  **39.3 MB across 76,125 messages** in 24 hours — every SDK HTTP request and
  response at Information, driven by the host's continuous blob-lease polling —
  with `Azure.Identity` adding 4.4 MB. Application logs were collateral. Both
  categories are now `Warning`; fixing the noise beats paying for it.

  Separately, `Host.Results` was set to `Error`. Request telemetry is emitted at
  Information, so that one line emptied the `AppRequests` table permanently —
  it had **zero rows, ever**. That is the table that answers *"did the timer
  fire"*, so Migration_Plan §7's scheduled-job gate was unobservable by
  construction. Restored to `Information`. `Host.Aggregator` was left on
  `Trace`, the most verbose level available, for a diagnosis nobody recorded;
  now `Warning`.

  **Two conclusions this reverses.** The `[cors]` diagnostic from the previous
  entry was written correctly and discarded at ingestion, and the `[telegram]`
  control that appeared to prove "no worker logs reach App Insights" was a
  false negative — worker logging works.

  **And a tooling trap.** `az monitor app-insights query --app <appId>`
  returned zero rows for every query, including with no time filter, while the
  workspace held 138,220 traces. The component is workspace-based with the
  workspace in another subscription, and the proxy returns empty rather than
  erroring. Query the workspace and the `AppTraces` / `AppRequests` tables
  directly.

- **The inbound Telegram bot is ported (T-512), not retired.** Migration_Plan §6
  step 6 said to rewrite `getTelegramWebhookUrl()` and re-run `setWebhook`;
  there was nothing to point a webhook at, because no receiver had been ported
  — `notify.js` only *sends*, and no route accepted a Telegram update (checked
  against the deployed route table, not just the source). Unlike Cloud Tools
  (T-410) or Listen & Learn (T-411) it was never recorded as a deliberate
  demotion, so nobody had decided it. The owner chose to keep the bot.

  `POST /api/telegram/webhook` now serves the eleven commands and the free-form
  Q&A from Site-Main's `telegram-bot.js` + `telegramWebhook`. Two things
  changed in the port, both forced by the platform:

  - **Long commands enqueue instead of running inline.** Upstream answered
    Telegram with 200 immediately and kept working afterwards, which Cloud
    Functions tolerates and Azure does not — an invocation ends at the
    response, so `/forge` and `/inspect` would have been dropped silently
    about as often as they ran. Those two and `/rss` now enqueue the platform
    job that already exists for each (`forge-article`, `batch-inspect`,
    `fetch-rss-feeds`, T-322) and reply with the job id.
  - **The route is anonymous, and that is the only option.** Telegram cannot
    send a bearer token, so `requireRole` has nothing to check. It is guarded
    by two independent checks instead: the
    `X-Telegram-Bot-Api-Secret-Token` header compared in **constant time**
    against `sha256(TELEGRAM_BOT_TOKEN)` — the secret is derived, not stored,
    so there is only one thing to rotate — and the sending chat id against
    `TELEGRAM_CHAT_ID`. The first proves Telegram sent it; the second proves
    the owner did, because anyone who finds a bot can message it. An
    unauthorized chat gets **no reply at all**, so the bot cannot be used to
    confirm it exists. `telegram/webhook` is in `PUBLIC_ROUTES` with that
    reasoning recorded next to it.

  It always answers 200 once the secret validates: Telegram retries non-2xx,
  so a 500 on a bad command turns one broken message into a retry storm that
  re-runs the command every few seconds. 32 tests, weighted on the two
  authorization checks, since a mistake in either makes this an
  unauthenticated remote control for the platform. `scripts/cutover/04-telegram-webhook.ps1`
  re-registers the webhook and preflights the receiver first — a webhook aimed
  at a 404 makes Telegram back off, so the bot stays broken after the real fix.

- **Eight CMS functions never started — seven route templates were each
  declared two or three times (T-510).** The Azure Functions host keys its
  route table on the route template *alone*, not template + method, so two
  functions declaring the same `route` with different `methods` conflict: the
  host starts one and refuses the other with *"is in error: The route specified
  conflicts with the route defined by function X"*. The losing verb answers
  404. `GET`/`PATCH`/`PUT` were lost across `cms/certifications`,
  `cms/certifications/{id}`, `cms/recordings`, `cms/social-posts`,
  `cms/settings`, `cms/config/{collection}/{id}` and
  `cms/keyword-config/{collection}/{id}` — list, edit and save for most of the
  admin UI, all of which the frontend calls. Confirmed live before the fix:
  `POST /api/cms/certifications` 401, `GET /api/cms/certifications` 404.

  Present since the 84-function deploy (App Insights, 21:39:15Z 2026-08-21) and
  invisible because the admin surface is not deployed yet, so nothing had ever
  called them. Each pair is now one registration via the new
  `httpRouteByMethod`, which declares every method on one template and fans out
  on `request.method`; each verb keeps the guard it already had. 79 HTTP
  registrations become 71 and the deploy total 104 → **96, all serving**.

  `route-inventory.test.js` could not have caught it: its mock is
  `http: (name, options) => httpRegistrations.set(name, options)`, a Map keyed
  by function *name*, so both halves of a conflict register and pass properties
  1–3 — every one of them was individually correct. New **property 4** asserts
  no two registrations share a route template (parameter names collapsed, case
  folded, matching how a router compares them) and that every method a merged
  registration declares has a handler behind it. Verified by injecting a
  conflict and watching it fail.

- **The keyless `AzureWebJobsStorage` is written by Terraform, not by the
  deploy** — the attribution in `infra/main.tf` and `deploy-functions.yml` was
  wrong, and the Azure activity log is the only place the two are
  distinguishable: the 20:02Z deploy *deleted* the setting, Terraform's 20:31Z
  apply was the only `sites/config` write after it, and the setting was back.
  `azurerm_function_app_flex_consumption` re-injects it on every apply whatever
  `storage_authentication_type` says, without surfacing it in plan
  ([azurerm#29149](https://github.com/hashicorp/terraform-provider-azurerm/issues/29149),
  open on the pinned 5.1.0). Nothing in this repository can stop the write, so
  it is now **stripped inside the same apply that creates it**: an
  `azapi_resource_action` reads the settings azurerm has just written and an
  `azapi_update_resource` writes them back without that key. The setting never
  survives the run, so there is no post-apply step, no scheduled job and
  nothing to remember. `deploy-functions.yml` **asserts it is absent and fails**
  rather than deleting it — a repair there would hide a regression in the
  strip, which is how this stayed a recurring incident instead of becoming a
  bug: every occurrence was quietly cleaned up by the next deploy.

  Not used: `"AzureWebJobsStorage" = ""`, the workaround the issue is best
  known for — it stopped working in early May 2026, per three reporters — nor
  rewriting the function app as a raw `azapi_resource`, which trades a
  well-understood resource for a hand-written ARM body to dodge one bad key.
  Both misattributing comments corrected; T-511 tracks the upstream close.

- **The public content list failed the moment `PUBLIC_LIST_SQL_ORDER` went
  live** — Cosmos: "The index path corresponding to the specified order-by
  item is excluded". Computed properties are not covered by the `/*`
  wildcard (the comment in `public-reads.js` said they were); `/cp_sortDate/?`
  is now an explicit included path on `content` and `blogs`, applied live
  through ARM with the property preserved and carried in the generated spec so
  Terraform agrees. 40 minutes of 500s on the list endpoint, 2026-08-21.
- **New functions were not registered after the deploy** — SyncTriggers
  failed on a keyless `AzureWebJobsStorage` connection string the deploy
  leaves behind (the same cause as the 2026-08-20 every-route-404). 83
  deployed, 80 registered; `enqueueJob`, `getJob` and the job worker did not
  exist until the setting was deleted and triggers re-synced by hand.
  `deploy-functions.yml` now does both after every deploy and fails if the
  registered count is zero.
- **`cp_sortDate` is live on `content` and `blogs`** (healer run 32448029469,
  2026-08-21, first successful run on this estate) and the healer workflow can
  now be dispatched with `mode=inspect` to check the precondition for
  `PUBLIC_LIST_SQL_ORDER=1`, which `infra/main.tf` now sets — the public
  content list asks Cosmos for the newest N rather than an arbitrary N. T-206's
  final step. The custom role the healer needs is created once by the owner
  from `infra/roles/cosmos-container-writer.json` and consumed by data source;
  the Terraform identity deliberately cannot define roles (#137).
- **The healer can now actually heal.** `heal-computed-properties.yml` had never
  succeeded on this estate: `cp_sortDate` was absent from both `content` and
  `blogs` on 2026-08-21 with 1,142 documents in `content`. Setting
  `computedProperties` is a control-plane operation, and the SDK's
  `container.replace()` sends it to the data plane, which Cosmos refuses with
  an AAD token regardless of roles. `--apply` now does an ARM PUT on the
  container resource (polling the async operation and re-reading to confirm),
  authorized by a new custom role — SQL container read + write on the one
  account, nothing else; not "Cosmos DB Operator", which is
  `databaseAccounts/*` minus keys. `buildArmBody()` strips the read-only keys
  and is unit-tested. New output `cosmos_resource_group` → variable
  `COSMOS_RESOURCE_GROUP` (T-508).
- **`deploy-functions.yml`'s storage window now survives a same-region
  runner** (T-509): the same default-action Allow/Deny bracket
  `migrate-data.yml` gained in #134, with the Deny restored first and verified.
- **`heal-computed-properties.yml` still read `secrets.COSMOS_ENDPOINT`** after
  the value moved to a repository variable and the secret was deleted
  (2026-08-20); its next run failed with "COSMOS_ENDPOINT is not set". Now
  `vars.COSMOS_ENDPOINT`. The #128 changelog entry said both consuming
  workflows had been switched; only `migrate-data.yml` had.
- **`preflight-firestore-inventory.mjs` referenced `FIRESTORE_PROJECT_ID` without
  importing it.** Introduced when the Firestore connection moved into
  `connectFirestore()`; `node --check` and the 65 tests all passed because an
  undefined identifier is a runtime error on a line no test reaches. The
  first `mode=preflight` dispatch from `main` (run 32435060952, 2026-08-21)
  found it — after proving the GCP Workload Identity Federation chain end to
  end, which is the part that could not be tested locally. Fixed, and
  `scripts/` now has an ESLint config with `no-undef` as an error, run by
  the `scripts (migration)` CI job; a sweep of every script found no other
  instance.
- **`migrate-data.yml` carried `COSMOS_KEY` and `COSMOS_DATABASE:
  hybridcloudworks`.** Key auth is disabled on the account and the database is
  `hcw`, so every import would have failed — with an error naming neither.
  Both removed; the workflow also lacked `id-token: write`, so it had no OIDC
  path to either cloud.
- **Eleven `moved` blocks removed from `infra/main.tf`.** Verified no-ops:
  the centralus rebuild recreated every container from the spec while all
  were empty, and `terraform state list` shows only the `for_each` form. A
  three-line note records that the partition-key change happened through the
  rebuild.
- **Stale counts and comments.** `main.tf`'s partition-key comment (67 on
  `/id` and five exceptions, not 62 and four); the `cosmos_database_name`
  comment (the scripts default to `hcw`, not `hybridcloudworks`);
  `cosmos-client.js` (67 of 72, not 66 of 71); and the storage lifecycle rule
  for `articles/` is now documented as inert — Azure matches
  `<container>/<blob>` and no `articles` container exists.
- **`set-github-variables.ps1` and REVIEW §4.2 omitted `FUNCTION_APP_NAME`**,
  which is set and consumed by `deploy-functions.yml`.
- **`Azure/functions-action@v2` does not exist.** Found while resolving tags
  to SHAs: that action's newest tag is `v1.5.7` and its release branch is
  `releases/v1`, so `deploy-functions.yml` carried a reference that resolves
  to nothing and would have failed with "Unable to resolve action" the first
  time the workflow was enabled. Pinned to `v1.5.7`. The workflow is still
  `if: false`, which is why no run had ever surfaced it.

- **`frontend/.env.example` rewritten against the real environment surface**
  (T-403). `VITE_ENTRA_API_SCOPE` was required and undocumented — without it
  every token is acquired for no scope, so sign-in succeeds and every API call
  fails on audience. The file meanwhile documented `VITE_OWNER_ADMIN_EMAIL` /
  `_UID`, which nothing reads, and carried Firebase secret-set instructions for
  decommissioned tooling. Rewritten against the actual `import.meta.env`
  references.

- **`queryDocs` does not discard the continuation token** (T-311) — recorded
  because the opposite was asserted in review, and a wrong finding costs more
  than none. `fetchAll()` consumes the token rather than dropping it: the SDK's
  `toArrayImplementation` loops `while (hasMoreResults())`, accumulating every
  page. No change was made because none was needed.

### Added

- **The visitor-facing upstream delta (T-409).** From Site-Main 088f458,
  with their tests: `RichTextBody` (architecture and framework overviews
  render markdown as markdown, HTML as sanitised HTML), `CoderCornerSnippet`
  + `CodeBlock` (the snippet, language and repository link the coder_corner
  contract requires now render; fenced code gets highlighting and a copy
  button), `WafAssessment` + the vendor Well-Architected pillar sets (a
  Well-Architected tab when an architecture carries `waf`), `FeaturedArchitecture`
  + `colorClasses` (the AWS/Azure galleries' featured panel is data-driven),
  and the Ansible and VMware education data, rendered through a new
  `EducationTracks` component with level filter, learning paths and resources.
- **The eleven Firestore triggers as six change-feed functions (T-324).**
  `functions/src/functions/change-feed.js` registers one `app.cosmosDB`
  function per watched container on the identity-based binding
  (`COSMOS_CONNECTION__accountEndpoint` + `__credential = managedidentity`,
  never a connection string), each with its own `leases` prefix. The
  before-image substitutes are ported from Site-Main `lib/triggers/`: value
  markers (image mirrors, Publer push), the rising-edge claim on an
  etag-conditioned replace (AI cover, slug page), the activation stamp
  (Telegram alerts) and `content_stats_markers` (dashboard counters,
  idempotent). Image mirroring keeps the `{docId}/images/…` blob scheme and
  serves through the media route; the template cover is stored as SVG; the
  AI cover calls Replicate over REST. The three deletes the feed cannot see:
  `DELETE /api/cms/content/{id}` and `deleteContentItem` move the counters,
  `DELETE /api/cms/social-posts/{id}` un-publishes on Publer first, and
  `DELETE /api/cms/blogs/{id}` is new (publisher, audited). `lib/notify.js`
  is the Telegram notifier with its per-source cooldown; resolve/reopen
  clear `activationNotifiedAt`.
- **The external-ingestion timers (T-323, closed).** `syncSocialCalendarScheduled`
  reconciles `social_posts` with Publer (matched posts take Publer's state,
  vanished ones are marked deleted, unmatched Publer posts become
  `publer_<id>`); `fetchBlogListings` scrapes eleven non-RSS listing pages
  through Firecrawl's v1 REST structured extraction into `content` drafts in
  the RSS shape; `fetchPodcastFeeds` upserts PodBean episodes into
  `podcasts`. Each skips itself while its key is a Key Vault stub. Three more
  `FEATURE_FLAG_*` settings, all `"false"`; `SYNC_SOCIAL_CALENDAR` stays off
  until the cutover delta import (D12). Fifteen of sixteen timers are now
  registered; `refreshToolServiceCacheScheduled` stays demoted with Cloud
  Tools.
- **Twelve of the sixteen timers (T-323).** `functions/src/lib/timers/`
  carries `generateReviewerDigest`, `cleanupRejectedContent` (soft),
  `cleanupSoftDeletedContent` (hard, with linked blogs and `content_versions`
  rows), `monitorPublishingPipeline`, `checkLiveLinks`,
  `reVerifyCertifications` (republishes the certifications snapshot),
  `cleanupUnusedCertImages`, `scrapeSkillsHubRss`, `refreshPlaudToken`,
  `forgeScheduled`, and the two stubs — `cleanupTempStorage` (prefix + age,
  not an orphan sweep: T-302) and `checkAgentHealth` (T-401) — each a
  factory with injected store/fetch/storage, registered in `schedulers.js`
  through one flag-gated `timer()` helper with the §4.2 NCRONTAB. The two
  blob-deleting timers are dry-run until `TEMP_STORAGE_CLEANUP_DELETE` /
  `CERT_IMAGE_CLEANUP_DELETE`. Digest, alert and system-audit records go
  through `lib/timers/workflow-records.js`. Ten new `FEATURE_FLAG_*` app
  settings, all `"false"`.
- **`forge-article` and `generate-weekly-digest` platform jobs; the stale-job
  sweeper.** ContentForge's pipeline is ported whole
  (`functions/src/lib/content/forge*.js`, `drafting.js`): dedupe against the
  published corpus, admin-editable profile and prompts from `admin_config`
  with code defaults, format rotation, the forge module instruction and word
  soup, deterministic dash scrub / banned-phrase scan / module repair, the
  best-fit weighted grader with its keyword prescreen, `forge_ready` vs
  `editing` routing, version + audit + `forge_stats` writes. The weekly
  digest drafts from the last N days of live content into `newsletters`
  (`dryRun` previews); the Mailing List page gained the preview and draft
  buttons. `platformJobSweeper` (every 15 min, `FEATURE_FLAG_PLATFORM_JOB_SWEEPER`)
  re-enqueues jobs left `queued` by a failed output binding — the gap
  lib/jobs.js documented. `generate-listen-and-learn` is deferred to T-411
  (three Google services, no frontend here), closing T-322.
- **`batch-inspect` platform job — the article inspector, ported.**
  `functions/src/lib/content/` carries Site-Main's `scrapeArticle`
  (`fetch` + cheerio + turndown; strict TLS; reader and headless fallbacks
  only behind `CONTENTFORGE_SCRAPE_FALLBACK_ENABLED` /
  `CONTENTFORGE_HEADLESS_FALLBACK_*`), `extractPublishedDate`, the voice /
  format-rotation block (`pickNextFormat` off `scrapedAt` in Cosmos, fails
  open), the verbatim analysis system prompt, the critique gate with one
  automatic revision, and `buildInspectionUpdateData` with its upstream
  tests. The job (`inspect-jobs.js`) selects up to 25 `ingested` documents —
  `inspectTrigger: true` first, then unflagged ones that have not failed —
  inspects each 4 s apart, records `inspectError` on failure and keeps
  going; results are counts and ids only. `OpsHealthPage` "Batch Inspect"
  now runs `runJob('batch-inspect', { limit: 10 })`; `batchInspect` left the
  RPC contract. Not ported: the architecture-diagram (multimodal) path — such
  documents record an `inspectError` saying so — and cover-on-inspect.
- **AI router** (`functions/src/lib/ai/router.js`, T-322 §4.4) — ported from
  Site-Main's `ai-model-router.js` with the provider model the owner chose on
  2026-08-21: **a provider is on when its key is present.** Anthropic, OpenAI
  and Gemini (public API by key; Vertex dropped — ADC is a GCP identity the
  app cannot hold), resolved in that order or pinned by
  `CONTENTFORGE_AI_PROVIDER`; an unresolved Key Vault reference counts as no
  key; no key → `AI_NOT_CONFIGURED` with a sentence naming the three
  secrets. `fetch` instead of axios; purpose → model table, JSON repair
  round trip, retry on 408/429/5xx, usage capture with cost estimates and
  the Anthropic prompt-cache marker all kept. 15 tests, none touching the
  network; the upstream cost tests came across.
- **`fetch-rss-feeds` — the first real platform job** (T-322), ported from
  Site-Main's `processRssFeeds`: 20 feeds across 8 providers through
  `rss-parser`, one `rss_cache` document per feed with `items[]` capped at 20
  on write (T-319's write-time cap), new `content` drafts through the
  existing four-stage dedup (≤ 10 per feed), and the `homepage_feeds/latest`
  round-robin aggregate. The admin "RSS Fetch" button enqueues it via
  `runJob()` instead of calling `fetchRssFeedsManual` (which never existed
  here); the `syncRssFeeds` timer stub now runs the same ingest every two
  hours behind its flag. TLS failures skip the feed with the reason recorded;
  one feed failing never abandons the sweep. 17 new tests. Not ported: the
  Telegram alert on feed errors — errors are in the job result.
- **Platform jobs — the pattern for every handler over Flex Consumption's
  230 s HTTP cap** (T-322 scaffold). `functions/src/lib/jobs.js`: a job-type
  registry, `POST /api/enqueueJob` (editor; type allowlist, per-type payload
  cap; 202 + jobId; message to Storage Queue `platform-jobs` through an output
  binding on the identity-based host connection), `GET|POST /api/getJob`
  (viewer), and a queue-triggered worker that claims with an etag-conditioned
  replace — at-least-once delivery never runs a job twice — and records
  `succeeded` / `failed` / `timeout` without rethrowing into the queue. New
  `jobs` container (30-day TTL, indexed like `lab_jobs`). Client:
  `frontend/src/lib/jobs.js` `runJob()` enqueues and polls with the Labs
  backoff. Built-in type `noop`. 14 new functions tests, 5 frontend tests; the
  route inventory now asserts the worker is the only queue trigger.
- **`infra/scratch.tf` — the migration rehearsal estate.** `cosmos-site-sbx-cus`
  (serverless, keys **off**, the same firewall shape, the same `hcw` database
  and the same 72 containers from the same generated spec) and
  `stsitesbxcus01` (the five content containers plus a private
  `migration-reports`) in their own resource group `rg-db-site-sbx-cus`,
  created only while `cosmos_scratch_enabled` / `storage_scratch_enabled` are
  true and destroyed when they are not. Mirrors production's posture on
  purpose: a key-authenticated rehearsal against an open account passes while
  proving nothing about the `DefaultAzureCredential` + RBAC path production
  takes. Outputs via `one()`; `set-github-variables.ps1` wave 2 seeds
  `COSMOS_SCRATCH_ENDPOINT`, `STORAGE_SCRATCH_ACCOUNT` and
  `SCRATCH_RESOURCE_GROUP` from them, and leaves them alone while null.
- **`scripts/migration-probe.mjs`.** One `SELECT VALUE COUNT(1)` that runs
  before the export and classifies a Cosmos 403 as `firewall` or `rbac` —
  two unrelated causes the SDK error does not distinguish, and which would
  otherwise surface only on the first upsert after a full export.
- **`scripts/migrate-storage-to-blob.mjs` + `scripts/lib/storage-manifest.mjs`.**
  Manifest-driven GCS → Blob `--inventory | --copy [--dry-run] [--overwrite] |
  --verify` on `@google-cloud/storage` + `@azure/storage-blob`, idempotent by
  `gcsmd5` metadata, carrying `contentType` / `cacheControl`, with a verify
  that compares counts, bytes, every object's MD5 and a deterministic
  byte-for-byte sample. `--inventory` exits 2 on an unmanifested prefix,
  mirroring the Firestore preflight. A vitest suite asserts every target
  container is one of the five Terraform names. Replaces
  `migrate-storage-to-blob.sh`.
- **Wiki pages `Migration-Runbook` and `Phase-4-Data-Migration`.**
  Referenced from eleven places (README, the plan, `_Sidebar`, the workflow,
  the manifest header); neither existed. The runbook is the twelve-step
  operator sequence with the evidence each step produces; the Phase-4 page is
  the decision log.
- **`WEBSITE_TIME_ZONE = "America/Chicago"` on the Function App.** Eight of
  Site-Main's sixteen schedules are declared in that zone; NCRONTAB on Linux
  evaluates in UTC unless told otherwise.
- **`storage_resource_group` output**, pairing with `storage_account` the way
  `web_resource_group` pairs with `functions_storage_account` — what
  `migrate-data.yml` scopes its per-run firewall window to.
- **The HCP Terraform → Azure bootstrap, which existed nowhere.**
  `infra/providers.tf` declares the `azurerm` provider with no credential —
  correct, because runs execute under HCP Terraform dynamic provider
  credentials — but the identity those credentials assume has to exist
  first, and nothing in this repository could create it. `infra/oidc.tf`
  creates the *GitHub Actions* identity, which only exists after a
  successful apply. Terraform cannot create the credential Terraform
  authenticates with. A repository-wide grep for `ARM_CLIENT_ID`,
  `TFC_AZURE_*` and `app.terraform.io` across `.tf`, `.yml` and `.md`
  returned nothing: the first apply had no documented path to authenticate,
  and the gap was invisible to file-by-file review because every individual
  file was correct and only the join between them was missing.

  `scripts/bootstrap-terraform-oidc.ps1` closes it. It creates
  `rg-hcw-bootstrap`, the `id-hcw-terraform` user-assigned managed identity,
  two federated credentials against `https://app.terraform.io` — one per run
  phase, because Entra matches token subjects exactly and case-sensitively
  with no wildcards, so a single credential leaves every apply failing at
  authentication while every plan succeeds — and Contributor plus Role Based
  Access Control Administrator at subscription scope (Contributor cannot
  create the role assignments `infra/` declares; RBAC Administrator cannot
  grant Owner, so the identity cannot escalate itself).

  A managed identity rather than an app registration, for the reason
  `infra/oidc.tf` already documents: app registrations need Application
  Administrator in Entra, which Azure Owner does not grant. The identity is
  deliberately **outside Terraform state**, in its own resource group —
  Terraform managing the credential it authenticates with means a destroy or
  a bad plan locks the workspace out of the subscription with no way back.

  The script is idempotent and preflights before it proposes anything: CLI
  present, signed in, tenant matches, subscription visible, role-assignment
  rights held, `Microsoft.ManagedIdentity` registered. Sign-in is performed
  by the script rather than demanded of the operator — being signed in to a
  different directory is the normal state for anyone working across tenants,
  so it runs `az login --tenant` itself and re-reads the account afterwards,
  because a directory switch also changes which subscriptions are visible.
  `-DeviceCode` covers sessions with no browser of their own (SSH,
  containers, Cloud Shell) and the case where the browser keeps reusing the
  wrong cached account; the script falls back to it automatically when the
  interactive flow fails, since that failure is environmental — no display,
  no loopback — more often than it is a credential problem. It handles the
  fresh-tenant case explicitly — a Global Administrator holds no Azure RBAC
  by default, which produces errors that suggest the wrong fix, so
  `-ElevateAccess` takes the documented one-time root-scope elevation, grants
  Owner on the target subscription, and removes the root grant again.

  Documented in Deployment Runbook §0 (which now tables the two OIDC
  handshakes side by side — confusing them strands the operator hunting for a
  `CLIENT_ID` that does not exist until after the first apply), CHECKLIST §8
  (the four workspace environment variables, contractual and exempt from the
  2-word rule), and REVIEW §4.0. The `iac-repo-standardizer` agent and the
  IaC Repository Standard both gained a **bootstrap identity** section making
  this the first thing audited on any repository, since the failure
  generalizes to every credential-free IaC repo.

### Changed

- **`migrate-data.yml` rewritten.** Dispatch-only; `id-token: write`;
  `environment: data-migration`; modes `preflight | inventory-gate |
  export-dry-run | rehearse | verify | storage-inventory | storage-rehearse`
  with `target` ∈ `scratch` (default) | `production` and a hard refusal of
  write modes against production. Step order is a correctness constraint:
  `npm ci`, the Site-Main checkout and the Cosmos probe all run before
  `google-github-actions/auth`, because the GitHub OIDC token it exchanges
  lives five minutes. Per-run storage firewall window with `always()` cleanup,
  mirroring `deploy-functions.yml`. `COSMOS_DATABASE: hcw`. Inputs reach the
  shell through `env`, never interpolated into `run:`.
- **`COSMOS_ENDPOINT` is a repository variable, not a secret.** It is a public
  URL and a non-sensitive Terraform output; as a secret it was masked in logs
  and unverifiable in the UI. `set-github-variables.ps1` now seeds it as a
  variable and deletes the old secret; both consuming workflows read
  `vars.COSMOS_ENDPOINT`. The script also takes
  `-GcpWorkloadIdentityProvider` / `-GcpServiceAccount` for the two WIF
  identifiers, and seeds `STORAGE_ACCOUNT` / `STORAGE_RESOURCE_GROUP`.
- **Migration scripts share one credential path.** `scripts/lib/cli.mjs` gains
  `connectFirestore()` (ADC, explicit `projectId`), `connectCosmos()`
  (`DefaultAzureCredential` only), `connectBlob()`, `classifyCosmosError()`,
  `writeReport()` (full report + publishable `.summary.json` sibling) and
  `showSamples()`; the migrator, preflight and verifier use them. The
  manifest is re-baselined at Site-Main `088f458` with `azure_architectures`
  and `azure_frameworks` added as `probe` — not provisioned, so the generated
  container spec is unchanged.
- **`Migration_Plan.md` rebaselined against Site-Main @ `088f458`.** §0 is now
  donor/recipient with a pinned baseline instead of "reconcile weekly" (the
  two repositories finished Phase 1 in incompatible directions); §2 carries
  real status; §4 carries the measured inventories — the six HTTP handlers
  over the 230 s Flex cap, the 16 timers with NCRONTAB and zone, the 11
  triggers with change-feed disposition and the three delete paths the feed
  cannot deliver, and the Vertex-default finding; §5 is rewritten around the
  tooling defects, the rehearsal estate, the five dispositions, the storage
  manifest and the public-repository rule; §6–§9 updated to match. The two
  links to the wrong GitHub org are gone.
- **Every image render site routes through `resolveMediaUrl()`** (T-318,
  sixteen files, commit `09154ad`). Stored site-relative
  `/api/public/media/...` paths now resolve against the Cloudflare API host,
  which the origin lock made the only working shape; absolute legacy URLs
  pass through untouched.
- **`oidc.tf`'s "deliberately NOT granted" note** now says what is true: the
  migration *does* use the deploy identity, on the scratch account at
  database scope, and holds nothing extra on production while
  `migration_writer_enabled` is off.
- **Every Terraform output renamed to the 2-word standard** (workload owner
  directive, 2026-08-18: `github_deploy_client_id` was four words). The
  standard now explicitly covers **outputs** — they are operator-facing,
  read off the state backend's Outputs tab — and states that **casing
  follows the language while the word count does not**: UPPER_SNAKE for
  GitHub variables, lower_snake for HCL. Outputs that feed a GitHub
  variable now mirror it: `client_id` ↔ `CLIENT_ID`.
  Headline renames: `github_deploy_client_id`→`client_id`,
  `github_deploy_federated_subjects`→`federated_subjects`,
  `function_app_default_hostname`→`function_hostname`,
  `static_web_app_default_hostname`→`swa_hostname`,
  `app_insights_connection_string`→`insights_connection`,
  `ci_runner_job_name`→`runner_job`. Two genuine **duplicates removed**:
  `azure_functions_hostname` and `azure_swa_hostname` returned values
  identical to their non-prefixed twins and were folded into one output
  each. One genuine **collision** resolved with a deliberate third word —
  the Function App and the deploy identity both expose a principal id, so
  `app_principal_id` / `deploy_principal_id`. No resource address,
  `azurerm_*` argument, or state-bearing name changed; `terraform fmt`
  and `validate` pass.
  Terraform **input** variables were deliberately NOT renamed: they must
  match HCP Terraform workspace keys exactly and several are set live, so
  they are a coordinated setting-plus-code change — filed as TODO T-507
  with the full proposed table. App settings read via `process.env`,
  `VITE_*` and `GITHUB_TOKEN` are contractual and untouched. The
  `iac-repo-standardizer` agent now sweeps every `.tf` file rather than a
  curated list — the gap that let `ci_runner_job_name` survive the first
  pass. (PR #117)

### Added

- **Free-tier disposition recorded on the Cost-Analysis wiki page** (now
  wiki-as-code, staged in `.github/wiki/`). Decisions from the workload
  owner's free-services meter review: runner image **stays on Docker Hub**
  (ACR rejected — month-13 cost for a failover-only image); Cosmos free
  tier is unusable by design (serverless); Service Bus / VM / SQL / LB
  12-month meters rejected as expiring traps; blob + egress discounts are
  automatic. Adds the standing **AI options reference** for the future AI
  RPCs: always-free F0 SKUs per task (Translator, Language, Vision,
  Content Safety, Document Intelligence, Speech) with the mechanics that
  make them budget-safe (throttle-not-bill on quota, create directly with
  F0 — Foundry-provisioned resources default to S0, keyless applies) and
  the explicit note that generative drafting/image work has no free Azure
  tier — that is Azure OpenAI or the SaaS keys. (PR #116)

- **CodeQL `actions` language added to the advanced matrix** — the retired
  Default setup had been scanning workflow files (`language:actions`); the
  advanced setup now owns that coverage across the repository's 12
  workflows. Context: the Tool status page's erroring `language:go` /
  `language:java-kotlin` entries are stale Default-setup configurations
  auto-created ~3 weeks ago from stray Go/Java snippet files inside the
  vendored `.claude/` harness — the exact paths the advanced config
  excludes. Those languages are deliberately NOT added to the matrix; the
  stale configurations are removed operator-side from the Tool status
  page's ⋯ menu. (PR #115)

- **Variable naming standard** (workload owner directive, 2026-08-18) —
  operator-set configuration names are UPPER_SNAKE_CASE, **maximum 2
  words** (3 only to break a real collision), with no provider prefixes:
  `CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, `RESOURCE_GROUP`,
  `APP_HOSTNAME`. Contractual names (`VITE_*`, `GITHUB_TOKEN`) are exempt.
  Applied immediately to every workflow-consumed repository variable —
  all were still unset, so the renames are free: `AZURE_CLIENT_ID`→
  `CLIENT_ID`, `AZURE_TENANT_ID`→`TENANT_ID`, `AZURE_SUBSCRIPTION_ID`→
  `SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`→`RESOURCE_GROUP`,
  `FUNCTION_APP_HOSTNAME`→`APP_HOSTNAME` (`FUNCTIONS_STORAGE_ACCOUNT`
  keeps its third word to avoid colliding with the content account).
  The standard is codified in the `iac-repo-standardizer` agent — which
  now sweeps `vars.*`/`secrets.*` on every standardization run — and in
  the Wiki IaC-Repository-Standard page; CHECKLIST §7 carries the rule and
  an `APP_HOSTNAME` row. (PR #114)

- **Apply verification for the T-503–T-506 hardening (2026-08-18)** — the
  operator applied the full set in HCP Terraform; cold start passed,
  verifying the T-503 VNet runtime/package-pull path directly. A post-apply
  `validate-deployed` run is byte-identical to the pre-apply baseline (no
  external regression), and Repository Policy / IaC Validation / CI /
  CodeQL are all green on `main`. One verification remains blocked:
  `heal-computed-properties` — the probe for T-504's `0.0.0.0`
  Azure-datacenter sentinel — fails at Azure login because the
  `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID`
  repository variables were never set (a pre-existing gap, failing on every
  run before the hardening too; now recorded in CHECKLIST §7). Evidence
  table published as an addendum to the Wiki Resource-Validation-Report;
  plan v0.2 dispositions moved to APPLIED. (PR #112)

- **T-503 — Functions host storage network-restricted** (apply pending in
  HCP Terraform; the last item of the T-50x hardening series). The host
  storage account moves to default-Deny with three deliberate survivors:
  the Flex app's runtime/package-pull path (VNet integration + new
  `Microsoft.Storage` service endpoint on the integration subnet — which
  also makes the content account's existing subnet rule provably
  non-inert), a per-run firewall window in `deploy-functions.yml` (add
  runner IP → deploy → always-run remove) under a new Storage Account
  Contributor grant scoped to exactly this account, and operator windows
  via `functions_storage_admin_ip_rules`. Rollback is one variable:
  `functions_storage_network_default_action = "Allow"`. The
  `#trivy:ignore:AVD-AZU-0012` suppression is deleted — the CI gate now
  enforces the control it previously excused. New required inputs
  `AZURE_RESOURCE_GROUP` and `FUNCTIONS_STORAGE_ACCOUNT` recorded in
  CHECKLIST §7. Verify after apply with a functions deploy **and** a
  cold-start invocation. (PR #111)

- **T-504/T-505/T-506 — the security and observability remediation ADR-0018
  refused to ratify, now implemented in Terraform** (apply pending in HCP
  Terraform). **Cosmos hardening (T-504):** VNet service firewall allowing
  the Functions integration subnet (new `Microsoft.AzureCosmosDB` service
  endpoint), the `0.0.0.0` Azure-datacenter sentinel so
  heal-computed-properties keeps working from GitHub-hosted runners
  (variable-gated to drop later), operator-window `cosmos_admin_ip_rules`,
  `local_authentication_disabled` (variable, default true), and continuous
  backup (free 7-day tier). **Observability layer (T-505):**
  `infra/observability.tf` adds the `ag-hcw-ops-prod` action group and
  diagnostic settings for Key Vault, Cosmos (the plan's four categories),
  the content blob service and Azure OpenAI; the budget gains the approved
  50/75/90/100 ladder plus a Forecasted-at-100 alert routed through the
  group; Log Analytics gets the 0.25 GB/day cap. **Keyless OpenAI (T-506):**
  custom subdomain (planned replacement of the stateless account + both
  deployments — `openai-client.js` has zero importers, so nothing breaks),
  `local_auth_enabled = false`, Cognitive Services OpenAI User for the
  Function App identity, the primary-key output deleted, and an
  `AZURE_OPENAI_ENDPOINT` app setting for future keyless wiring. Plan
  v0.2-as-built dispositions updated to "resolved in code, closes on
  apply". (PR #108)

- **Infrastructure plan v0.2-as-built and ADRs 0018–0021** — implements the
  REVIEW §8.2 decision (workload owner, 2026-08-18) to supersede plan v0.1
  with a plan that describes the real system. `.azure/infrastructure-plan.json`
  is now version `0.2-as-built`: every implemented resource with its
  as-built properties, each deviation from v0.1 dispositioned as either a
  ratified decision or explicitly-unratified remediation debt (T-503–T-506,
  purge protection). Four ADRs staged to the Wiki: **0018** (umbrella
  supersede + disposition table), **0019** (single Function App —
  supersedes ADR-0004), **0020** (flat native Terraform root module —
  supersedes ADR-0005's AVM clause, resolves TODO T-502, and rewrites the
  README AVM guardrail to "pinned versions, stable addresses"), **0021**
  (Container Apps CI runner ratified as failover-only). ADR register
  updated; ADR-0004 marked superseded. New TODO **T-506** (keyless Azure
  OpenAI: RBAC grant, delete the key output, disable local auth).
  (PR #107)

- **Resource validation pass, first execution (2026-08-18)** — results
  published as the Wiki **Resource-Validation-Report** page (staged in
  `.github/wiki/`, linked from Home and the sidebar). External surface:
  edge live, TLS healthy to 2026-09-28, `www`/`api-azure` NXDOMAIN
  (consistent with same-origin), but Cloudflare bot challenge blocks all
  datacenter-IP validation of the origin. Plan-vs-code parity: ~40% of the
  approved plan's resources implemented, with material security-posture
  deviations (Cosmos open to the internet with key auth on, LRS vs ZRS,
  purge protection defaulted off, ungated keyed OpenAI) and material
  never-planned resources (CI runner, 71 containers, model deployments).
  Follow-ups filed: TODO T-504 (Cosmos hardening), T-505 (observability
  control layer); human decisions REVIEW §8.1 (Cloudflare synthetic-access
  rule) and §8.2 (reconcile implementation to plan, or supersede the plan
  as-built). (PR #106)

- **`validate-deployed.yml` — on-demand deployed-surface validation** — a
  `workflow_dispatch` workflow running the externally observable half of the
  Deployment Runbook's §4 verification from a GitHub-hosted runner: DNS for
  the apex/`www`/`api-azure` names, TLS certificate inspection, frontend
  status + security headers, and `scripts/smoke-deployed.mjs` tier 1
  (anonymous, no side effects) against a dispatch-time base URL (default
  `https://hybridcloudworks.com/api`). No secrets or cloud credentials —
  same doctrine as `ci.yml`; smoke tiers 2–3 remain operator-run. Results
  land in the job summary. The staged Deployment Runbook §4 references it.
  (PR #105)

- **IaC repository standardization** — the repository now carries the
  baseline governance surface expected of a permanent infrastructure repo:
  `.github/CONTRIBUTING.md`, `.github/SECURITY.md`, `.github/CODEOWNERS`, a
  pull-request template with a Terraform-plan gate, issue templates
  (including an infrastructure change request with blast-radius and rollback
  prompts), a root `.editorconfig`, and `infra/README.md` documenting layout,
  working rules, guardrails and the ALZ-absorption posture. The repository
  policy script allowlists exactly these files; narrative documentation still
  belongs in the Wiki. A new `iac-repo-standardizer` agent
  (`.claude/agents/`) encodes the standard so future repositories can be
  brought to the same baseline.
- **IaC validation gate** — `.github/workflows/iac-validate.yml` runs
  `terraform fmt`, `terraform validate` (via `init -backend=false`, so no
  credentials or state access), tflint (`infra/.tflint.hcl`) and a Trivy IaC
  misconfiguration scan on every pull request touching `infra/**`. Until now
  nothing validated Terraform changes at all while the prototype delivery
  workflow stayed disabled.
- **`prevent_destroy` guards on stateful resources** — the Cosmos DB account,
  both storage accounts and the Key Vault now refuse plans that would replace
  them; removing a guard is itself a reviewed change. Applied together with
  the `terraform fmt` drift that had accumulated in `main.tf`.
- **Deployment Runbook and IaC Repository Standard as wiki-as-code** — the
  day-1 apply procedure, day-2 operations, ALZ-absorption sequence, and the
  standard this repository now conforms to, staged under `.github/wiki/`
  (with updated `Home` and `_Sidebar`) and published to the GitHub Wiki by
  the new `sync-wiki.yml` workflow on merge to `main`. The workflow overlays
  staged pages only — unstaged wiki pages remain UI-editable — and uses the
  built-in `GITHUB_TOKEN`, so no PAT or additional GitHub App is required.
  Staged pages become repository-owned: they get PR review like the code
  they describe. The sidebar's repository links now point at the
  HybridCloudWorks org instead of the pre-move personal fork.

### Fixed

- **`iac-validate.yml` Trivy job unresolvable action pin** — the gate shipped
  in PR #103 referencing `aquasecurity/trivy-action@0.28.0`, a tag that no
  longer resolves: Aqua's 2026-03-19 security incident (trivy discussions
  #10425) saw trivy-action git tags re-pointed to malicious commits, and the
  v0.69.4 binary release was itself malicious. The job now installs the
  Trivy **binary** pinned to v0.69.3 — the latest release the advisory names
  safe — from the project's own release artifacts, verified against the
  release checksum manifest, and no longer uses the marketplace action at
  all. (PR #104)

### Changed

- **`deploy-infra.yml` rewritten while remaining hard-disabled** — the
  prototype workflow applied with `-auto-approve` on every push to `main`,
  masked failed plans with `continue-on-error`, and used unpinned actions.
  The replacement is `workflow_dispatch`-only, runs in a `production-infra`
  GitHub Environment for required-reviewer approval, starts an HCP Terraform
  run whose apply is confirmed in TFC where the state lives, and keeps the
  `if: ${{ false }}` gate until production applies are authorized.

- **Self-healing computed properties** — `.github/workflows/
  heal-computed-properties.yml` re-applies `cp_sortDate` on any push touching
  the Cosmos Terraform or container manifest, and every six hours — because
  Terraform applies run in TF Cloud on their own clock, a push-time heal can
  itself be overwritten, so the schedule is what guarantees the wound closes.
  With `PUBLIC_LIST_SQL_ORDER=1` live, a wiped property breaks the public
  content list, which is why this is automation rather than a runbook note.
  The OIDC deploy identity gains Cosmos Data Contributor scoped to exactly the
  `content` and `blogs` containers (`infra/oidc.tf`) — the one documented
  exception to its deliberate no-Cosmos posture, and the healer fails loudly
  on a schedule until that assignment is applied. (TODO.md T-206 follow-up)

- **`cp_sortDate` computed property + flag-gated ORDER BY** — T-206's last
  step, authored as operator tooling. `scripts/apply-computed-sortdate.mjs
  --inspect` reports non-ISO date values (the evidence gate), `--apply` adds a
  computed property that resolves the five published-date aliases server-side
  with a total fallback, and `PUBLIC_LIST_SQL_ORDER=1` then makes the public
  list's TOP window return the newest N documents instead of an arbitrary N.
  A computed property rather than a materialized field: no backfill, no
  write-site maintenance, and it cannot be missing — which is what makes
  ORDER BY on it safe under the module's own rule 2. The azurerm provider
  cannot express computed properties, so the script is the applier and the
  manifest records the drift hazard: a terraform apply that updates the
  container wipes the property. Applied to the live containers and flipped on
  2026-08-14; the deployed smoke test passed against the ordered window,
  closing T-206 entirely. (TODO.md T-206)

- **Deployed smoke test** — `scripts/smoke-deployed.mjs`, the runnable half of
  the work order's top item. Tier 1 exercises the anonymous surface with no
  side effects: the public filter and T-206 projection (asserting the eight
  excluded body fields stay excluded and `explanation` does not false-alarm),
  guard liveness on admin RPCs, CORS refusal and preflight, negative-cache
  headers, the health endpoint's non-disclosure, and that the seventeen
  notImplemented RPCs still 404. Tier 2 (`--cosmos`) executes the one
  assumption nothing has executed: that a failed Cosmos patch predicate
  surfaces through the JS SDK as code 412 and a missing document as 404 — the
  submission quota's correctness rests on it; it writes a single smoke-prefixed
  document into the TTL-bounded `submission_quota` container and deletes it.
  Tier 3 (`SMOKE_BEARER_TOKEN`) verifies a real token is admitted. Six unit
  tests pin the script's own assertion helpers, because a smoke test with a
  wrong filter passes against a broken deployment.

- **Anonymous public read API** — `GET public/content`, `public/content/{slugOrId}`,
  `public/snapshots/{id}`, `public/podcasts`, `public/feed`. The published/draft
  boundary is enforced server-side, replacing the Firestore security rules that
  previously performed that role. (#45)
- **Rate-limited public submission endpoint** — `POST public/submissions` with
  per-type validation, server-side document composition, and a rolling-hour
  anonymous quota, closing the unauthenticated `addDoc`-into-content path. (#45, #66)
- **Admin CMS REST surface** — certifications, social posts, recordings, speaker
  events, settings, images, AI providers / MCP servers, and usage records under
  `cms/*`, all behind the two-gate role guard. (#46, #47)
- **Authenticated file upload endpoint** — `POST cms/uploads/{container}` with a
  container allowlist, blob-path validation, and a server-enforced 15 MB decoded
  cap, replacing direct browser writes to Firebase Storage. (#62, #65)
- **Content pipeline RPCs** — `createContentItem`, `updateContentItem`,
  `transitionContentStatus`, and the publish pipeline, ported with their original
  dedup, quality-gate, state-machine, and audit semantics. (#43, #44, #59)
- **Admin identity, snapshots, ops health, content workflow, gallery, labs, and
  image-prompt RPCs** — 34 named RPCs total. (#50, #54, #55, #56, #57, #58)
- **`getLabJob` RPC** — single lab job with output, replacing the Labs console's
  per-document realtime subscription. (#65)
- **`GET public/platform-health`** — the landing page's four cloud-status
  indicators, ported from the Firebase original. Anonymous, with a five-minute
  cache that is the only thing bounding how hard the route can be made to hit
  four third-party status APIs; each provider degrades to `UNKNOWN`
  independently and the handler never returns 500, because a dead upstream must
  not blank the panel. Ported without adding a dependency — `axios` and
  `rss-parser` stay unreachable. (TODO.md T-316)
- **`POST cms/telemetry/legacy-blogs-read`** — the counter that will justify
  retiring the `blogs` fallback container. Guarded at `viewer`, unlike the
  anonymous Firebase original: its only caller is an admin page, so anonymity
  bought nothing and left an unauthenticated write endpoint anyone could use to
  poison the evidence. (TODO.md T-316)
- **Anonymous media delivery** — `GET public/media/{container}/{*blobPath}`,
  serving uploaded images through the Function App's managed identity with
  immutable cache headers and conditional-request support. The storage account
  stays closed to the internet; the container allowlist is a strict subset of
  the containers uploads may write to. (TODO.md T-105)
- **Self-hosted CI runner** — Azure Container Apps Job with KEDA scale-to-zero, an
  ephemeral JIT-config runner image published to Docker Hub with a GHCR mirror,
  and a `CI_RUNNER` repository-variable failover switch. (#48)
- **Labs agent API** — `POST agent/claimLabJob`, `agent/heartbeat`,
  `agent/completeLabJob`, behind a machine-identity guard (`LabAgent` App Role
  plus a `lab_agents/{agentId}` registry document bound to the credential's
  object id) that is disjoint from the admin role hierarchy. Claim atomicity is
  an ETag-guarded write with a lease, so a dead agent's jobs are picked up
  rather than stranded. (TODO.md T-401)
- **`code-reviewer` agent** — carries the Code Review SOP (CODE_REVIEW_PROMPT.md
  v1.0) as agent 39 of the harness. (#68)
- **SOP working documents** — `TODO.md`, `CHECKLIST.md`, `CHANGELOG.md`.

### Changed

- **Firebase-era smoke scripts and nested workflows removed.** Three live smoke
  scripts read `VITE_GCP_FUNCTIONS_URL` and built a `firebaseConfig` from
  `VITE_FIREBASE_*` — none of which the application sets any more, so they could
  not run — and `frontend/.github/` held the source repository's Firebase deploy,
  E2E and secret-rotation workflows, inert but reading as live configuration.
  Deleted rather than ported: a half-migrated script that looks runnable and is
  not is worse than no script, which is exactly what these were. A deployed
  smoke test is still wanted, written against Entra and the Azure routes.
  (TODO.md T-317)
- **Six unused dependencies dropped** from the functions package — `sharp`,
  `replicate`, `turndown`, `@mendable/firecrawl-js`, `axios` and `rss-parser`,
  none of them referenced anywhere under `src/`. (TODO.md T-407)
- **Frontend decoupled from Firebase.** All 34 files importing `firebase/firestore`,
  5 importing `firebase/auth`, and 4 importing `firebase/storage` now call the
  Azure Functions API. Public pages (#61), admin CRUD (#62), shared config
  libraries (#63), workflow pages and the editor (#64), remaining admin pages
  (#65), and submission forms (#66). The production bundle no longer contains a
  Firebase chunk.
- **Admin authentication swapped to Entra ID via MSAL** — `firebase/auth`
  eliminated from the admin surface; MFA is now an Entra Conditional Access
  policy rather than app-managed phone MFA; the Entra object id is the
  `admins/{oid}` registry key. (#60)
- **Realtime listeners replaced with polling** — the content editor polls its
  document every 20 s, the Labs dashboard polls a snapshot RPC every 15 s, and
  the Labs console polls an active job every 5 s. Conflict detection and
  online/offline semantics are preserved. (#64, #65)
- **`Review.md` renamed to `REVIEW.md`** and its scope narrowed to
  human-resolvable blockers, per the SOP.
- **Repository structure policy** (`scripts/validate-repository-structure.ps1`)
  now requires the five SOP documents, permits them at the root, and rejects
  case variants of their filenames.

### Fixed

- **The frontend CI gate now runs the whole test suite.** `test:admin` was a
  hand-curated file list — every new test file had to be added by hand, and
  eight known-stale failures elsewhere were simply never run. The eight were
  stale expectations, not application defects, and are fixed: the route
  contract now asserts the real pages behind `/gcp`, `/terraform`, `/github`,
  `/finops`, the three `/tools` routes and the two news routes (mocked, as the
  suite already did for other providers); and the PublishedPage tests drive
  the publish flow that actually exists — a pre-publish checklist modal whose
  "Publish Now" is what publishes — with the checklist itself now unit-tested.
  `test:admin` is plain `vitest run`; the one legitimately unrunnable file
  (`firestore.rules.test.js`, which needs the retired Firestore emulator
  setup) is excluded in vitest.config.js with the reason recorded.
  Default run: 15 files, 115 tests. (TODO.md T-320)
- **One anonymous list request could eat four seconds of the database's entire
  budget.** The public content list ran `SELECT TOP 1000 *` with no WHERE — an
  *arbitrary* 1000 documents of a ~1k-document container (so published articles
  could vanish from listings non-deterministically, made intermittent by the
  300 s cache), each transferred whole at ~20 KB including article bodies no
  list consumer renders. The public filter now runs in SQL, so the window
  counts published documents of the requested type/provider; and the projection
  is an audited explicit field list — the union of what the public list
  consumers actually read, pinned by a test naming the consumer behind each
  field. Of nine heavy body fields exactly one has a list reader
  (`explanation`, a Coder Corner excerpt fallback); the other eight stay out,
  which is where the RU win lives. The in-memory sort and the ORDER BY
  avoidance stay until a materialized sort field plus composite index can be
  deployed. (TODO.md T-206, steps 1–2)
- **The API contract can no longer lie about what exists.** It documented
  seventeen RPCs the admin UI invokes that were never registered — every call a
  live 404, invisible because nothing compared the document to the code. The
  contract now carries an explicit `rpc.notImplemented` block (all seventeen,
  blocked on provider credentials), and a test holds the whole document to
  account: invoked = implemented + notImplemented exactly; every implemented
  entry resolves to a registered route with the methods it advertises;
  registered method+route pairs and contract claims form a full bijection.
  Making the bijection true surfaced more drift, now fixed: `getLabJob` was
  implemented but missing from the invoked list, the Labs agent API had no
  contract entry at all, six registered admin/public routes were undocumented,
  and the `CRUD` shorthand entries now enumerate their real routes — recording
  honestly that social-posts has no PATCH and recordings no DELETE.
  (TODO.md T-207)
- **Public news pages showed no curated imagery.** #63 moved the cached-image
  lookup off an anonymous Firestore read onto an editor-gated `cms/*` endpoint,
  reached through a token acquisition that throws outright without a signed-in
  account. The hook runs on the public `/{provider}/news` route, so for every
  anonymous visitor the lookup failed and the grid rendered nothing where
  cached images used to appear. Reading a cached image is now anonymous
  (`GET public/curated-image/{articleId}`, returning only the URL — never the
  document, which carries an internal blob path and prompt metadata), while
  generating a missing one stays behind the admin gate and is no longer
  attempted without the `editor` role that the server requires — not merely
  when nobody is signed in, since a signed-in viewer would have collected a 403
  per article. That also keeps MSAL off the critical path of a public page.
  Archived images are withheld, so retiring an image in the gallery now keeps
  it off the public site, and a cache miss is cached for a minute rather than
  an hour so a freshly generated image is not hidden behind its own absence.
  (TODO.md T-210)
- **The anonymous submission limit of five could be turned into two hundred.**
  The quota read the counter, compared it, and wrote it back as three separate
  operations, so simultaneous requests all read the same value, all passed the
  check, and all wrote `count: 1` — accepted submissions bounded only by how
  many the caller sent, each landing in the review queue, and a counter left at
  1 so the trick repeated every burst rather than once an hour. The accepted
  path is now a single conditional atomic increment: Cosmos evaluates
  `count < limit` and applies the increment as one operation, and writes to one
  document serialize, so exactly five concurrent callers get through. Starting a
  window and rolling one over are the two things a predicate cannot express, so
  they go through operations that have a loser — a create that 409s and a
  replace that 412s — and the loser re-evaluates rather than assuming.
  (TODO.md T-204)
- **An IPv6 client had an unlimited submission budget.** The quota key was the
  hash of the full address, and a standard residential IPv6 allocation is a
  whole `/64` — 2^64 addresses, each hashing to its own counter, every one of
  them reading well under the limit, with `submission_quota` growing a document
  per address as a side effect. Addresses are now normalized before hashing:
  full address for IPv4, `/64` prefix for IPv6, with `::` expanded first so one
  address written three ways lands in one bucket, and `::ffff:` v4-mapped
  addresses treated as the IPv4 clients they are rather than collapsing every
  such client into a single shared bucket. (TODO.md T-205)
- **The editor could silently overwrite a colleague's save.** Replacing
  `onSnapshot` with a twenty-second poll left behind a one-shot "this response
  is my own write" flag that was consumed by whatever the next tick happened to
  return. At millisecond latency that was reliably our own write; at twenty
  seconds it can be a collaborator's — and the branch then adopted *their* edit
  marker as our baseline, so the next save passed the server's
  optimistic-concurrency check and their work vanished with no warning to
  either person. `saveEditorDraft` now returns the `blogEditedAt` it wrote and
  the client matches on that identity, so the flag is gone rather than merely
  narrowed. It also fixes an adjacent bug: a second save inside the poll window
  used to send the pre-save marker and conflict against the caller's *own*
  previous write. (TODO.md T-208)
- **Twenty seconds was long enough to lose an image reorder.** The poll had no
  change detection, so every idle tick re-applied the remote document over
  `orderedImageUrls` — local state the user drags into order and that is only
  persisted on save — and re-rendered the whole editor while doing it. Ticks
  that carry a marker we have already seen now return early. A genuine remote
  change still replaces the order; the tests assert both directions, because an
  early return that goes too far is just a stale editor. (TODO.md T-209)
- **`total` reported the page size.** Two public list endpoints measured it
  after slicing, so it always equalled `items.length` and any paginating
  consumer would conclude there was exactly one page. (TODO.md T-407)
- **Two routes the frontend called did not exist.** `recordLegacyBlogsRead` and
  `getPlatformHealth` were registered nowhere — both 404s. The health one meant
  every anonymous visitor saw four `CHECKING` indicators resolve to "Health
  check unavailable" on the landing page; the telemetry one meant
  fallback-container reads went unmeasured, which is the evidence for retiring
  that container. Both were invisible until T-101, because until then they were
  pointed at the decommissioned Google host. (TODO.md T-316)
- **Scheduled publishing works.** `scheduledPublishDate` had a complete write
  side and no read side: an operator scheduled a post, the server validated and
  stored the date, the UI confirmed it, and nothing ever published it — no
  error, no alert. `publishScheduledContent` now runs the same
  `processPublishContent` pipeline the Publish button uses, rather than a second
  implementation of it, clears the schedule only after a publish that actually
  happened, caps each tick at 25 with carry-over, and records failures under the
  `scheduled_publish_failures` alert type the ops dashboard has counted since
  the migration without ever having a producer. (TODO.md T-301)
- **Two concurrent publishes can no longer both succeed.** `patchDoc` gained an
  optional `ifMatch`, and the publish write is now conditioned on the ETag read
  at the top of `processPublishContent` — the status gate, quality and image
  reports and slug were all decided from that document. A lost race is reported
  as skipped rather than counted as a publish that did not happen. Timer-driven
  publishing is what turns this from theoretical into reachable. (TODO.md T-301)
- **The four timers no longer share one flag.** Enabling the scheduled publisher
  would also have armed `cleanupTempStorage`, an unimplemented TODO that deletes
  blobs. Each timer has its own flag; `FEATURE_FLAG_SCHEDULERS` is a master kill
  switch. The blob-GC job itself is still unwritten and still flagged off.
  (TODO.md T-302, flag half)
- **Every admin list sort worked again.** `PublishedPage` and `EditorListPage`
  kept the Firestore-only `?.toMillis?.() || 0`, which against the ISO strings
  Cosmos returns scores every document 0 — so every comparator returned 0, the
  lists rendered in raw database order while the sort controls appeared to work,
  and the timestamp columns showed an em dash. One `lib/dateUtils.js` now backs
  all of it. The review counted seven copies of that helper; there were **ten**,
  and a source guard in the new test file found the last three — one of which
  only surfaced when the bundler refused a redeclaration that ESLint had passed.
  (TODO.md T-304)
- **The review board no longer blanks on a scheduled item.** `BlogReviewBoard`
  called `.toDate()` on what is now an ISO string, inside a `setTimeout` and so
  outside the error boundary. (TODO.md T-303)
- **A published article can no longer 404 because a draft shares its slug.**
  The detail lookup ran `SELECT TOP 1` with no `ORDER BY` and applied the public
  filter afterwards, so it picked arbitrarily among duplicates and then rejected
  the winner. It now orders by `_ts` — a system property present on every
  document, so the drop-on-undefined trap does not apply — and finds the first
  public candidate. (TODO.md T-305)
- **The Labs dashboard reported agents "connected" through an outage.** The
  staleness clock advanced only inside the snapshot fetch's success path, so a
  failing poll froze it: `now - lastSeenAt` stopped growing and every agent
  stayed online for exactly as long as nothing was reachable. The clock is an
  independent interval again — it has to keep running when the fetch does not,
  which is the only condition under which it says anything. (TODO.md T-309)
- **A timed-out lab job was polled forever, and a network blip was displayed as
  a failure.** The console's terminal-status set omitted `timeout`, which the
  agent does report — while the output pane *in the same file* had the correct
  four-element list, so the loop kept polling a job its own display had already
  called finished. Both now read `TERMINAL_JOB_STATUSES` from
  `lib/labsPolling.js`. A transport error no longer writes `status: 'failed'`
  onto the job, which was indistinguishable from a real failure and stopped the
  poll permanently; it is separate state, shown as "still running — retrying",
  and the poll backs off from 5 s to a 60 s ceiling without ever giving up.
  (TODO.md T-308)
- **Overlapping polls could render an older document over a newer one.** Both
  the Labs snapshot (15 s interval) and the editor's remote-document watch
  (20 s) allow a 20 s request timeout, so ticks overlap under load and responses
  can land out of order. Both now skip a tick while one is in flight. In the
  editor the flag is released in a `finally`: its catch returns early on a
  missing document and on cancellation, and either path would otherwise have
  stopped the poll for the lifetime of the page. (TODO.md T-309)
- **The browser called Google Cloud, not Azure.** `api.js`, `publicApi.js` and
  `legacyBlogsTelemetry.js` each resolved `VITE_GCP_FUNCTIONS_URL` — a
  decommissioned Google Cloud Functions host — so roughly sixty call sites,
  including every authenticated admin request, would have been sent off-platform
  with an Entra bearer token attached. `lib/functionsBase.js` is now the single
  resolver over `VITE_AZURE_FUNCTIONS_URL`; the dead `azureConfig.js` provider
  switch was deleted. The base carries the Functions `api` route prefix and
  accepts either `/api` (same-origin) or an absolute origin (cross-origin), so
  deployment topology is configuration rather than code. A deploy build with no
  base configured now fails instead of shipping. (TODO.md T-101)
- **Every upload and every gallery delete would have thrown.**
  `blob-storage.js` required `STORAGE_CONNECTION_STRING`, which no file in
  `infra/` has ever produced — the code was written for shared-key auth while
  the infrastructure was built for managed identity. It now uses
  `DefaultAzureCredential` against `STORAGE_BLOB_ENDPOINT`, matching
  `cosmos-client.js`, and `generateSasUrl` signs with a user-delegation key
  instead of an account key. No key or connection string was added.
  (TODO.md T-104)
- **Uploaded images were unreachable, and the URL to them was stored anyway.**
  `allow_nested_items_to_be_public = false` is an account-level master override,
  so the three containers declared public in Terraform served 409 — while
  uploads returned the raw blob URL for pages to persist into Cosmos. Uploads
  now return the media-route URL, non-public containers return none, and the
  Terraform containers are declared `private`, which is what they always were.
  (TODO.md T-105)
- **Scheduled-publish dates were silently dropped** — `scheduledPublishDate` and
  the editor's `blogEditedAt` were parsed with Firestore `Timestamp`-only code
  paths that returned `0` for the ISO strings the API now returns. This would
  have emptied the scheduling calendar and disabled external-edit-conflict
  detection. (#64)
- **Labs agents would have shown permanently offline** — the staleness
  calculation understood only `Timestamp.toMillis()`. (#65)
- **Admin list projection was missing workflow fields** — `scheduledPublishDate`,
  `softDeletedAt`, `blogEditedAt` and eight others were absent from the snapshot
  projection that replaced whole-document Firestore reads. (#64)
- **MCP server connection state always read as disconnected** — the write-only
  `oauthToken` strip left consumers unable to detect a stored token; reads now
  carry a `hasOauthToken` boolean while the value itself never leaves the
  server. (#62)
- **Public list endpoint under-projected** — it returned a card-field subset
  while consumers read `frameworkConcepts`, `featured`, `altCoverImageVariants`
  and more; it now returns full documents with internal fields stripped. (#61)

### Security

- **Anonymously submitted HTML is sanitized on ingest.** `overviewHtml` arrives
  through the anonymous submission endpoint, is stored, and is eventually
  rendered with `dangerouslySetInnerHTML` on a public template — with a single
  client-side `DOMPurify.sanitize()` call standing between those two facts.
  Sanitizing at ingest makes safety a property of the stored data rather than of
  one component's rendering choice; the client-side call stays, because two
  layers is the point. No dependency was added: the sanitizer uses `cheerio`,
  already in the tree, so it parses rather than pattern-matching markup.
  (TODO.md T-408)
- **The Content-Security-Policy stopped granting the Firebase/GCP surface, and
  started granting Entra.** `connect-src` still allowed `*.googleapis.com`,
  `*.firebaseio.com`, `*.cloudfunctions.net`, `*.run.app` and
  `wss://*.firebaseio.com` long after the last Firebase import was deleted, plus
  `*.documents.azure.com`, which contradicts the rule that the browser never
  holds a Cosmos client. More consequential in the other direction:
  `login.microsoftonline.com` was **absent** from `connect-src` and `frame-src`,
  so admin sign-in and MSAL's silent token renewal could not have worked at all.
  Pinned by `csp.test.js`, since a CSP failure appears only in a browser console
  on a deployed site. (TODO.md T-404)
- **Key Vault failures are no longer indistinguishable from a missing secret.**
  Throttled, RBAC-denied and unreachable all returned `null`, the same value as
  "this secret does not exist" — and the one caller turns `null` into an error
  message naming the wrong cause. `null` now means absent and everything else
  throws, carrying the real reason. Reads are cached for five minutes, so a hot
  path no longer spends the vault's request budget on a value that changes
  approximately never. (TODO.md T-405)
- **`GET /api/health` stopped reporting the runtime.** It returned
  `process.version` and the deployment name to anyone — an unauthenticated
  inventory of exactly what an attacker enumerates first, and of no use to a
  liveness probe. (TODO.md T-402)
- **The role cache is bounded.** It is only reachable after a token verifies, so
  an anonymous caller could not grow it, but it had no eviction at all and grew
  with every distinct principal that ever signed in. (TODO.md T-408)
- **Authorization-denial auditing is pinned by a test.** The `admin_audit_logs`
  writer already existed in the guard's production composition — the finding was
  stale — but nothing failed if the line were deleted. Now something does.
  (TODO.md T-406)
- **The Cosmos account primary key is out of app settings.**
  `COSMOS_CONNECTION_STRING` carried it — readable by anyone with Contributor on
  the resource group, and present in Terraform state — for the sole benefit of a
  change-feed trigger binding whose two handlers were empty TODOs that
  nonetheless ran continuously and billed lease-container RU. The handlers, the
  registrations and the setting are all gone, and the route-inventory test now
  asserts zero change-feed registrations so reinstating one is a visible
  decision. It was also masking a real risk: the binding kept working off the
  key while `cosmos-client.js`, which uses managed identity, would have returned
  403 on every call if its role assignment were wrong — a half-working app is
  harder to diagnose than a uniformly broken one. (TODO.md T-315)
- **The Labs VPS agent no longer holds a database credential.** It ran on a
  third-party host with a Cosmos **account primary key** — read/write over all
  71 containers. It now authenticates to the Functions API with an Entra
  certificate and can reach three endpoints, each constrained server-side:
  claims are limited to the job types its registry document lists, results can
  only be written for jobs it currently holds, and `cancelled` is not a status
  it may report. Revocation is a field on the registry document and takes
  effect on the next call, with no cache in between. The rejected alternative
  and what still needs provisioning are recorded in REVIEW.md §0.4.
  (TODO.md T-401)
- **CORS applied to every route.** `lib/auth/http-route.js` is now the single
  registration helper for all 59 HTTP routes: it registers `OPTIONS`, evaluates
  CORS before the handler runs, and merges the headers onto every response
  including errors. Previously `cors.evaluate` was called by one route of
  fifty-eight, and the advertised method list predated the REST surface, so a
  browser preflighting any of the fourteen `PUT`/`PATCH`/`DELETE` routes would
  have refused to send. (TODO.md T-102)
- **Route-inventory test added** — the replacement for the `firestore.rules`
  default-deny catch-all that Azure has no equivalent of, and the test
  `require-role.js` declared in its header and never had. Every registration
  must be guarded or named in an explicit eight-entry public allowlist, must
  accept `OPTIONS`, and must evaluate CORS. Verified by mutation: an unguarded
  route and a raw `app.http` registration both fail it. (TODO.md T-103)
- **Dependency advisories cleared** — `dompurify` to `^3.4.13` (moderate: XSS via
  detached subtree after `IN_PLACE` hook removal; ships in the app bundle),
  `nanoid` override `^3.3.18` (high), `js-yaml` override `^4.3.1` (high). Both
  packages report zero advisories. (#67)
- **Anonymous write path closed** — public submissions now pass server-side
  validation and quota enforcement instead of writing directly to the content
  collection from the browser. (#45, #66)
- **`oauthToken` made write-only** on every read path for `mcp_servers`. (#47, #62)
- **Upload path hardened** — container allowlist, traversal-resistant blob path
  validation, and a decoded size cap enforced before storage is touched. (#62)
- **Snapshot endpoint allowlisted** to `certifications` and `speakerevents` so it
  cannot become a generic container read. (#45)
- **`speakerevents` snapshots no longer publish admin emails or hidden events.**
  `SANITIZERS` had a `certifications` entry and none for `speakerevents`, so raw
  rows were written into `_snapshots/speakerevents` and served anonymously —
  including `createdBy`/`updatedBy`, which carry the email of every admin who
  touched an event, and `display: false` records whose only filter was
  client-side. A positive field allowlist now governs what is published, and
  `getSnapshot` strips internal fields inside `items[]` rather than on the
  wrapper alone. A test asserts every snapshot collection has a sanitizer.
  **Takes effect on the next `publishSnapshot` run** — an already-published
  snapshot keeps its contents until then. (TODO.md T-201)
- **Soft-deleted podcasts, cache documents and AI insights are no longer served
  anonymously.** `listPodcasts` and `getFeed` applied no deletion filter, and
  `ai_insights` was filtered on `active !== false` only — so a soft-deleted
  insight still reached the news feed. `isSoftDeleted` was extracted as the
  portion of `isPublicDocument` that applies to collections with no editorial
  workflow, and both handlers now use it. The full predicate was deliberately
  **not** applied: these three collections carry no publication status, so it
  would have emptied the podcasts page, the news feed and the insights panel.
  (TODO.md T-202)
- **The anonymous feed endpoint is bounded.** `getFeed` ran
  `SELECT * FROM c WHERE c.provider = @provider` against both `rss_cache` and
  `ai_insights` with no ceiling, and `queryDocs` calls `.fetchAll()`. Both now
  cap at 200 documents — a runaway guard, not a page size: one `rss_cache`
  document is one feed, so sizing the bound to the 30 items the client renders
  would have dropped whole feeds. Items *within* a document remain unbounded,
  tracked as T-319. (TODO.md T-203)
- **Point reads against the four non-`/id` containers now fail loudly.**
  `readDoc`/`patchDoc`/`deleteDoc`/`replaceDocIfMatch` defaulted the partition
  key to the document id, which for `content_versions`, `image_prompt_sets_prompts`,
  `image_prompts_sets` and `listen_and_learn_episodes` reads the wrong logical
  partition and returns nothing — surfacing as a permanent `null`. They now
  throw unless given an explicit key, and a test keeps the map in step with
  `infra/cosmos-containers.json`. (TODO.md T-313)
- **`putConfig` no longer deletes stored OAuth tokens.** It is a full replace and
  reads never return `oauthToken`, so any read-modify-write round trip from an
  edit form would have wiped it. The token is carried forward unless explicitly
  supplied; an explicit empty string still revokes. The read-side
  `hasOauthToken` boolean is stripped from incoming bodies. (TODO.md T-314)
- **`cms/content` list rejects a malformed `limit`.** `?limit=abc` produced
  `TOP NaN` — a 500 carrying raw Cosmos error text — and `?limit=0` produced a
  silently empty list. Clamped like its four siblings, and `error.message` no
  longer reaches the client on any of the file's 500 paths. (TODO.md T-310)
- **`deleteSetArtifacts` queries one logical partition** instead of fanning out
  across all of them; `queryDocs` gained an optional `partitionKey`.
  (TODO.md T-312)
- **Uploads no longer accept an arbitrary content type.** `contentType` was
  taken verbatim from the body and stored as the blob's Content-Type, which the
  media route serves back: an editor could host `evil.html` as `text/html` on an
  org-owned domain. Six image types are now allowed, each having to agree with
  the path's extension — `badge.png` declared `text/html` and `evil.html`
  declared `image/png` are both refused. `image/svg+xml` is accepted only into
  containers the anonymous route does not serve, since an SVG on a public URL is
  a scriptable document in the storage origin and `nosniff` does not address a
  type that was declared rather than guessed. (TODO.md T-307)
- **A caller-chosen upload path can no longer replace a live asset.** Uploads
  from the admin route are conditioned on `If-None-Match: *` and answer 409
  instead of overwriting; `uploadBlob`'s default is unchanged, so the paths that
  rewrite deterministic keys on purpose still do. The condition is asserted
  against a mocked SDK rather than only against the handler's fake storage —
  that fake is what let T-104 stay green while every real upload threw.
  (TODO.md T-307)
- **Upload size is checked before memory is committed.** The 413 came after a
  full JSON parse, a full base64 string and a full `Buffer` decode — roughly a
  250 MB peak for a 100 MB body on a 2048 MB instance. `Content-Length` is now
  checked before the body is read and `dataBase64.length` before it is decoded,
  with the decoded count still the final authority. There is no
  `http.maxRequestBodySize` in `host.json` to complement this; the v2+
  `extensions.http` schema has no such key, so the anonymous submissions parse
  still needs its own check. (TODO.md T-306)

### Infrastructure

- Storage: `Storage Blob Delegator` role assignment for user-delegation SAS;
  media containers declared `private`, matching the account-level override that
  already made them so.

Authored but **never applied** — no Terraform `validate`, `plan`, or `apply` has
run from any session (see [REVIEW.md](REVIEW.md) §1.1).

- Cosmos DB serverless container specification (71 containers).
- Flex Consumption plan and pricing work. (#38, #41, #42)
- Container Apps Job definition for the CI runner. (#48)

---

## Notes

- Work merged before the SOP was adopted has been reconstructed from pull
  request history; entries reference PR numbers rather than release tags.
- Nothing in this file has been verified against a deployed environment.
