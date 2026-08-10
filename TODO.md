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
| Open items | 35 |
| Critical | 0 |
| High | 10 |
| Medium | 18 |
| Low | 7 |
| Resolved since the review | 7 (T-101, T-102, T-103, T-104, T-105, T-401, T-403) |
| Last updated | 2026-08-09 |
| Source | Code Review SOP run, repository-wide, three reviewers (SOP / security / Azure architecture), de-duplicated per Phase 11 |

**Release readiness: STILL NOT VERIFIED.** All five Critical items are
resolved, and the suite is now 619 functions tests and 31 frontend tests. That
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
4. ~~**T-403**~~ `.env.example` rewritten with T-101; **T-404** tighten CSP
5. **Deploy a smoke test** — everything above is unverifiable from an agent
   session, and this is now the top open item
6. **T-201 → T-205** the anonymous data-exposure set
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

### T-201 — `speakerevents` snapshot leaks admin emails and hidden events anonymously
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

**Fix:** add `speakerevents: sanitizeSpeakerEvent` modelled on the certifications
sanitizer — require `display === true`, positive field allowlist. Defence in
depth: `items: (doc.items || []).map(stripInternalFields)` in `getSnapshot`.

---

### T-202 — `listPodcasts` and `getFeed` skip the public filter
**Category:** Security · **Label:** Confirmed Issue
**File:** `functions/src/lib/public-reads.js:249-252`, `:283-284`

The module header states the filter *"is the only thing keeping drafts and
soft-deleted docs out of anonymous responses."* Two of five handlers don't call
it. `getFeed` filters `ai_insights` on `active !== false` only, so a soft-deleted
insight is still returned; `rss_cache` is unfiltered.

Not a regression — the pre-migration hooks had no client-side check either — but
the contract says the server must filter, and nothing downstream compensates.

**Fix:** `.filter(isPublicDocument)` on both, before `.slice()`.

---

### T-203 — `getFeed` has no `TOP` clause
**Category:** Performance / DoS · **Label:** Confirmed Issue
**File:** `functions/src/lib/public-reads.js:271`, `:274`

`SELECT * FROM c WHERE c.provider = @provider` on `rss_cache` and `ai_insights`,
unbounded, on an anonymous endpoint. `queryDocs` calls `.fetchAll()`.
`rss_cache` is TTL-bounded at 7 days but that bound is set by `syncRssFeeds`, an
unimplemented scheduler — the day it goes live this becomes a function of feed
volume with no ceiling. `ai_insights` has no TTL.

**Fix:** add `TOP` to both, sized to what `useNewsData.js` renders. Two lines.

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

### T-208 — Editor poll can silently overwrite a collaborator's save
**Category:** Defect (lost update) · **Label:** Confirmed Issue
**File:** `frontend/src/features/editor/hooks/useEditorState.js:291-299`, `:340`

`pendingLocalSaveRef` is consumed by whatever the *next* poll returns. Under
`onSnapshot` that was our own write within milliseconds. Under a 20-second poll
it may be someone else's version — the branch then calls
`setExternallyModified(false)` and adopts their `blogEditedAt`, so the next save
passes the server's optimistic-concurrency check and overwrites them with no
warning to either party. A ~20,000× widening of a pre-existing race.

**Fix:** make the flag identity-based — have `saveEditorDraft` return the
`blogEditedAt` it wrote, and take the pending-save branch only when the polled
value equals it. Strictly more correct than the `onSnapshot` version was.

---

### T-209 — Editor poll discards unsaved image reordering every 20 seconds
**Category:** Defect (loss of user work) · **Label:** Confirmed Issue
**File:** `frontend/src/features/editor/hooks/useEditorState.js:301-310`

`applyRemoteDoc` runs on every tick — the poll has no change detection — so the
`!wasRemoteUpdateAfterLoad` branch resets `orderedImageUrls` (user-mutable local
state, only persisted on save) to the remote value every 20 seconds.

**Fix:** early-return from `applyRemoteDoc` when
`remoteEditedAtMs === lastSeenEditedAtMsRef.current` after initialization. Also
removes a full editor re-render every 20 seconds while idle.

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

### T-301 — `scheduledPublishDate` never publishes (write side complete, read side empty)
**File:** `functions/src/functions/schedulers.js:27-38`

The timer body is a TODO behind `FEATURE_FLAG_SCHEDULERS`. The write side is
fully shipped: `content-workflow.js:425-433` validates and persists,
`BlogReviewBoard.jsx:136-149` renders scheduling UI, Calendar and Queue display
it. An operator schedules, the server accepts, the UI confirms — nothing
publishes, with no error or alert. A complete non-functional feature is worse
than an absent one.

**Implementation requirements** (verified against the code): query
`scheduledPublishDate <= @nowIso AND contentStatus = 'approved' AND (NOT
IS_DEFINED(c.Live) OR c.Live = false)` — this query **can** safely `ORDER BY`,
because the `WHERE` already requires the field to exist, so the blanket
"never ORDER BY" rule does not apply and must not be cargo-culted here; the
composite index `(/Live, /scheduledPublishDate)` already exists; call
`processPublishContent` rather than reimplementing; **add an ETag precondition**
on the status flip (`processPublishContent` reads at `:238` and patches at `:355`
with no guard — two runs can both publish); **clear `scheduledPublishDate` after
publishing** or every tick re-matches forever (silent, manifests as version-history
spam); cap at 25/tick with carry-over; normalize to UTC; write failures to
`workflow_alerts`.

**Until implemented:** hide the scheduling UI or reject `scheduledPublishDate`
with 501.

### T-302 — All four timers share one flag, and one deletes blobs
**File:** `functions/src/functions/schedulers.js:13`

`FEATURE_FLAG_SCHEDULERS` gates `syncRssFeeds`, `publishScheduledContent`,
`cleanupTempStorage` (**deletes blobs**) and `checkAgentHealth` together.
Finishing T-301 and flipping the flag arms an unimplemented blob-deletion job
whose TODO implies a query that the current `queryDocs` (no continuation token)
would truncate — classifying everything past the window as an orphan. Only
`delete_retention_policy { days = 7 }` makes that recoverable.

**Fix:** per-timer flags. Do not implement blob GC until `queryDocs` supports
continuation tokens (T-311); make the first version dry-run.

### T-303 — `BlogReviewBoard` throws on a scheduled date
**File:** `frontend/src/components/admin/BlogReviewBoard.jsx:138`
`blog.scheduledPublishDate.toDate()` on a value that is now an ISO string.
Reproduce: open `/admin/review/{id}` for any scheduled item. Throws inside a
`setTimeout`, outside the error boundary.

### T-304 — Published/EditorList sorts are permanent no-ops
**Files:** `PublishedPage.jsx:92-101`; `EditorListPage.jsx:95-97,116-131,266-267,329`
`?.toMillis?.() || 0` on ISO strings → always 0 → comparator always returns 0.
Lists render in raw Cosmos order; sort controls do nothing; timestamps show `—`.
Four sibling files got the three-branch fix in the same migration; these did not.
**Fix:** extract `lib/dateUtils.js`, replace all seven copies.

### T-305 — Detail-page slug resolution is non-deterministic
**File:** `functions/src/lib/public-reads.js:195-204`
`SELECT TOP 1` with no `ORDER BY`, and the public filter applied *after*. Two
documents sharing a slug resolve arbitrarily, and a published article can 404
because an unpublished duplicate sorted first. **Fix:** filter in SQL, `ORDER BY
c._ts DESC` (always present, so the drop-on-undefined trap does not apply).

### T-306 — Upload size checked after allocation
**File:** `functions/src/lib/admin-uploads.js:68-86`
Full JSON parse → full base64 string → full `Buffer` decode → *then* the 413.
~250 MB transient peak for a 100 MB body against a 2048 MB instance.
Editor-gated, so not anonymously reachable. **Fix:** `Content-Length` pre-check
and a `dataBase64.length` check before `Buffer.from`; add
`http.maxRequestBodySize` to `host.json` (also covers the anonymous
submissions parse). Contract says 5 MB, implementation is 15 MB — reconcile.

### T-307 — Upload `contentType` unvalidated on publicly-readable containers
**File:** `functions/src/lib/admin-uploads.js:70`, `blob-storage.js:57`
Taken verbatim from the body with no allowlist. An editor can upload
`evil.html` as `text/html` into `certifications`. Different origin from the SPA,
so not XSS — arbitrary content hosting on an org-owned domain. Also: no
`ifNoneMatch`, so a caller-chosen path silently overwrites existing assets.
**Fix:** content-type allowlist + matching extension check + `ifNoneMatch: '*'`.
(The container allowlist and `isValidBlobPath` were attacked and held — do not
change those.)

### T-308 — Labs console polls forever on `timeout`, and fabricates `failed`
**File:** `frontend/src/pages/admin/LabsPage.jsx:373-381`
Terminal set omits `'timeout'`, which is in `JOB_STATUSES`. And a transient fetch
error writes `status: 'failed'` — a real status value, indistinguishable from an
actual failure — then stops polling permanently.
**Fix:** import the terminal set from a shared constant; keep a transport error in
separate state and retry with backoff.

### T-309 — Labs "connected" freezes healthy during an outage
**File:** `frontend/src/pages/admin/LabsPage.jsx:121-137`
`setNow` moved into the fetch success path, so a failing poll freezes the
staleness clock and the dashboard keeps showing "connected". The deleted code had
a dedicated ticker with a comment explaining exactly this.
**Fix:** restore the independent clock interval. Also add an in-flight guard to
this poll and the editor's — 20 s timeout against a 15/20 s interval overlaps.

### T-310 — `cms-content.js` limit has no NaN or lower bound
**File:** `functions/src/lib/cms-content.js:89`
`?limit=abc` → `TOP NaN` → 500 with raw Cosmos error text returned to the client;
`?limit=0` → `TOP 0` → silently empty. Four sibling handlers use
`Math.min(Math.max(Number(...) || DEFAULT, 1), MAX)`. Also stop returning
`error.message` at `:114`/`:138`.

### T-311 — `queryDocs` discards the continuation token
**File:** `functions/src/lib/cosmos-client.js:285-291`
`.fetchAll()` with no continuation support, so `offset`/`limit` everywhere is
fake pagination over a truncated window. Prerequisite for T-206 real paging and
for safe blob GC (T-302).

### T-312 — `queryDocs` cannot express a partition key
**File:** `functions/src/lib/cosmos-client.js:285-291`; `cms/image-prompts.js:131-135`
The one query whose predicate matches its container's partition key
(`image_prompt_sets_prompts` on `/setName`) fans out anyway. Cheap now; the
partition key is doing no work.

### T-313 — Default-partition-key convention is a silent-404 trap
**File:** `functions/src/lib/cosmos-client.js:57,60,157,271`
`readDoc`/`patchDoc`/`deleteDoc` default the partition key to the id — correct for
62 containers, wrong for `content_versions` (`/contentId`),
`image_prompt_sets_prompts` (`/setName`), `image_prompts_sets` (`/pageId`), and
`readDoc` returns `null` on 404 rather than throwing. No live bug; the first
person to add a `content_versions` reader gets `null` forever.
**Fix:** generate a container→partition-key map from the migration manifest and
throw when a container needs an explicit key.

### T-314 — `putConfig` will silently delete stored OAuth tokens
**File:** `functions/src/lib/admin-integrations.js:58-61,295-302`
Reads no longer return `oauthToken` (correct), and `putConfig` is a full replace —
so any read-modify-write round-trip deletes the token. No such call site exists
today; the first "edit MCP server" form creates one. Also `hasOauthToken` is not
stripped from incoming bodies, so it persists into stored documents.

### T-315 — Cosmos primary key in app settings for two empty triggers
**Files:** `infra/main.tf:565-574`; `functions/src/functions/cosmos-triggers.js:17-56`
`COSMOS_CONNECTION_STRING` carries the account primary key, readable by anyone
with Contributor, and blocks `local_authentication_disabled`. It exists solely
for the change-feed binding — whose two handlers are empty TODOs that
nonetheless run continuously, billing lease-container RU.
**Fix:** drop the trigger import and the setting until the handlers are
implemented, then use the identity-based binding form
(`COSMOS_CONNECTION__accountEndpoint` + `__credential=managedidentity`).

### T-316 — Two anonymous routes the frontend calls do not exist
**Files:** `frontend/src/lib/legacyBlogsTelemetry.js`,
`frontend/src/pages/shared/HomePage.jsx:325`; `functions/src/functions/`
Neither `recordLegacyBlogsRead` nor `getPlatformHealth` is registered anywhere
in `functions/src/`. Both are 404s.

- **`recordLegacyBlogsRead`** — the legacy-blogs read beacon. It fails silently,
  because both the `sendBeacon` and `fetch` paths swallow failures by design, so
  fallback-container reads are unmeasured. That telemetry is the evidence for
  retiring the fallback container.
- **`getPlatformHealth`** — backs the home page's four cloud-status indicators,
  which will sit at `CHECKING` and then render "Health API unavailable" to every
  anonymous visitor on the landing page.

Found while retiring the GCP base URL in T-101: both endpoints had been pointing
at the decommissioned Google host, so the misses were invisible.
**Fix:** port both routes (anonymous, rate-limited; the health route needs a
cache so it cannot be used to hammer upstream status APIs), or delete the
callers if neither feature is wanted. This is separately a case for T-103's
route-inventory test to compare the frontend's call sites against the registered
route table, not just the documented one.

### T-317 — Retire the Firebase-era live smoke scripts and nested workflows
**Files:** `frontend/scripts/smoke-admin-hardened-live.mjs`,
`frontend/scripts/smoke-admin-hardened-token-live.mjs`,
`frontend/.github/workflows/`
The two live smoke scripts still read `VITE_GCP_FUNCTIONS_URL` and build a
`firebaseConfig` from `VITE_FIREBASE_*`, none of which the application sets any
more; they cannot run. `frontend/.github/workflows/` holds the source
repository's Firebase deploy and E2E workflows — inert, since GitHub only reads
`.github/workflows/` at the repository root, but they still reference the
retired variable and read as live configuration.

Left untouched by T-101 deliberately: porting an admin smoke to MSAL is real
work, not a rename, and half-migrating it would produce a script that looks
runnable and is not.
**Fix:** port the smoke to the Entra/MSAL sign-in path, or delete both scripts
and the nested workflow directory.

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

### T-402 — Contract drift in `.azure/api-surface.json`
Uploads say 5 MB (actual 15 MB); `GET /api/cms/labs` documented but deliberately
never built (delete the entry); ai-providers note says `oauthToken` stripped
(now a `hasOauthToken` boolean); `storageMigration.to` still specifies SAS while
`portSequence` step 5 records the base64 change — two sections contradict each
other. `GET /api/health` is implemented but undocumented and reports
`process.version` anonymously.

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

### T-404 — CSP still grants the entire Firebase/GCP surface
**File:** `frontend/staticwebapp.config.json`
Zero Firebase imports remain, but `connect-src` still allows `*.googleapis.com`,
`*.firebaseio.com`, `*.cloudfunctions.net`, `*.run.app`, `wss://*.firebaseio.com`
— dead allowlist. `login.microsoftonline.com` is **absent** from `connect-src`
and `frame-src`; verify admin sign-in works at all. `*.documents.azure.com` must
go (see [REVIEW.md](REVIEW.md) Cosmos-key item). Note `'self'` does not cover the
`api-azure` subdomain — CSP and DNS disagree about the API host. Since T-101 the
API host is whatever `VITE_AZURE_FUNCTIONS_URL` names, so `connect-src` must be
written against the topology chosen in [REVIEW.md](REVIEW.md) §0.1: `'self'`
suffices for a same-origin `/api` base, and nothing else does.

### T-405 — Key Vault reads uncached, failures indistinguishable from absence
**File:** `functions/src/lib/key-vault.js:29-41`
Every call is a network round trip on a throttled service; throttled, missing and
RBAC-denied all return `null`. **Fix:** TTL cache; return `null` only on 404,
throw otherwise.

### T-406 — Authorization denials are console-only
**File:** `functions/src/lib/auth/require-role.js:70-73`
`auditDenial` runs on every denial; `admin_audit_logs` exists with no writer, as
the module itself notes.

### T-407 — `total` reports page size, and cold-start weight
`public-reads.js:173` returns `total: items.length` after slicing — wrong page
counts for any paginating consumer (none today). Separately, `index.js` imports
every trigger, pulling `cheerio` into an anonymous `GET public/content` cold
start; `sharp`, `@aws-sdk/client-pricing`, `google-auth-library`, `replicate` ship
unreachable. Lazy-import `cheerio`; drop unreachable dependencies.

### T-408 — Cleanups
`ContextSidebar.jsx:48-70` — 23 lines of unresolved AI deliberation in production
source, leaving a security question ("if safety allows") open in a comment.
Stale comments: `useGenerateCuratedImages.js:87,99-101` ("Firestore cache",
"Firebase Auth Bearer token"), `blob-storage.js:43`. `require-role.js:147` does a
dynamic `import()` on the hot path; `:68` cache is unbounded.
`frontend/package.json` `test:admin` covers **none** of the 65 files changed in
#61–#67 — switch to a directory glob. `submissions.js` should sanitize
`overviewHtml` on ingest, not rely solely on client-side DOMPurify.

---

## Test recommendations

Backend coverage is strong (517 tests); frontend coverage of the migration is
effectively zero. T-303, T-304, T-308, T-309 would each have been caught by a
modest test.

| Type | Scenario | Assertion | Covers |
| --- | --- | --- | --- |
| Integration | Route inventory over `index.js` | guard + OPTIONS + CORS per registration | T-102, T-103 |
| Unit | `api.js` with `VITE_BACKEND_PROVIDER=azure` | resolves to `VITE_AZURE_FUNCTIONS_URL` | T-101 |
| Unit | Date helpers: ISO, null, malformed, Timestamp | correct ms or 0; never NaN | T-303, T-304 |
| Hook | Save, then external `blogEditedAt` on next poll | `externallyModified === true` | T-208 |
| Hook | Reorder images, advance 20 s, unchanged remote | ordering preserved | T-209 |
| Unit | Job poll with `timeout`; with rejected fetch | stops; does not fabricate `failed` | T-308 |
| Unit | `cms-content.list` limit `abc`/`0`/`-5`/`99999` | clamped to [1,500] | T-310 |
| Unit | `putConfig` omitting `oauthToken` | stored token preserved | T-314 |
| Unit | `uploadFile` `text/html`; oversized Content-Length | 415; 413 before decode | T-306, T-307 |
| Contract | Every `implemented` contract entry | resolves to a live route | T-402 |

---

## Recently Closed

| Item | Closed by |
| --- | --- |
| Frontend Firebase decoupling (34 files → 0) | #61–#66 |
| Dependency advisories cleared | #67 |
| Admin auth swap to Entra ID / MSAL | #60 |
