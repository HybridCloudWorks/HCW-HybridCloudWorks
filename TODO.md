# TODO

Actionable engineering work for HCW-HybridCloudWorks.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file holds work an engineer can resolve without human input. Human decisions,
approvals, access, and credential ownership belong in [REVIEW.md](REVIEW.md).
Required inputs belong in [CHECKLIST.md](CHECKLIST.md). Completed work moves to
[CHANGELOG.md](CHANGELOG.md).

**If this file lists no open items, there is no known outstanding engineering
work** — that is a valid state, not a missing document.

---

## Status

| | |
| --- | --- |
| Open items | 10 |
| Critical | 0 |
| High | 5 |
| Medium | 4 |
| Low | 1 |
| Resolved since the review | 33 (T-101 – T-105, T-201 – T-203, T-208, T-209, T-301, T-303 – T-310, T-312 – T-317, T-401 – T-407) + T-311 corrected as not-a-defect, T-406 verified as already-resolved; T-302 and T-408 part-resolved |
| Last updated | 2026-08-10 |
| Source | Code Review SOP run, repository-wide, three reviewers (SOP / security / Azure architecture), de-duplicated per Phase 11 |

**Release readiness: STILL NOT VERIFIED.** All five Critical items are
resolved, and the suite is now 759 functions tests and 79 frontend tests. That
changes what is known to be broken; it does not change what is known to work.
Every Critical item lived in the seam between a correctly-built module and its
environment — exactly the seam no test in this repository can reach. **Nothing
below the line has been exercised against a deployed Azure environment**
(REVIEW.md §1.1), so the next step is a deployed smoke test, not a release.

---

## Suggested work order

Do these in sequence — later items cannot be verified before earlier ones.

1. ~~**T-101** API base URL~~ — **done**, see below
2. ~~**T-102** CORS across all routes → **T-103** route-inventory test~~ — **done**, see below
3. ~~**T-104 + T-105**~~ blob credential and image delivery — **done**, see below
4. ~~**T-403** `.env.example`, **T-404** CSP~~ — **done**, see below
5. **Deploy a smoke test** — everything above is unverifiable from an agent
   session, and this is now the top open item
6. **T-201 → T-205** the anonymous data-exposure set (~~T-201, T-202, T-203~~ done)
7. **T-301+** correctness and hardening

---

## CRITICAL

### ~~T-101 — `api.js` and `publicApi.js` call Google Cloud, not Azure~~ RESOLVED
**Category:** Configuration / contract deviation · **Label:** Confirmed Issue
**Files:** `frontend/src/lib/api.js:8`, `frontend/src/lib/publicApi.js:11`

Both hardcoded `import.meta.env.VITE_GCP_FUNCTIONS_URL`. `.env.example:9` set that
to a Google Cloud Functions host. The correct resolver already existed —
`frontend/src/lib/functionsBase.js` — and was used by only three files
(`NewsletterSignup.jsx`, `useGenerateCuratedImages.js`, `HomePage.jsx`). Roughly
sixty call sites resolved to Google. Beyond the outage: admin bearer tokens
minted for the Azure API audience would have been transmitted to a
Google-controlled endpoint if that project is still live.

**Resolved.** `functionsBase.js` is now the single resolver, reading only
`VITE_AZURE_FUNCTIONS_URL`, and `api.js`, `publicApi.js` and
`legacyBlogsTelemetry.js` all route through it. Three points differ from the
fix as originally written:

- **The `VITE_BACKEND_PROVIDER` switch is gone, not tested.** The review
  proposed asserting that `VITE_BACKEND_PROVIDER=azure` resolves to the Azure
  URL. With Firebase removed from the frontend there is no second provider to
  switch to, so `azureConfig.js` — whose only consumer was `functionsBase.js` —
  was deleted rather than kept as dead indirection. Duplicated resolution logic
  is what caused this defect; leaving a vestigial branch invites its return.
- **The base must include the `api` route prefix.** `functions/host.json` does
  not override `routePrefix`, so `route: 'public/content'` is served at
  `<host>/api/public/content`. `.env.example` previously set
  `VITE_AZURE_FUNCTIONS_URL` without `/api`, which would have produced a
  uniform 404 — the same outage under a different name.
- **The topology is now a config value, not a code path.** `/api` for
  same-origin, `https://<host>/api` for cross-origin. This resolved T-101
  without waiting on the [REVIEW.md](REVIEW.md) §0.1 decision — and T-102 was
  then resolved the same way, so §0.1 no longer gates any Critical item.

Enforced by `frontend/src/lib/functionsBase.test.js` (10 tests, in `test:admin`
so CI runs it): resolution for both topologies, the throw when unset, a guard
that no file under `src/` mentions the retired variable, and a guard that
`VITE_AZURE_FUNCTIONS_URL` is read in exactly one module. A deploy build with
no base now fails in `vite.config.js` rather than shipping a broken bundle
(`REQUIRE_API_BASE=true`, set in `deploy-azure-frontend.yml`).

---

### ~~T-102 — CORS is wired into 1 of 58 routes~~ RESOLVED
**Category:** Defect / architecture · **Label:** Confirmed Issue
**Files:** all `functions/src/functions/*.js`; `functions/src/lib/auth/cors.js:98`; `infra/main.tf:530-544`

`cors.js` is well built and tested. `cors.evaluate()` is called only in
`public-submissions.js:35`, which is also the only route registering `OPTIONS`.
The SPA (`hybridcloudworks.com`) and the API are different hosts, so every call
is cross-origin; the platform `cors` block was deliberately removed from
Terraform on the reasoning that CORS lives in code.

Two compounding defects: `ALLOW_METHODS` is `GET, POST, OPTIONS`, but the
migration added `PUT`/`PATCH`/`DELETE` routes; and every authenticated call
carries `Authorization`, forcing a preflight on all of them.

**Resolved.** `functions/src/lib/auth/http-route.js` is now the single
registration helper, and all 59 registrations go through it. It appends
`OPTIONS` to every `methods` array, evaluates CORS before the handler runs
(so a preflight consumes no guard call, no store read and no rate-limit quota),
and merges the headers onto whatever the handler returns — **including error
responses**, because a 401 without `Access-Control-Allow-Origin` reaches the
browser as an opaque network error and the guard's message is never shown.
`ALLOW_METHODS` now covers `PUT`, `PATCH` and `DELETE`; fourteen routes use
them, and a browser preflighting one of those would have refused to send.

`public-submissions.js` had its own `cors.evaluate` call, now removed: with the
wrapper in place it was a second evaluation of the same allowlist, which is
precisely the drift hazard `cors.js` DECISION 7 exists to prevent. Its two CORS
tests were rewritten to exercise the registered composition rather than the bare
handler, so the coverage moved rather than disappearing.

**No longer blocked on the topology decision.** Like T-101, this became
configuration: same-origin requests either carry no `Origin` (allowed — CORS is
not an authorization control) or carry the site's own, already in the production
allowlist. A different SPA hostname is added through `CORS_ALLOWED_ORIGINS`
without a code change.

---

### ~~T-103 — Write the route-inventory test the guard module declares~~ RESOLVED
**Category:** Test coverage / security · **Label:** Confirmed Issue
**File:** `functions/src/lib/auth/require-role.js:20-33` (declaration); no such test exists

The module header calls this *"the highest-value test in the port"* — the
replacement for the `firestore.rules` default-deny catch-all that Azure has no
equivalent of. It was never written.

Hand-audited state is **correct**: all 58 registrations either guard or are
intentionally public. This is the control that keeps route 59 from shipping
unguarded, not a live vulnerability.

**Resolved.** `functions/src/functions/route-inventory.test.js` imports
`index.js` against a stubbed `app` recorder and a stubbed guard, then asserts
all three properties across every registration: guarded or on an explicit
eight-entry `PUBLIC_ROUTES` allowlist, `OPTIONS` registered, and CORS evaluated
before the handler.

It passed on first run, which for a test of this kind is not evidence of
anything, so it was checked by mutation. Registering an unguarded route through
`httpRoute` fails property 1 by name; registering a route with raw `app.http`
fails all four assertions. Both mutations were reverted.

The allowlist is the deliberate part: adding a route to it means anyone on the
internet can call it, with no token, forever — so it carries a per-entry comment
saying which Firestore rule it replaces.

---

### ~~T-104 — Blob storage has no credential; every upload and delete throws~~ RESOLVED
**Category:** Configuration / defect · **Label:** Confirmed Issue
**Files:** `functions/src/lib/blob-storage.js:24-27`, `:143`; `infra/main.tf:560-575`

`getBlobService()` requires `STORAGE_CONNECTION_STRING`; it appears **nowhere**
in `infra/`. Terraform sets `STORAGE_ACCOUNT_NAME`, `STORAGE_BLOB_ENDPOINT`,
`STORAGE_QUEUE_ENDPOINT` and grants the managed identity
`Storage Blob Data Contributor`. The code is written for shared-key auth; the
infrastructure is built for managed identity.

Dead in production: `POST cms/uploads/{container}`, both gallery delete paths,
the certification badge flow. Invisible to `admin-uploads.test.js`, which injects
`storage: { uploadBlob: vi.fn() }`.

**Resolved.** `blob-storage.js` now builds its client as
`new BlobServiceClient(resolveBlobEndpoint(), new DefaultAzureCredential())`,
matching `cosmos-client.js`. No connection string was added. `generateSasUrl`
became a user-delegation SAS via `getUserDelegationKey` — and therefore async,
which is safe because nothing calls it yet. `azurerm_role_assignment.func_blob_delegator`
(`Storage Blob Delegator`) was added to `infra/main.tf`; without it
`getUserDelegationKey` returns 403 even though the identity can read the blob.

`getBlobUrl` no longer hardcodes `blob.core.windows.net`; it composes from the
configured endpoint, so the account's cloud is not assumed.

The test gap that hid this is closed by `functions/src/lib/blob-storage.test.js`
(14 tests): endpoint and account-name resolution including the endpoint-carries-
the-suffix case, the throw when neither setting is present, an assertion that a
connection string is **not** accepted as configuration, and source guards that
no shared-key path (`StorageSharedKeyCredential`, `fromConnectionString`,
`STORAGE_ACCOUNT_KEY`, `STORAGE_CONNECTION_STRING`) returns to the module.

Two things this does **not** establish, both requiring a deployed environment
(REVIEW.md §1.1): that the role assignments apply cleanly, and that an upload
succeeds end to end. The handler tests still inject a fake `uploadBlob`; that is
appropriate for them, but it means no test in the repository exercises a real
blob write.

---

### ~~T-105 — Uploaded images are unreachable from the internet~~ RESOLVED
**Category:** Configuration / defect · **Label:** Confirmed Issue
**Files:** `infra/main.tf:306` (and its comment), `:325`, `:333-355`

`allow_nested_items_to_be_public = false` is a **master override**, not a
default — the trailing comment ("containers opt-in below") states the opposite of
Azure's semantics and is the reason this is not obvious on review. With it false,
`container_access_type = "blob"` on `blogs`/`covers`/`certifications` has no
effect. `network_rules { default_action = "Deny" }` blocks internet clients
regardless.

`uploadBlob` returns the raw blob URL, which `CertificationsPage.jsx:410`
persists as `imageUrl`. Images upload successfully and render broken everywhere,
with a dead URL stored in Cosmos.

**Resolved by keeping the account closed and serving through the Function App.**
The review preferred opening the account behind a CDN. That option reverses two
security settings, exposes the account to the internet, and adds a service with
a monthly floor against a USD 150 design ceiling — a spend-and-exposure
decision, not an engineering one. It is recorded in [REVIEW.md](REVIEW.md) §0.5
and remains available: nothing here forecloses it.

Delivered:

- **`GET public/media/{container}/{*blobPath}`** (anonymous), backed by
  `functions/src/lib/public-media.js`. Reads through the managed identity that
  already holds Storage Blob Data Contributor. `Cache-Control: public,
  max-age=31536000, immutable` plus ETag/`If-None-Match`, so repeat views never
  reach the function and a CDN can be layered in front later unchanged.
- **A separate, narrower allowlist.** `PUBLIC_MEDIA_CONTAINERS` is
  `blogs`/`covers`/`certifications` — a strict subset of the five containers
  uploads may write to, asserted by test. `content` and `speakerevents` stay
  private, as Terraform always said they were. This is the load-bearing control:
  the identity can read the entire account, so the allowlist is the only thing
  between an anonymous caller and a private container.
- **Uploads now return a URL that will serve.** `POST cms/uploads/{container}`
  returns the media-route path as `url` (what pages persist into Cosmos) and the
  raw blob URL as `blobUrl` for diagnostics. A non-public container returns an
  empty `url` rather than a plausible dead one.
- **Stored URLs are site-relative**, so the §0.1 topology decision cannot
  invalidate images already written to the database.
  `resolveMediaUrl()` in `frontend/src/lib/functionsBase.js` maps them onto the
  API origin when that base is absolute, and returns absolute source-system URLs
  untouched.
- **Terraform now describes reality.** The three containers are `private` —
  which is what they were, since the account override made `"blob"` inert — and
  the misleading `# containers opt-in below` comment is replaced with what the
  setting actually does.

Follow-up, deliberately not done here: components render `imageUrl` directly in
roughly thirty places rather than through one helper. In the same-origin
topology that is correct as written. **If §0.1 chooses cross-origin, those
render sites must be routed through `resolveMediaUrl()`** — tracked as T-318.

---

## HIGH

### ~~T-201 — `speakerevents` snapshot leaks admin emails and hidden events anonymously~~ RESOLVED
**Category:** Security · **Label:** Confirmed Issue / Security Sensitive
**Files:** `functions/src/lib/snapshots-publish.js:92-96,110-114`; `functions/src/lib/public-reads.js:219-231`

`SANITIZERS` defines `certifications: sanitizeCertification` but **no
`speakerevents` entry**, so raw rows are written wholesale into
`_snapshots/speakerevents`. `getSnapshot` then returns them —
`stripInternalFields` operates on the wrapper only and never descends into
`items[]`, and `isPublicDocument` is not called on this path.

`GET public/snapshots/speakerevents` therefore exposes: `display: false` records
(that filter is client-side only, `CustomSessionizeWidget.jsx:451`), and the
**email address of every admin** who touched an event via `createdBy`/`updatedBy`
— names that *are* in `INTERNAL_FIELDS` and simply never reached.
`upsertSpeakerEvent` has no field allowlist, so anything an editor adds is public.

`sanitizeCertification` does exactly the right thing for the sibling collection,
which proves this is an oversight rather than a design choice.

**Resolved, both halves.**

- **`sanitizeSpeakerEvent`** in `snapshots-publish.js`, modelled on the
  certifications sanitizer: requires `display === true` (failing closed when the
  field is absent, not just when it is `false`), and emits a positive allowlist
  of the ten fields `CustomSessionizeWidget.jsx` actually renders. Positive
  rather than a denylist because `upsertSpeakerEvent` has no write-side
  allowlist — anything an editor adds would otherwise publish itself.
- **`getSnapshot` now descends into `items[]`**, so `stripInternalFields`
  reaches the per-item `createdBy`/`updatedBy` it previously skipped. This is
  defence in depth, not the boundary: a collection with no sanitizer would still
  leak every non-internal field and every `display: false` row.

Verified by mutation, since both halves passing is not by itself evidence:
removing the `SANITIZERS` entry fails two tests, and disabling the `items[]`
descent fails one. A further test asserts that **every** collection in
`SNAPSHOT_COLLECTIONS` is sanitized, so adding a third without a sanitizer —
the exact shape of this bug — now fails in CI rather than in production.

One test had to be rewritten rather than added: `publishSnapshot` had a case
named *"writes sanitized certifications and **raw** speakerevents"*, which
asserted the leak. It passed, and passing meant nothing.

**Not verified against live data.** REVIEW.md §0.3 asks for the contents of
`_snapshots`; until someone looks, the size of the historical exposure is
unknown. Note that the fix takes effect only when snapshots are next published —
**an already-published `_snapshots/speakerevents` document keeps whatever it
holds until `publishSnapshot` runs again.**

---

### ~~T-202 — `listPodcasts` and `getFeed` skip the public filter~~ RESOLVED
**Category:** Security · **Label:** Confirmed Issue
**File:** `functions/src/lib/public-reads.js:249-252`, `:283-284`

The module header states the filter *"is the only thing keeping drafts and
soft-deleted docs out of anonymous responses."* Two of five handlers don't call
it. `getFeed` filters `ai_insights` on `active !== false` only, so a soft-deleted
insight is still returned; `rss_cache` is unfiltered.

Not a regression — the pre-migration hooks had no client-side check either — but
the contract says the server must filter, and nothing downstream compensates.

**Resolved — but NOT as prescribed.** `.filter(isPublicDocument)` would have
caused an outage.

`isPublicDocument` answers two questions at once: is this deleted, and is it
published. The second is the *editorial content* model (`Live`, `Status`,
`contentStatus`), and none of the three collections these handlers serve has an
editorial workflow. `infra/cosmos-containers.json` is explicit: `rss_cache` is a
*"cache — refilled by a scheduled job, not migrated"* with a 7-day TTL, indexed
on `provider + lastFetched`; `ai_insights` is indexed on
`provider + active + generatedAt`; `podcasts` on `provider + publishedAt`. No
status field among them.

So the literal fix returns `false` for every document in all three and silently
empties the podcasts page, the news feed and the insights panel — the same
failure shape as T-101, reached through a security fix.

**What was done instead:** `isSoftDeleted` was extracted as the half of
`isPublicDocument` that applies universally, and both handlers now filter on it.
`ai_insights` additionally keeps `active !== false`, which is its real
visibility model — the composite index says so. The genuine leak T-202 found is
closed: **a soft-deleted insight passed `active !== false`** and was served.

Verified in both directions, because a fix here can fail two ways: removing the
soft-delete filters fails 2 tests, and applying `isPublicDocument` literally
fails 6. The second set exists specifically so a future reader following this
item's original wording cannot reintroduce the outage.

The module header claimed the public filter is *"the only thing keeping drafts
out"* and named `isPublicDocument` flatly. That was the sentence I relied on in
#61 when removing client-side visibility checks, and it was wrong for three of
five handlers. It now states the actual invariant: every handler filters, not
every handler filters identically.

---

### ~~T-203 — `getFeed` has no `TOP` clause~~ RESOLVED
**Category:** Performance / DoS · **Label:** Confirmed Issue
**File:** `functions/src/lib/public-reads.js:271`, `:274`

`SELECT * FROM c WHERE c.provider = @provider` on `rss_cache` and `ai_insights`,
unbounded, on an anonymous endpoint. `queryDocs` calls `.fetchAll()`.
`rss_cache` is TTL-bounded at 7 days but that bound is set by `syncRssFeeds`, an
unimplemented scheduler — the day it goes live this becomes a function of feed
volume with no ceiling. `ai_insights` has no TTL.

**Resolved,** but not sized as suggested. `useNewsData.js` renders 30 — and 30
is the count of **items** it keeps after flattening every `cache.items[]` array
together and sorting by `pubDate`. One `rss_cache` document is one *feed*,
holding many items. `TOP 30` would have bounded feeds, so a provider with more
feeds than the ceiling would lose whole feeds' worth of recent news — and an
arbitrary set of them, because there is no `ORDER BY` and (per the module's own
rule 2) there must not be: `lastFetched`/`generatedAt` appear only in the
composite indexes, which does not guarantee presence, and Cosmos drops documents
missing a sort key.

Both queries are now `SELECT TOP 200`, set as a runaway guard rather than a page
size. The arbitrary-subset behaviour of an unordered `TOP` only manifests once a
container has already run away, which is the case being defended against.
Guarded by four tests and verified in both directions: removing the bounds fails
two, tightening one to the render count fails another.

**One thing this does not bound: items within a document.** A single `rss_cache`
document holds `items[]`, and nothing caps its length — so one runaway feed
still produces a large response even with the document ceiling in place. That is
deliberately left alone rather than guessed at: truncating the array means
choosing which end to keep, and `syncRssFeeds` is still a stub, so nothing in
the repository establishes whether items are written newest-first. Getting it
backwards would silently hide the newest news, which is the entire feature.
Tracked as T-319 for whoever implements the scheduler, since they will define
the write order.

---

### T-204 — Submissions quota race admits ~40× the limit
**Category:** Security / abuse · **Label:** Confirmed Issue
**File:** `functions/src/lib/submissions.js:257-278`

Read at `:258`, compare at `:266`, upsert at `:272` — no ETag, no atomic
increment. 200 concurrent POSTs all read `count: 0`, all pass, all write
`count: 1`: **200 accepted against a limit of 5**, each landing in the review
queue. After the burst the counter reads 1, so it repeats per request cycle, not
per hour. The header comment's claim that the under-count is bounded by
simultaneous requests from one client understates it.

**Fix:** Cosmos atomic patch increment on `/count`, rejecting when the returned
post-increment value exceeds the limit.

---

### T-205 — Quota key hashes the full IPv6 address
**Category:** Security / abuse · **Label:** Confirmed Issue
**File:** `functions/src/lib/auth/client-identity.js:94-97`

A standard `/64` allocation gives 2⁶⁴ source addresses, each hashing to a
distinct quota document — unlimited submissions with every bucket under 5, plus
unbounded growth of `submission_quota`.

**Fix:** normalize before hashing — full address for IPv4, truncate to `/64` for
IPv6.

---

### T-206 — Public content list: unordered 1000-row window at the current document count
**Category:** Defect / performance · **Label:** Confirmed Issue
**File:** `functions/src/lib/public-reads.js:117`, `:152`, `:166-171`

`SELECT TOP 1000 * FROM c` with no `ORDER BY` returns an **arbitrary** 1000 in
Cosmos, then sorts in memory. The file's own comment says *"Content is ~1k docs
total"* — the failure threshold and the current count are the same number. Past
it, published articles vanish from listings non-deterministically, and the
300-second cache header makes it intermittent rather than reproducible.

Also the dominant RU line: `SELECT *` transfers full documents including body
fields. At ~20 KB average that is ~12–24k RU per request — roughly four seconds
of the container's entire 5,000 RU/s serverless budget, so two concurrent public
page loads produce 429s.

**Fix, in order:** (1) move the public filter into SQL so the window narrows
before `TOP`; (2) project explicit fields instead of `SELECT *` — `cms-content.js`
already models this with `ADMIN_CONTENT_SNAPSHOT_FIELDS`; (3) materialize a
`sortDate` field (or a Cosmos computed property) so `ORDER BY` is safe, plus a
composite index. Keep the `ORDER BY`-avoidance reasoning at `:19-23` — it is
correct; fix the window bound instead.

---

### T-207 — 16 documented RPCs are live 404s in the admin UI
**Category:** Incomplete feature · **Label:** Confirmed Issue
**File:** `.azure/api-surface.json:193-244` vs `:21-192`

`rpc.functions` describes *"functions the frontend already invokes"*. Seventeen
are unregistered and **sixteen have live call sites** in `frontend/src`:
`aiProxy`, `batchInspect`, `createContentFromRecording`, `fetchRssFeedsManual`,
`generateArticleDraft`, `generateCuratedArticleImage`, `generatePreviewImages`,
`generateReviewHeroImage`, `generateReviewerDigestManual`,
`generateSocialCaption`, `klaviyoProxy`, `linkieProxy`, `mcpProxy`,
`publerProxy`, `syncMcpTools`, `triggerAiImageGeneration`. Several already have
per-function timeouts configured in `api.js:11-18`.

Blocked on provider credentials ([CHECKLIST.md](CHECKLIST.md) §4). But the
contract has no status field on `rpc.functions`, so the gap is invisible.

**Fix now (unblocked):** add an explicit `rpc.notImplemented` array, and a CI
check asserting every implemented contract entry resolves to a live route and
vice versa.

---

### ~~T-208 — Editor poll can silently overwrite a collaborator's save~~ RESOLVED
**Category:** Defect (lost update) · **Label:** Confirmed Issue
**File:** `frontend/src/features/editor/hooks/useEditorState.js:291-299`, `:340`

`pendingLocalSaveRef` is consumed by whatever the *next* poll returns. Under
`onSnapshot` that was our own write within milliseconds. Under a 20-second poll
it may be someone else's version — the branch then calls
`setExternallyModified(false)` and adopts their `blogEditedAt`, so the next save
passes the server's optimistic-concurrency check and overwrites them with no
warning to either party. A ~20,000× widening of a pre-existing race.

**Resolved as suggested,** identity-based. `saveEditorDraft` now returns the
`blogEditedAt` it wrote; `handleSave` records it in `lastSeenEditedAtMsRef` and
`loadTimeRef` the moment the response lands, and `pendingLocalSaveRef` is gone
entirely rather than being made conditional. There is no "is this mine?" guess
left to get wrong: a polled marker either equals one we recorded or it does not.

Two details worth stating, because both were checked rather than assumed.
`saveEditorDraft` is the **only** writer of `blogEditedAt` anywhere in
`content-workflow.js`, so the marker is a faithful identity for editor saves and
nothing else perturbs it. And the adoption is guarded on `savedEditedAtMs > 0`
— against an older deployment that returns no marker the client falls back to
the previous behaviour, because adopting a `0` would make every subsequent tick
look like a remote edit and wedge the editor in "changed remotely" permanently.

**This also fixed an adjacent bug the finding did not mention.** A second save
inside the 20-second poll window used to send the pre-save `expectedEditedAtMs`,
so it 409'd the caller against their *own* previous write — an editor saving
twice in quick succession hit a spurious conflict on a document nobody else had
touched. Adopting the returned marker removes that too.

Nine hook tests plus one server-side test, verified in both directions:
restoring the one-shot flag fails four (including the lost update itself —
`postJSON` fires where the fixed client refuses), and dropping `blogEditedAt`
from the response fails the server test.

---

### ~~T-209 — Editor poll discards unsaved image reordering every 20 seconds~~ RESOLVED
**Category:** Defect (loss of user work) · **Label:** Confirmed Issue
**File:** `frontend/src/features/editor/hooks/useEditorState.js:301-310`

`applyRemoteDoc` runs on every tick — the poll has no change detection — so the
`!wasRemoteUpdateAfterLoad` branch resets `orderedImageUrls` (user-mutable local
state, only persisted on save) to the remote value every 20 seconds.

**Resolved as suggested.** `applyRemoteDoc` early-returns once initialized when
`remoteEditedAtMs === lastSeenEditedAtMsRef.current`, which also removes a full
editor re-render every 20 seconds while idle.

The one thing to be careful of here is that the early return must not become
"ignore the remote document", so a test asserts a genuine remote change still
replaces the image order. Worth recording what the guard deliberately does
*not* wake on: `blogEditedAt` is the only change marker, and only
`saveEditorDraft` writes it, so an out-of-band `contentStatus` change does not
trigger a re-apply. That is correct for what this poll is — a detector for
"another editor saved this document" — and the editor consumes only
`blog.sourceUrl` from the polled document, so no rendered field goes stale.

Removing the early return fails three tests.

---

### T-210 — Public news pages fire authenticated requests as anonymous visitors
**Category:** Defect (public regression) · **Label:** Confirmed Issue
**File:** `frontend/src/hooks/useGenerateCuratedImages.js:48-59`

#63 moved the curated-image cache lookup from an anonymous Firestore read onto
`getJSON('cms/images/curated/...')` — `authedFetch` → `acquireApiToken()`, which
throws without an MSAL account, against an editor-gated handler. The hook runs on
the **public** `/{provider}/news` route via `CuratedArticlesGrid.jsx:239-244`.
`useImagePrompts().resolvePromptForPage` has the same problem.

Every anonymous visitor triggers up to 12 failing requests and sees no curated
imagery, where cached images previously rendered.

**Fix:** anonymous `GET /api/public/curated-image/{articleId}` returning only
`{ imageUrl }`, consumed via `publicApi.js`; and gate
`generateImagesForArticles` on an authenticated session.

---

## MEDIUM

### ~~T-301 — `scheduledPublishDate` never publishes (write side complete, read side empty)~~ RESOLVED
**Files:** `functions/src/lib/scheduled-publish.js` (new), `functions/src/functions/schedulers.js`, `functions/src/lib/cms/publish.js`, `functions/src/lib/cosmos-client.js`

The timer body was a TODO. The write side was fully shipped: `content-workflow.js`
validates and persists, `BlogReviewBoard.jsx` renders the picker, Calendar and
Queue display it. An operator scheduled, the server accepted, the UI confirmed —
and nothing published, with no error or alert anywhere.

Every implementation requirement in the finding is met:

- **Query** as prescribed, plus `IS_STRING(c.scheduledPublishDate)`. That extra
  clause is not cosmetic: `saveContentSchedule` writes
  `scheduledPublishDate: null` for an instant publish, on a document that is
  also `approved` and not `Live`. Without it every instant-publish document
  matches on every tick.
- **`ORDER BY` is used**, and the exemption is documented at the query rather
  than assumed — the `WHERE` clause is what makes it safe, so the two must not
  be separated.
- **`processPublishContent` is called, not reimplemented.** It is now returned
  from `createPublishHandlers` (not registered as a route). The status gate,
  quality gate, image gate, slug resolution and version snapshot *are* the
  publish semantics; a timer with its own copy would drift, and the drift would
  surface as posts publishing differently depending on who published them.
- **ETag precondition added.** `patchDoc` gained an optional `options.ifMatch`,
  and the publish write is conditioned on the `_etag` read at the top of
  `processPublishContent` — the whole decision above the write is made from
  that document. A 412 becomes `{skipped}`, which `accumulatePublishResult` now
  counts separately; without that branch it fell through and reported a publish
  that never happened. When a caller supplies an ETag the read-modify-write
  path no longer retries, because retrying re-reads and re-reading is exactly
  what the precondition exists to prevent.
- **Schedule cleared after publishing**, with `null` rather than `undefined`
  (`patchDoc` reads `undefined` as a deletion), and only on a publish that
  actually happened — clearing it on failure would silently cancel the
  operator's schedule.
- **25/tick with carry-over**, reported as `hasMore` rather than chased within
  the tick; **UTC** throughout, with the string comparison's dependence on
  `toISOString()` output written down; **failures to `workflow_alerts`** under
  `alertType: 'scheduled_publish_failures'` — the exact string `ops-health.js`
  already counts, a consumer that had been waiting for a producer since the
  migration.

**Per-timer flags landed with it** (the safe half of T-302). Shipping T-301
under the shared flag would have armed `cleanupTempStorage` — an unimplemented
blob-deletion TODO — the moment anyone enabled the publisher.
`FEATURE_FLAG_SCHEDULERS` is now a master kill switch only.

### T-302 — Blob GC is still unwritten (flag split done)
**File:** `functions/src/functions/schedulers.js`

**The flag half is resolved**, with T-301: each timer has its own
`FEATURE_FLAG_<NAME>` and `FEATURE_FLAG_SCHEDULERS` is a master kill switch, so
enabling the publisher no longer arms anything else. Terraform sets all four
individual flags to `"false"`.

**What remains is `cleanupTempStorage` itself**, still an unimplemented TODO.
The hazard the finding names is real and unchanged: an orphan query has to
enumerate every blob and every referencing document, and anything it fails to
enumerate it classifies as an orphan and deletes. Only
`delete_retention_policy { days = 7 }` makes that recoverable.

Note the finding's stated blocker does **not** apply — `queryDocs` does not
truncate (T-311, corrected). The real constraint is that `fetchAll` materialises
the whole result set, so the enumeration needs a cursor rather than a bigger
window. Make the first version dry-run regardless.

### ~~T-303 — `BlogReviewBoard` throws on a scheduled date~~ RESOLVED
**File:** `frontend/src/components/admin/BlogReviewBoard.jsx`
`blog.scheduledPublishDate.toDate()` on a value that is now an ISO string.
Reproduce: open `/admin/review/{id}` for any scheduled item. Threw inside a
`setTimeout`, so outside the error boundary — the review page simply blanked.

Now `toDate()` from the shared helper. A null falls through to the same default
as an unscheduled item rather than taking the page down.

### ~~T-304 — Published/EditorList sorts are permanent no-ops~~ RESOLVED
**Files:** `frontend/src/lib/dateUtils.js` (new) and ten call sites
`?.toMillis?.() || 0` on ISO strings → always 0 → comparator always returns 0.
Lists rendered in raw Cosmos order, sort controls did nothing, timestamps showed
`—`. Several sibling files got the three-branch fix in the same migration; these
did not.

**The finding counted seven copies. There were ten.** A source guard in
`dateUtils.test.js` found the last three — one in `blogUtils.js`
(`normalizeFirestoreDate`), a second in `QueuePage.jsx` written around `toDate`
rather than `toMillis`, and one in `SocialHubPage.jsx` whose parameter was named
`v`. The `QueuePage` one only surfaced because the *bundler* refused the
redeclaration; ESLint reported zero errors on that file. The guard now asserts
three things — one implementation under `src/`, no module-level redeclaration of
the helper names, and no surviving `?.toMillis?.()` expression.

Consolidating also folded in a capability only `QueuePage`'s copy had: a
Timestamp that went through JSON and came back as plain `{seconds, nanoseconds}`
with its methods gone. Dropping it silently would have been the sort of
regression a "pure refactor" is expected not to contain.

`byNewest(...fields)` uses `Math.max` across fields rather than `||`, because
`||` takes the first field that *exists*, which is not the most recent — a
document archived in January and updated in June belongs above one archived in
March.

### ~~T-305 — Detail-page slug resolution is non-deterministic~~ RESOLVED
**File:** `functions/src/lib/public-reads.js`
`SELECT TOP 1` with no `ORDER BY`, and the public filter applied *after*. Two
documents sharing a slug resolved arbitrarily, and a published article could 404
forever because an unpublished duplicate won the arbitrary pick.

`SELECT TOP 10 ... ORDER BY c._ts DESC`, then `rows.find(isPublicDocument)`.

**One deviation from the prescribed fix.** The finding says to filter in SQL;
the filter stays in JavaScript. `isPublicDocument` is the security predicate for
every anonymous read in this file, and expressing it a second time in SQL means
two definitions that must agree forever — the same drift hazard that produced
T-304's ten copies and T-308's two terminal-status lists. Fetching a bounded
candidate set and filtering with the one existing function fixes both halves of
the defect (arbitrary pick, and filter-after-take) without splitting the
predicate.

`ORDER BY c._ts DESC` is safe for a reason that does not generalize: `_ts` is a
system property Cosmos writes on every document, so the drop-on-undefined trap
does not apply. Confirmed against the Cosmos indexing docs that a filter plus a
single-property `ORDER BY` runs on the range index `/*` already provides — no
composite index needed, only a marginally higher RU cost that a near-unique
predicate makes irrelevant.

### ~~T-306 — Upload size checked after allocation~~ RESOLVED
**File:** `functions/src/lib/admin-uploads.js`
Full JSON parse → full base64 string → full `Buffer` decode → *then* the 413.
~250 MB transient peak for a 100 MB body against a 2048 MB instance.
Editor-gated, so not anonymously reachable.

Three checks now run in increasing order of cost: `Content-Length` before the
body is read at all, `dataBase64.length` before `Buffer.from`, and the decoded
byte count as the final authority (base64 tolerates whitespace and padding).
The header one is an early reject rather than the limit — it is caller-supplied
and absent on a chunked request, so it can only ever turn work away, never
authorize it.

**One part of the prescription does not exist.** There is no
`http.maxRequestBodySize` in `host.json`. The v2+ `extensions.http` schema is
`routePrefix`, `maxOutstandingRequests`, `maxConcurrentRequests`,
`dynamicThrottlesEnabled`, `hsts`, and `customHeaders` — nothing else
([host.json settings](https://learn.microsoft.com/azure/azure-functions/functions-bindings-http-webhook#hostjson-settings),
confirmed against the live reference). Adding the key would have been silently
ignored and would have read, to the next person, as a limit that was in force.
The anonymous submissions parse the finding wanted covered therefore still needs
its own in-handler check; that is not in this fix.

Contract said 5 MB against a 15 MB implementation. Reconciled to 15 MB, which is
the deliberate value — gallery hero images run larger than cert badges, and
CertificationsPage's 5 MB picker limit is that page's UX, not the route's rule.

### ~~T-307 — Upload `contentType` unvalidated on publicly-readable containers~~ RESOLVED
**File:** `functions/src/lib/admin-uploads.js`, `blob-storage.js`
Taken verbatim from the body with no allowlist. An editor could upload
`evil.html` as `text/html` into `certifications`. Different origin from the SPA,
so not XSS — arbitrary content hosting on an org-owned domain. Also no
`ifNoneMatch`, so a caller-chosen path silently overwrote existing assets.

Now an allowlist of six image types, each mapped to the extensions that may
declare it; the declared type must be in the list **and** agree with the path's
extension, because letting them disagree is how `badge.png` ends up served as
`text/html`. `image/svg+xml` is accepted into private containers only —
SubmitUrlsPage's picker offers SVG and uploads to `content`, which the anonymous
media route does not serve, whereas an SVG on a public URL is a scriptable
document executing in the storage origin. `nosniff` does not help there: it
stops a browser guessing a type, and here the declared type is the problem.

`uploadBlob` gained an `options.overwrite` flag that becomes
`conditions: { ifNoneMatch: '*' }`; the admin route opts in, so the default is
unchanged for the AI-image and migration paths that rewrite deterministic keys
on purpose. All three upload call sites mint timestamped, randomized paths, so
the new 409 means something unintended. It is returned without logging — a
conflict is an outcome, not a failure.

The condition is asserted in `blob-storage.test.js` against a mocked SDK, not
only in the handler test: the handler test injects a fake `uploadBlob`, and
that is exactly the shape that let T-104 stay green while every real upload
threw.

(The container allowlist and `isValidBlobPath` were attacked and held — not
changed.)

### ~~T-308 — Labs console polls forever on `timeout`, and fabricates `failed`~~ RESOLVED
**File:** `frontend/src/pages/admin/LabsPage.jsx`
Terminal set omitted `'timeout'`, which is in `JOB_STATUSES`. And a transient
fetch error wrote `status: 'failed'` — a real status value, indistinguishable
from an actual failure — then stopped polling permanently, so a job that went
on to succeed was displayed as failed for good.

The terminal set now comes from `frontend/src/lib/labsPolling.js`. Worth noting
why the drift happened: the *same file* already had the correct four-element
list in `JobOutputPane` and the wrong three-element one in the poll, so a
timed-out job was polled every five seconds by a loop whose own output pane had
already declared it finished. A constant two call sites must agree on does not
belong inline in either of them.

Transport failures are now `pollError`, separate state, surfaced as a notice
that says the job is still running. The poll continues with backoff — 5 s
doubling to a 60 s ceiling, reset on the first success — and is never
abandoned, because the job is still executing on the agent and giving up means
the operator never learns how it ended.

### ~~T-309 — Labs "connected" freezes healthy during an outage~~ RESOLVED
**File:** `frontend/src/pages/admin/LabsPage.jsx`, `frontend/src/features/editor/hooks/useEditorState.js`
`setNow` had moved into the fetch success path, so a failing poll froze the
staleness clock and the dashboard kept showing "connected". The deleted code had
a dedicated ticker with a comment explaining exactly this.

Independent 5 s clock interval restored, and `setNow` removed from the fetch
entirely. The clock has to keep running when the fetch does not — that is the
only condition under which it says anything.

In-flight guards added to both polls. `postJSON`/`getJSON` allow 20 s against a
15 s snapshot interval and a 20 s editor interval, so ticks overlap and
responses can land out of order. That is worse than staleness in the editor,
where `applyRemoteDoc` compares the response's `blogEditedAt` against the load
time to decide whether someone else edited the document. The editor's guard is
released in a `finally`, not at the end of `try` — its catch block returns early
on a missing doc and on cancellation, and either path would otherwise leave the
flag set and stop the poll forever.

The job poll needed no guard: it is a self-scheduling `setTimeout` chain, so
exactly one request is in flight by construction.

### ~~T-310 — `cms-content.js` limit has no NaN or lower bound~~ RESOLVED
**File:** `functions/src/lib/cms-content.js:89`
`?limit=abc` → `TOP NaN` → 500 with raw Cosmos error text returned to the client;
`?limit=0` → `TOP 0` → silently empty. Four sibling handlers use
`Math.min(Math.max(Number(...) || DEFAULT, 1), MAX)`.

**Resolved.** Same clamp as the siblings, and `error.message` is gone from all
three 500 paths in the file (the finding named two; `deleteContent` had it too).
A loop test covers `abc`, `0`, `-5`, `''` and `NaN`.

### ~~T-311 — `queryDocs` discards the continuation token~~ NOT A DEFECT — corrected
**File:** `functions/src/lib/cosmos-client.js:285-291`

**The premise is wrong.** `fetchAll()` does not discard the continuation token —
it consumes it. The SDK's `toArrayImplementation` loops
`while (this.queryExecutionContext.hasMoreResults())`, accumulating every page
into one array
(`node_modules/@azure/cosmos/dist/commonjs/queryIterator.js:296-330`). Results
are never silently truncated, and the `offset`/`limit` applied in memory are not
"fake pagination over a truncated window": the window comes from `TOP` in the
SQL, which is the documented bounded-fetch-then-sort pattern.

What is true is the opposite hazard. Because `fetchAll` materialises the whole
result set, an **unbounded** query loads everything into the handler — which is
what T-203 was really about. Audited: the only `queryDocs` calls without `TOP`
are three `SELECT VALUE COUNT(1)` aggregates, which return one row, plus the
`image_prompt_sets_prompts` query now scoped by partition key (T-312). So the
hazard is currently contained.

The genuinely missing thing is a **cursor API** — letting a caller page through
results across requests rather than fetch a window. That is a feature, not a bug
fix, and it belongs with T-206 where real paging is the actual requirement. The
behaviour is now documented accurately on `queryDocs` so the next reader is not
misled the way this finding was.

### ~~T-312 — `queryDocs` cannot express a partition key~~ RESOLVED
**File:** `functions/src/lib/cosmos-client.js:285-291`; `cms/image-prompts.js:131-135`
The one query whose predicate matches its container's partition key
(`image_prompt_sets_prompts` on `/setName`) fans out anyway. Cheap now; the
partition key is doing no work.

**Resolved.** `queryDocs` takes an optional `partitionKey`, and
`deleteSetArtifacts` passes it. Only correct where the predicate IS the
partition key, which is documented on the option.

### ~~T-313 — Default-partition-key convention is a silent-404 trap~~ RESOLVED
**File:** `functions/src/lib/cosmos-client.js:57,60,157,271`
`readDoc`/`patchDoc`/`deleteDoc` default the partition key to the id — correct for
62 containers, wrong for `content_versions` (`/contentId`),
`image_prompt_sets_prompts` (`/setName`), `image_prompts_sets` (`/pageId`), and
`readDoc` returns `null` on 404 rather than throwing. No live bug; the first
person to add a `content_versions` reader gets `null` forever.
**Resolved.** `PARTITION_KEY_PATHS` + `resolvePartitionKey` in
`cosmos-client.js`: `readDoc`, `patchDoc`, `deleteDoc` and `replaceDocIfMatch`
all route through it, and it throws for a non-`/id` container called without an
explicit key. A test asserts the map equals the manifest, so adding a fifth
exception to `infra/cosmos-containers.json` without adding it here fails CI.

**Correction to the finding:** it named three exception containers. There are
**four** — `listen_and_learn_episodes` (`/setId`) was missing.

An explicit empty-string key is honoured rather than falling through to the id
default, which matters: the manifest records that `/contentId` was written as
the empty string on every legacy `content_versions` document.

### ~~T-314 — `putConfig` will silently delete stored OAuth tokens~~ RESOLVED
**File:** `functions/src/lib/admin-integrations.js:58-61,295-302`
Reads no longer return `oauthToken` (correct), and `putConfig` is a full replace —
so any read-modify-write round-trip deletes the token. No such call site exists
today; the first "edit MCP server" form creates one. Also `hasOauthToken` is not
stripped from incoming bodies, so it persists into stored documents.

**Resolved.** `putConfig` carries a stored `oauthToken` forward when the caller
does not supply one, and strips the read-side `hasOauthToken` boolean from
incoming bodies. An **explicit** `oauthToken` still overwrites, and an explicit
empty string still clears — revocation through this route stays possible, which
an unconditional carry-forward would have broken. Non-MCP collections are
untouched.

### ~~T-315 — Cosmos primary key in app settings for two empty triggers~~ RESOLVED
**Files:** `infra/main.tf`; `functions/src/functions/cosmos-triggers.js` (deleted)
`COSMOS_CONNECTION_STRING` carried the account primary key — readable by anyone
with Contributor and present in Terraform state — and existed solely for the
change-feed binding, whose two handlers were empty TODOs that nonetheless ran
continuously and billed lease-container RU.

Both registrations and the setting are gone. `route-inventory.test.js` now
asserts **zero** change-feed registrations, so reinstating one is a visible
decision rather than an import someone adds back.

**When the triggers return, do not reinstate the setting.** Use the
identity-based binding form, which `infra/main.tf` now spells out at the point
where the old one was:

    COSMOS_CONNECTION__accountEndpoint = azurerm_cosmosdb_account.hcw.endpoint
    COSMOS_CONNECTION__credential      = "managedidentity"

The `leases` container is kept rather than destroyed — removing a container is a
destructive Terraform change that does not belong in a code cleanup, and on a
serverless account with no processor polling it, an empty container costs only
storage.

**A side effect worth naming.** The connection string was masking a real risk:
it kept the trigger binding working while `cosmos-client.js` — which uses
managed identity — would have returned 403 on every call if
`azurerm_cosmosdb_sql_role_assignment.func_cosmos` were wrong. A half-working
app is harder to diagnose than a uniformly broken one. That assignment is now
the only thing between the app and a uniform 403.

**Not done here:** `local_authentication_disabled` is unblocked on the
application side but not set. `.github/workflows/migrate-data.yml` still passes
an optional `COSMOS_KEY`, and turning local auth off must follow the data
migration rather than precede it. Moved to [REVIEW.md](REVIEW.md) §3.2 as a
deployment decision.

### ~~T-316 — Two anonymous routes the frontend calls do not exist~~ RESOLVED
**Files:** `functions/src/lib/platform-health.js`, `functions/src/lib/legacy-blogs-telemetry.js` (both new), plus their registrations and the two frontend callers
Neither `recordLegacyBlogsRead` nor `getPlatformHealth` was registered anywhere
in `functions/src/`. Both were 404s. Found while retiring the GCP base URL in
T-101 — until then both pointed at the decommissioned Google host, so the misses
were invisible.

Both are **ports, not inventions**: the originals are in
`frontend/functions/index.js:113-249` and
`frontend/functions/cms-functions.js:3145-3230`.

**`getPlatformHealth` → `GET public/platform-health`.** Anonymous, because it
backs four indicators rendered to every visitor on the landing page; before
this, all four sat at `CHECKING` and then showed "Health check unavailable".
The five-minute cache is the finding's requirement and is the only thing
bounding how hard this route can be made to hit four third-party status APIs.
Every provider degrades to `UNKNOWN` independently, and the handler never
returns 500 — a dead upstream must not blank the panel, and failing towards
`OPERATIONAL` would be the dangerous direction, since the page would claim
everything is fine exactly when it cannot tell.

Ported without adding a dependency. The original used `axios` and `rss-parser`;
this uses global `fetch`, and for Azure a presence test on the raw feed, because
the original parsed the feed and then read nothing but `items.length`. Both
packages stay unreachable, which keeps T-407's "drop unreachable dependencies"
available and keeps them out of an anonymous route's cold start. The AWS
UTF-16 decode **is** ported faithfully — getting it wrong produces mojibake that
`JSON.parse` rejects, which would read as "AWS is down".

**`recordLegacyBlogsRead` → `POST cms/telemetry/legacy-blogs-read`.**
**Deviation from the finding, which specifies anonymous and rate-limited: this
one is guarded at `viewer`.** Its only caller is an admin page, so anonymity
bought nothing and cost an unauthenticated write endpoint whose whole job is to
increment a counter — a free write-amplification target that also lets anyone
poison the very evidence the counter exists to produce. A guard is a stronger
control than a rate limit here, and it is why no quota was added.

That removed the reason the browser used `sendBeacon` (which cannot carry a
bearer token); the call site is an ordinary async load, not an unload handler,
so nothing depended on beacon semantics.

Two adaptations: Firestore's `FieldValue.increment` on nested paths became a
read-modify-write of the whole counter document, the same adaptation
`bumpForgeStats` makes and for the same reason. And the source's allowlist named
five `useFirestore*` hooks that went away with the migration — keeping dead
entries would make the allowlist read as a record of live callers, so only the
one surviving caller is listed.

### T-319 — Bound `items[]` within an `rss_cache` document
**Files:** `functions/src/lib/public-reads.js` (getFeed); `functions/src/functions/schedulers.js` (syncRssFeeds)
T-203 bounded the *document* count the feed endpoint returns. Nothing bounds the
`items[]` array inside a document, so a single runaway feed still produces a
large anonymous response.

Left open deliberately rather than guessed: truncating the array means choosing
which end to keep, and `syncRssFeeds` is a stub, so nothing in the repository
establishes whether items are written newest-first or appended. Truncating the
wrong end silently hides the newest news — the entire point of the feature.

**Fix:** when `syncRssFeeds` is implemented, cap the array at write time (the
natural place, since the writer knows the order) and add a matching read-side
ceiling in `getFeed`. If a read-side cap is wanted sooner, sort `items` by
`pubDate` in the handler before slicing rather than trusting stored order.

### T-320 — Eight frontend tests fail, and CI does not run them
**Files:** `frontend/src/App.routes.test.jsx`, `frontend/src/pages/admin/PublishedPage.test.jsx`, `frontend/package.json`

**Diagnosed, not yet fixed** — which is the order this entry asked for.

The eight failures are **stale test expectations, not application defects**:

- `App.routes.test.jsx` asserts `/gcp`, `/terraform`, `/github` and `/finops`
  render "Coming Soon". They do not: `App.jsx` now routes each to a real
  landing page (`GCPLandingPage` and siblings). The test encodes a route
  contract from before those pages were built.
- `/aws/news` and `/azure/news` render `ProviderRssDispatcher`, lazily and
  un-mocked, and never resolve within the timeout.
- `PublishedPage.test.jsx`'s two failures are a changed `publishContent`
  payload and changed diagnostic copy.

Also worth fixing while in there: both suites pass `{ timeout: 5000 }` to
`findByText` while the vitest default test timeout is also 5000 ms, so the
assertion timeout can never fire — the test times out first and the failure
message says nothing about what was missing.

**Fix:** update the six route expectations to the pages that now exist (or mock
them, as the suite already does for `/vmware` and `/ansible`), re-point the two
`PublishedPage` assertions, drop the assertion timeouts below the test timeout,
then replace the file list in `test:admin` with a directory glob and move
`functions/firestore.rules.test.js` out of the default run — it needs the
Firestore emulator and belongs with the `test:rules` script that T-317 retired.

Deliberately not bundled with the cleanup batch: eight expectation rewrites
across two suites is its own change, and getting one wrong quietly weakens a
route contract.

### ~~T-317 — Retire the Firebase-era live smoke scripts and nested workflows~~ RESOLVED
**Files:** `frontend/scripts/`, `frontend/.github/`

`smoke-admin-hardened-live.mjs`, `smoke-admin-hardened-token-live.mjs` and
`check-ai-stack-readiness-live.mjs` read `VITE_GCP_FUNCTIONS_URL` and built a
`firebaseConfig` from `VITE_FIREBASE_*`, none of which the application sets any
more — they could not run. `frontend/.github/` held the source repository's
Firebase deploy, E2E, secret-rotation and quality workflows: inert, since GitHub
only reads `.github/workflows/` at the repository root, but they still
referenced the retired variables and read as live configuration.

**Deleted rather than ported.** The finding offered both. Porting an admin
smoke to the MSAL sign-in path is real work, not a rename, and a half-migrated
script that looks runnable and is not is worse than no script — which is
exactly the state these were in. Their npm scripts are gone too
(`smoke:admin:hardened`, `smoke:admin:hardened:token`, `readiness:remote:auto`,
`smoke:firebase:postdeploy`), along with `test:rules` and
`verify:optional:security`, which invoked the Firebase emulator.

A deployed smoke test is still wanted — it is the top open item in the work
order — but it should be written against Entra and the Azure routes rather than
recovered from these.

### T-318 — Route image rendering through `resolveMediaUrl()` (cross-origin only)
**Files:** ~30 components rendering `imageUrl` / `heroImageUrl` / `aiImageUrls`
Uploaded-image URLs are stored site-relative (`/api/public/media/...`) so that a
topology change cannot invalidate rows already in Cosmos. Components render them
straight into `<img src>`, which is correct **only** in the same-origin topology.

**Conditional on [REVIEW.md](REVIEW.md) §0.1.** If cross-origin is chosen, every
render site must call `resolveMediaUrl()` from
`frontend/src/lib/functionsBase.js`; the helper and its tests already exist.
If same-origin is chosen, close this as not applicable. Doing the churn before
the decision would touch thirty files to no purpose and risk breaking the
absolute source-system URLs that legacy documents still hold.

---

## LOW

### ~~T-401 — `vps-agent` heartbeat field mismatch, over-broad credential, incomplete~~ RESOLVED
**File:** `vps-agent/index.js:15-53`
Wrote `lastPing` while `labs.js:188` reads `lastSeenAt` — **the Labs connected
indicator could never be true.** Used a Cosmos **account primary key** on a
third-party VPS, contradicting `cosmos-client.js:5-8`. `pollJobs()` was a stub;
no heartbeat interval; and the module used ESM syntax in a package with no
`"type": "module"`, so it could not have run at all.

**Resolved by removing the database credential entirely.** The VPS is outside
the trust boundary in the same way the browser is, so it now gets the same
answer the browser got: an authenticated API, no data-plane client.

- **`auth/require-agent.js`** — a guard disjoint from the admin one. Gate 1 is
  the `LabAgent` App Role; gate 2 is a `lab_agents/{agentId}` document whose
  `oid` matches the token's. That binding is what stops any holder of an agent
  token from acting as an arbitrary agent. The registry is read on every call,
  with no cache, so revoking `active` takes effect immediately rather than
  after a TTL. An admin token does not satisfy it and an agent token does not
  satisfy `requireRole`.
- **`lib/lab-agent.js`** — three endpoints, `agent/claimLabJob`,
  `agent/heartbeat`, `agent/completeLabJob`. Capabilities come from the registry
  rather than the request; terminal statuses exclude `cancelled`, which belongs
  to the operator; completing a job requires holding it. Claim atomicity moved
  from the source's Firestore transaction to an ETag-guarded write
  (`replaceDocIfMatch`, new in `cosmos-client.js`), and a claim lease lets a
  dead agent's work be picked up instead of stranded — a hole the source had.
- **`lastSeenAt` is now written server-side**, so no future agent can get the
  field name wrong.
- **The agent was rewritten** around a `ClientCertificateCredential`, and the
  capability allowlist and Docker sandbox were ported from
  `frontend/labs/vps-agent/lib/`.

The route-inventory test (T-103) was extended to recognise the agent guard as a
third gate; a mutation check confirms it still names an unguarded route.

**Still not deployable, for a different reason than before.** None of this has
run against a deployed environment, and the pieces below are not code:
the app registration, its `LabAgent` App Role, the certificate, and the
`lab_agents` registry documents all have to be created by hand — see
[CHECKLIST.md](CHECKLIST.md) and [REVIEW.md](REVIEW.md) §0.4.

### ~~T-402 — Contract drift in `.azure/api-surface.json`~~ RESOLVED
Every drift the finding names is reconciled:

- Upload cap 5 MB → 15 MB (done with T-306).
- `GET /api/cms/labs`, documented but deliberately never built — entry deleted.
- ai-providers note "oauthToken stripped from every read" → the read-side
  `hasOauthToken` boolean, and the write-side strip (T-314).
- `storageMigration.to` still described browser-held SAS while `portSequence`
  step 5 recorded the base64 change. The SAS design was **not built** and could
  not have worked: the account is closed to the internet and
  `allow_nested_items_to_be_public` is false, so a browser-held SAS would have
  had nothing to talk to (T-105). Rewritten to describe what exists.
- `GET /api/health` documented.

**`/api/health` also stopped reporting the runtime.** It returned
`node: process.version` and the site name to anyone, which is an
unauthenticated inventory of the runtime version and deployment name and is of
no use to a liveness probe. `status`, `service` and `startedAt` remain —
`startedAt` because telling a cold start from a warm instance has a real
diagnostic use and discloses nothing.

### ~~T-403 — `.env.example` is substantially stale~~ RESOLVED
**File:** `frontend/.env.example`
`VITE_ENTRA_API_SCOPE` was **required and undocumented** (without it every token
is acquired for no scope). The file documented `VITE_OWNER_ADMIN_EMAIL`/`_UID`
and carried Firebase secret-set instructions for decommissioned tooling.

**Resolved** alongside T-101: rewritten against the actual `import.meta.env`
inventory (nine variables, enumerated in `vite.config.js`). One correction to
the finding as written — it claimed code reads `VITE_ADMIN_EMAILS`/`_UIDS`. No
file under `src/` reads either; the build-time admin allowlist went away with
the MSAL swap in #60, and admin access is now the Entra App Role plus the
`admins/{oid}` registry. Neither variable is documented in the rewrite.
The Cosmos endpoint and read key are gone from the file, with a comment
explaining why they must not return.

### ~~T-404 — CSP still grants the entire Firebase/GCP surface~~ RESOLVED
**File:** `frontend/staticwebapp.config.json`

`connect-src` still allowed `*.googleapis.com`, `*.firebaseio.com`,
`*.cloudfunctions.net`, `*.run.app` and `wss://*.firebaseio.com` — a standing
permission for origins the application cannot reach. `*.documents.azure.com` was
there too, contradicting the constraint that the browser never holds a Cosmos
data-plane client. `frame-src` still listed `*.firebaseapp.com`.

**`login.microsoftonline.com` was absent from both `connect-src` and
`frame-src`.** Admin sign-in cannot complete without the first, and MSAL's
silent token renewal — a hidden iframe against the same authority — cannot work
without the second. That was a live outage waiting on the first deploy, not
cleanup.

`script-src` lost `googletagmanager.com` and `apis.google.com` (no references
anywhere in the repository) and kept `static.cloudflareinsights.com`, which
Cloudflare injects at the edge rather than this repository.

**Not blocked on the §0.1 topology decision after all.** `'self'` covers a
same-origin `/api` base and `https://*.azurewebsites.net` covers the
cross-origin one; keeping both is correct under either choice, and the wildcard
can be dropped once §0.1 settles on same-origin.

Enforced by `frontend/src/lib/csp.test.js` (8 tests, in `test:admin`). A CSP
failure shows up in a browser console on a deployed site and nowhere else —
no build, lint or component test sees it. That test also caught a mistake in its
own first draft: a blanket "no googleapis.com" assertion fails on
`fonts.googleapis.com`, which `index.html` genuinely loads for the Material
Symbols stylesheet. The guard is scoped to the three directives that give code
a destination.

### ~~T-405 — Key Vault reads uncached, failures indistinguishable from absence~~ RESOLVED
**File:** `functions/src/lib/key-vault.js`
Every call was a network round trip on a throttled service, and throttled,
missing and RBAC-denied all returned `null`.

Both halves fixed as prescribed. A five-minute TTL cache, and `null` **only**
on a genuine 404 — everything else throws, carrying the real reason, so a
caller can retry it. Absence is cached too; without that, a secret that is
legitimately not configured turns every call into a round trip, which is the
behaviour being removed, just on the unhappy path. A transient failure is not
cached, because it is a condition rather than a fact about the secret.

This matters more than it looks: `getGoogleAuth` turns `null` into the message
"missing or unreadable", which was precisely the ambiguity that made it useless.

### ~~T-406 — Authorization denials are console-only~~ ALREADY RESOLVED — verified
**File:** `functions/src/lib/auth/default-guard.js`

**The finding was stale when it was written down.** `auditDenial` is injected,
and `default-guard.js` — the production composition — supplies an
`admin_audit_logs` upsert. The writer exists.

What was true is that nothing tested it: `require-role.test.js` covers the
guard's behaviour against injected fakes, which is the right shape for the
rules but cannot see whether the real composition supplies the dependencies at
all. Deleting the `auditDenial` line failed no test. `default-guard.test.js`
now covers it, along with the `admins/{oid}` lookup, the memoisation, and the
deliberate absence of any work at import time.

The comment in `require-role.js` that still read "the container exists on the
Azure side with no writer" — the sentence this finding was drawn from — is
corrected.

### ~~T-407 — `total` reports page size, and cold-start weight~~ RESOLVED
**File:** `functions/src/lib/public-reads.js`, `functions/package.json`

`total: items.length` was measured *after* the slice, in two handlers, so it
always equalled the page size and any paginating consumer would conclude there
was exactly one page. Counted before the slice now. It remains bounded by
`FETCH_WINDOW`, which is documented at the call site: that is a smaller
inaccuracy than the page size and the honest one available without a second
`COUNT` query — an exact total needs the cursor API tracked in T-206.

**Six dependencies dropped** — `sharp`, `replicate`, `turndown`,
`@mendable/firecrawl-js`, `axios`, `rss-parser`. Zero references anywhere under
`src/`. The lockfile shrank by ~1,190 lines and `npm ci` was re-verified.
Dropping `axios` and `rss-parser` is what makes T-316's choice to port the
health route onto global `fetch` load-bearing rather than incidental.

**`@aws-sdk/client-pricing` and `google-auth-library` are kept**, against the
finding's list. They are unreachable *from a route*, but
`src/lib/cloud-tools/pricing/{aws,gcp}.js` import them and are tested; removing
the dependency removes a staged feature, which is a product decision rather
than a cleanup.

**`cheerio` is deliberately NOT lazy-imported.** It is reached through
`content-quality.js`, whose `countWords` is synchronous and feeds the publish
quality gate. Making it async ripples through the publish pipeline, and
replacing the parser with a regex changes word counts — which changes which
articles pass the gate. Trading a correctness risk in a publish gate for
cold-start milliseconds on an anonymous GET is a bad trade.

### T-408 — Cleanups (mostly done)
**Done:**

- `ContextSidebar.jsx` — the 23 lines of unresolved AI deliberation are gone,
  replaced by a statement of what the component does and why. The security
  question the old comment left open ("if safety allows") is answered rather
  than deleted: raw HTML stays unrendered, because "admin-authored" is an
  argument about who writes the content, not about who reads it — the sidebar
  renders on public pages.
- Stale comments corrected in `useGenerateCuratedImages.js` ("Firestore cache",
  "Firebase Auth Bearer token").
- `require-role.js:147` and the same line in `require-agent.js` — the dynamic
  `import()` on the authenticated hot path is now a static import.
  `verify-token.js` imports nothing from either module, so there was never a
  cycle to break.
- The role cache is bounded (`ROLE_CACHE_MAX_ENTRIES`, expired-first eviction).
  It is only reachable after a token verifies, so an anonymous caller could not
  grow it — but it had no eviction at all, so it grew with every distinct
  principal that ever signed in.
- `submissions.js` sanitizes `overviewHtml` on ingest
  (`functions/src/lib/sanitize-html.js`). That field arrives through an
  anonymous endpoint and ends up inside `dangerouslySetInnerHTML` on a public
  template, where a single `DOMPurify.sanitize()` call was the only thing
  between the two. The client-side call stays — two layers is the point.

  No dependency was added: `cheerio` is already in the tree, so the sanitizer
  uses a real parser rather than regexes over markup, which is how sanitizers
  get written that look right and are not. Fourteen tests, all negative.

**Remaining:** `frontend/package.json` `test:admin` still names files
explicitly rather than globbing — see T-320, which is where that belongs and
where the blocking diagnosis lives. Each new frontend test file has to be added
by hand until then; `useEditorState.poll.test.jsx` is the latest.

---

## Test recommendations

Backend coverage is strong (517 tests); frontend coverage of the migration is
effectively zero when the review ran. T-303, T-304, T-308 and T-309 would each
have been caught by a modest test, and all four now are — as would T-208 and
T-209, which are the first two to get hook-level tests rather than tests of the
pure helpers underneath them.

| Type | Scenario | Assertion | Covers |
| --- | --- | --- | --- |
| Integration | Route inventory over `index.js` | guard + OPTIONS + CORS per registration | T-102, T-103 |
| Unit | `api.js` with `VITE_BACKEND_PROVIDER=azure` | resolves to `VITE_AZURE_FUNCTIONS_URL` | T-101 |
| ~~Unit~~ | ~~Date helpers: ISO, null, malformed, Timestamp~~ | ~~correct ms or 0; never NaN~~ | ~~T-303, T-304~~ — written |
| ~~Hook~~ | ~~Save, then external `blogEditedAt` on next poll~~ | ~~`externallyModified === true`~~ | ~~T-208~~ — written |
| ~~Hook~~ | ~~Reorder images, advance 20 s, unchanged remote~~ | ~~ordering preserved~~ | ~~T-209~~ — written |
| ~~Unit~~ | ~~Job poll with `timeout`; with rejected fetch~~ | ~~stops; does not fabricate `failed`~~ | ~~T-308, T-309~~ — written |
| Unit | `cms-content.list` limit `abc`/`0`/`-5`/`99999` | clamped to [1,500] | T-310 |
| Unit | `putConfig` omitting `oauthToken` | stored token preserved | T-314 |
| ~~Unit~~ | ~~`uploadFile` `text/html`; oversized Content-Length~~ | ~~415; 413 before decode~~ | ~~T-306, T-307~~ — written |
| Contract | Every `implemented` contract entry | resolves to a live route | T-402 |
| ~~Unit~~ | ~~Health route with a dead upstream; called 20× in one TTL~~ | ~~that provider UNKNOWN, others unaffected; one round of upstream calls~~ | ~~T-316~~ — written |

---

## Recently Closed

| Item | Closed by |
| --- | --- |
| Frontend Firebase decoupling (34 files → 0) | #61–#66 |
| Dependency advisories cleared | #67 |
| Admin auth swap to Entra ID / MSAL | #60 |
