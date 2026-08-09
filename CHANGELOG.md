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
- **Self-hosted CI runner** — Azure Container Apps Job with KEDA scale-to-zero, an
  ephemeral JIT-config runner image published to Docker Hub with a GHCR mirror,
  and a `CI_RUNNER` repository-variable failover switch. (#48)
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

### Infrastructure

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
