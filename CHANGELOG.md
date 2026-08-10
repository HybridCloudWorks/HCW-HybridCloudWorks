# CHANGELOG

Completed features, fixes, enhancements, security fixes, and released changes.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file records **completed work only**. Outstanding engineering work belongs in
[TODO.md](TODO.md); human-resolvable blockers in [REVIEW.md](REVIEW.md);
required inputs in [CHECKLIST.md](CHECKLIST.md).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project has not cut a tagged release; entries are grouped under
`[Unreleased]` and reference the pull request that landed them.

---

## [Unreleased]

### Added

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
