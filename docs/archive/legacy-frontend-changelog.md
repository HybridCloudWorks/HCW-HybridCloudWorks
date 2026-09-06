# Changelog

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


All notable changes to this project. Each entry lists the task, date, what was done, and why.

Format: `task (commit) — date — what — why`

---

## 2026-06-12 — Linkie/Klaviyo production stabilization

- **fix: Retrofit Linkie integration and deploy backend/frontend** — 2026-06-12
  — Replaced the prior Linktree wiring with Linkie (`linkieProxy`, `/admin/linkie`, `LINKIE_API_KEY`,
  and `https://app.linkie.bio/api/v1`); verified Notion → SOPS → Firebase Secret Manager sync for
  `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`, and `KLAVIYO_LIST_ID`.
  — `deploy-functions` completed successfully after the secrets landed in Firebase Secret Manager.
  — Frontend Firebase Hosting was deployed directly with Firebase CLI without dispatching GitHub
  workflows; `https://hybridcloudworks.com` returned HTTP 200 after release.

---

## v1.5.0 — 2026-06-11 — Platform 2.0 release

### Security

- **fix: Gate `generatePostContent`, `fetchBlogListingsManual`, `fetchPodcastFeedsManual` behind admin auth** — 2026-06-11
  — Added `applyAdminCors` + `requireAdminClaims(req, res, 'editor')` to all three previously
  unauthenticated HTTP functions; `generatePostContent` now allowlists the target collection to
  `content` only.
  — Closes denial-of-wallet and arbitrary-collection-write paths (TODO2.0 H-1/H-2/H-3).
- **fix: `refreshPlaudTokenNow` checks `adminRole` custom claim** — 2026-06-11
  — Replaced the retired legacy `admin` claim check (M-1).
- **fix: Remove `VITE_PUBLER_*` from deploy workflow and `.env.example`** — 2026-06-11
  — The Publer key no longer ships in the browser bundle; runtime uses `publerProxy` (M-2).
  — ⚠️ Manual Publer key rotation is still required (prior bundles exposed the key).
- **fix: Remaining P0 hardening** — 2026-06-11
  — Capped/whitelisted `recordLegacyBlogsRead` details payload (M-3); HTML-escaped the
  `ServiceDocsPage` highlighter before `dangerouslySetInnerHTML` (M-4); admin bootstrap button
  hidden when admins exist (L-1); `mcpProxy`/`syncMcpTools` raised to editor role (L-2);
  malformed `.gitignore` line fixed (L-3).

### UI/UX

- **feat: Hyoga dark-luxe restyle across the public site** — 2026-06-11
  — Near-black charcoal base, display typography, eyebrow labels, numbered sections, glassy stat
  blocks; major `src/index.css` consolidation (glass classes, per-provider link rules, glows,
  header/footer backgrounds tokenized). New shared components: `Eyebrow`, `NumberedSection`,
  `StatBlock`, `ProviderLandingTemplate`. HomePage, Header, and Footer rebuilt.
  — Every provider keeps its existing color theme; provider `--primary` tokens fill the
  template's accent slot.

### Providers

- **feat: Re-enable all six provider landing pages** — 2026-06-11
  — AWS, Azure, GCP, FinOps, Terraform, GitHub `ComingSoonPage` guards removed; pages relaunched
  on the shared Hyoga landing template. FinOps Architecture page re-enabled; education-detail
  dispatcher gaps and mobile-grid/contrast defects fixed.
- **feat: Add VMware and Ansible providers (8 total)** — 2026-06-11
  — New `src/pages/vmware/` and `src/pages/ansible/` page sets, `.theme-vmware`/`.theme-ansible`
  token blocks, dispatcher and validation-script coverage.
- **feat: Public Coder Corner pages** — 2026-06-11
  — `/:provider/coder-corner` list and `/:slug` detail routes via `ProviderCoderCornerPage` and a
  new dispatcher in `src/App.jsx`; data layer and admin tooling already existed.

### Admin

- **feat: Guided publishing additions** — 2026-06-11
  — `PipelineStepper.jsx` persistent Submit → Editor → Review → Published progress indicator;
  pre-publish validation checklist (hero image, body length, slug uniqueness, provider/type);
  calendar time-of-day picker with explicit timezone handling; "Auto-post to Social" checkbox at
  publish pre-fills SocialHub compose.
- **feat: New admin pages** — 2026-06-11
  — `ConnectionsPage.jsx` (Publer, Plaud, Sessionize, Credly, YouTube in one place; Sessionize
  speaker ID moved to admin settings via `src/lib/adminSettings.js`), Linkie hub,
  `MailingListPage.jsx` (Klaviyo), and `LabsPage.jsx` labs dashboard.

### Integrations

- **feat: New Cloud Functions** — 2026-06-11
  — `linkieProxy`, `klaviyoProxy`, `newsletterSubscribe`, and labs functions
  (`functions/labs-functions.js`).
  — Secrets now provisioned as of 2026-06-12: `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`,
  `KLAVIYO_LIST_ID`.
- **feat: Newsletter signup component** — 2026-06-11
  — `NewsletterSignup.jsx` mounted in the Footer and on blog posts.

### Labs Platform

- **feat: Hostinger VPS labs backend** — 2026-06-11
  — New `labs/vps-agent/` pull-based runner agent claiming jobs from a Firestore job queue (no
  inbound ports on the VPS), ephemeral sandboxed containers, per-lab command allowlists, quotas,
  and per-run audit docs. See `documentation/labs-platform-guide.md`.

### Removed

- **chore: Delete the obsolete `platform/ansible` VPS stack** — 2026-06-11
  — RabbitMQ, python-worker, k3s, kubeadm, ArgoCD roles and all related templates removed.
  — Replaced by the new pull-based labs platform; documentation referencing the old stack
  updated or marked superseded.

---

## 2026-05-27 — Delete archive/ folder

- **chore: Remove `archive/` directory after manual review** — 2026-05-27
  — Deleted all 26 archived docs and the `archive/` folder itself. Updated
  `documentation/architecture-folder-structure.md` to drop the archive section.
  — History is preserved in git; the folder no longer serves a current purpose.

---

## 2026-05-27 — Workspace cleanup and folder reference doc

- **chore: Untrack generated and local-only files under `scripts/`** — 2026-05-27
  — `git rm --cached` removed `scripts/smoke-routes-output.json`,
  `scripts/smoke-frameworks-output.json`, and `scripts/temp-check.yaml` from the index. Added
  `scripts/*-output.json` to `.gitignore` alongside the existing `scripts/temp-check.yaml` rule.
  — Generated smoke-script outputs and placeholder secrets files should never be tracked.

- **chore: Nest stray archive root files into `archive/docs/`** — 2026-05-27
  — `git mv` of `archive/CATCHUP.md`, `archive/code-review-owasp-wcag.md`, and
  `archive/code-review-owasp-wcag-checklist.md` into `archive/docs/`. `archive/` root now
  contains only `docs/`.
  — Single archival location matches the Phase 2 documentation convention.

- **chore: Remove empty `tests/` directory** — 2026-05-27
  — Deleted unused empty folder. Unit tests live in `src/` (Vitest); e2e tests live in `e2e/`
  (Playwright).
  — Eliminates stale scaffolding that suggested a test layout we don't use.

- **docs: Add folder-structure reference doc** — 2026-05-27
  — New `documentation/architecture-folder-structure.md` enumerates every top-level folder,
  hidden directory, and root file with responsibilities and links to deeper references.
  Linked from the documentation index under "Architecture & Backend".
  — Canonical answer to "where does X live?" after the multi-phase cleanup.

---

## 2026-05-27 — Documentation folder audit and reorganization

- **docs: Standardize 4 PascalCase docs to lowercase kebab-case** — 2026-05-27
  — Renamed via `git mv` (history preserved): `AI-Integration-Inventory.md` →
  `ai-integration-inventory.md`, `AI-Recommendations.md` → `ai-recommendations.md`,
  `Firebase-GCP-Cost-Inventory.md` → `firebase-gcp-cost-inventory.md`,
  `Frontend-Theming-Guide.md` → `frontend-theming-guide.md`.
  — Enforces the `<domain>-<topic>[-<detail>].md` naming convention across the documentation
  folder.

- **docs: Consolidate 6 duplicate docs into primaries (full detail preserved)** — 2026-05-27
  — Appended verbatim source content under `## Consolidated from <source>` section headers in
  the primary doc, then archived the originals. No summarization — every paragraph kept.
  Consolidations: `architecture-system-report.md` → `architecture-system-overview.md`;
  `frontend-firebase-deployment.md` → `process-handover-guide.md`;
  `frontend-stitch-mapping.md` → `frontend-stitch-integration.md`;
  `pipeline-deployment-checklist.md` → `pipeline-deployment-guide.md`;
  `secrets-folder-info.md` → `security-secrets-guide.md`;
  `secrets-frontend.md` → `security-secrets-guide.md`.
  — Removes parallel/duplicate docs that drift apart over time; primaries now hold the full
  detail surface.

- **docs: Archive 17 outdated, migration, and historical pre-launch docs** — 2026-05-27
  — Moved 17 files into `archive/docs/` via `git mv`.
  — **Group A (outdated / superseded, 8):** `ai-cover-deployment-checklist.md` (one-shot deploy
  checklist already executed), `admin-auth-architecture.md` (superseded by current admin auth
  guide), `admin-auth-setup.md` (superseded by current admin auth guide),
  `documentation-reorganization-plan.md` (this reorganization replaces it),
  `firebase-ai-cover-trigger.md` (one-shot trigger configured), `frontend-pages-implementation.md`
  (superseded by `frontend-pages-guide.md`), `pipeline-nodejs-upgrade.md` (Node 22 upgrade
  complete), `frontend-coming-soon-recovery.md` (recovery executed).
  — **Group B (completed migrations, 3):** `admin-auth-migration-guide.md`,
  `admin-rules-migration-plan.md`, `database-migration-runbook.md` — all migrations shipped.
  — **Group C (historical pre-launch audits, 6):** `accessibility-testing-manual.md`,
  `audit-pages-ux-comprehensive.md`, `review-critical-analysis.md`, `review-workflow-audit.md`,
  `security-workflow-audit.md`, `testing-visual-regression.md` — point-in-time audits whose
  findings have been addressed and incorporated into active guides.

- **docs: Rewrite documentation/README.md as domain-grouped index** — 2026-05-27
  — Replaced ad-hoc list with sections: Getting Started, Frontend & Design, Architecture &
  Backend, Database & Storage, AI & Automation, Security & Secrets, Pipelines & DevOps, Testing
  & Quality, Planning & Process, Integrations, Live Smoke Tests, Reports, Archive. Reflects
  renamed files, consolidations, and pointers to `archive/docs/` for archived items.
  — Single discoverable index for the now-current documentation stack.

- **docs: Expand TODO Key Supporting Docs and add 2 evaluation items** — 2026-05-27
  — Replaced TODO.md's short Key Supporting Docs list with the full domain-grouped stack
  matching `documentation/README.md`. Added two new Pending Work items with research-backed
  value assessments: (2) `database-model-roadmap` Phase A scheduling decision, and (3)
  `pipeline-scraping-upgrade` headless deployment cost/benefit evaluation.
  — Surfaces every active doc from the root tracker and converts two "future state" docs into
  reviewable decisions instead of letting them rot.

---

## 2026-05-27 — OWASP / WCAG remediation + repo hygiene

- **chore(docs): Archive completed root-level review docs** (`ea4b23c1`) — 2026-05-27
  — Moved `CATCHUP.md`, `code-review-owasp-wcag.md`, and `code-review-owasp-wcag-checklist.md` into
  `archive/` via `git mv`, deleted transient `.tmp-dev-*.log` and `firestore-debug.log` from root.
  — Root markdown policy keeps only `README.md` and `TODO.md`; the OWASP/WCAG review is now
  complete so the working docs no longer belong in root.

- **style(frontend): Adopt tailwind v4 canonical classes in header** (`8dce62b4`) — 2026-05-27
  — Replaced arbitrary-value Tailwind utilities in `src/components/shared/Header.jsx` with v4
  shorthand (`max-w-400`, `w-60`, `min-w-50`, `z-100`, `shrink-0`, `w-42.5`, `min-w-20`, `w-41`,
  and `text-(--var)` for CSS-variable color tokens).
  — Cleared 22 canonical-class linter warnings; pure refactor with no behavior change.

- **docs: Mark owasp wcag review items complete** (`756122ef`) — 2026-05-27
  — Updated `CATCHUP.md` to check off every reviewed-backlog and follow-up item.
  — Reflects that all 10 OWASP/WCAG remediation commits have landed.

- **feat(frontend): Add header a11y landmarks skip link and menu semantics** (`8f6b7717`) — 2026-05-27
  — Wired `SkipToMainContent` into `Header.jsx`, labeled Primary/Secondary/Mobile nav landmarks,
  added `role="menu"`/`role="menuitem"` to the Tools dropdown with Escape-key close and focus
  return, and exposed `aria-expanded`/`aria-controls` on the mobile menu toggle.
  — Closes WCAG-1, WCAG-2, WCAG-3, and WCAG-6 from the audit.

- **fix(auth): Hide admin link from non-admin users** (`f0bcf109`) — 2026-05-27
  — Gated the `/admin` link in `Header.jsx` behind `useAdminAuth().isAdmin`.
  — Closes OWASP-5; prevents enumerating admin surface area for unauthenticated visitors.

- **feat(frontend): Add main-content landmark for skip link** (`80c9e58c`) — 2026-05-27
  — Added `id="main-content"` and `tabIndex={-1}` to the main landmark in `App.jsx`.
  — Required target for the WCAG-1 skip-to-content link.

- **fix(frontend): Parse iso speaking-event dates without timezone drift** (`eeb1a447`) — 2026-05-27
  — Normalized ISO date parsing in `CustomSessionizeWidget.jsx` and `SpeakingEventsPage.jsx` so
  saved values and the public display land on the same day.
  — Fixes an off-by-one-day rendering bug caused by implicit UTC parsing.

- **feat(frontend): Announce toast notifications with aria-live** (`19a65604`) — 2026-05-27
  — Added `aria-live="polite"` and `aria-atomic="true"` to the toast viewport in `toaster.jsx`.
  — Closes WCAG-7; screen readers now announce transient notifications.

- **fix(frontend): Keep helper text in aria-describedby when error present** (`ea753571`) — 2026-05-27
  — Combined helper and error ids in `aria-describedby` in `AccessibleForm.tsx` instead of
  replacing helper with error.
  — Closes WCAG-4; preserves context for assistive tech when validation fails.

- **fix(auth): Key admin status cache by uid** (`93a5ca8c`) — 2026-05-27
  — Replaced module-level admin-claim cache with a UID-keyed cache in `useAdminAuth.js`.
  — Closes OWASP-6; prevents one user's admin verdict from leaking to a different signed-in user.

- **fix(frontend): Externalize theme bootstrap and drop unsafe-inline csp** (`17616634`) — 2026-05-27
  — Moved the pre-paint theme script to `public/theme-init.js`, referenced it from `index.html`,
  and removed `'unsafe-inline'` from `script-src` in `firebase.json`.
  — Closes OWASP-3; tightens CSP against future inline-script XSS vectors.

- **fix(backend): Harden rss endpoints with tls and admin auth** (`63e72550`) — 2026-05-27
  — Replaced the silent `rejectUnauthorized: false` TLS fallback with a skip-and-log path in
  `functions/index.js`, and added `requireAdminClaims('editor')` to the manual RSS fetch and
  reviewer-digest HTTP endpoints.
  — Closes OWASP-2 and OWASP-4; eliminates MITM exposure on the retry path and rate-limits abuse
  by gating expensive endpoints behind admin claims.

---

## 2026-05-26 — AI Audit Stage 7 post-deploy validation

- **Validation: Regenerate 5 article covers with `imagen-4-fast`** — 2026-05-26
  — Triggered `altCoverImageTrigger=true` on `published_blog` docs `91IWYgpR31RjXmVD38Ba`,
  `IVrBFJ6yGAfCHBFT1dZM`, `LSzyB6gbiLyXtjQUcgGv`, `Ttt3Hv8d0gtcso4OQAVf`, `ibDYCON0ulcHmi55s1CK`;
  ~$0.20 total (5 × $0.04 `google/imagen-4-fast`). Two hotfixes required: (1) Replicate SDK 1.4.0
  default `useFileOutput:true` returned `FileOutput` objects that, when passed to `https.get()`,
  produced `ECONNREFUSED 127.0.0.1:443` — set `useFileOutput:false` in `callReplicateApi`;
  (2) Added missing `const historyUpdates = {}` declaration in `generateAiCoverOnContentTrigger`
  (was referenced but never initialized, causing `historyUpdates is not defined` ReferenceError).
  All 5 docs now serve fresh PNG+WebP at `covers/{contentId}-ai-hero.png`.
  — Verifies that the deferred publish-time cover pipeline (R1) and the Imagen-4-fast default
  produce acceptable output at the new lower price point.

- **Validation: Metadata-only ingest mode** — 2026-05-26
  — Ingested `content/stage7-metadata-test-1779829734414` with `CONTENTFORGE_METADATA_ONLY=true`,
  confirmed no `postContent` field written; then triggered `generatePostContent` HTTP function and
  confirmed field written. Required fixes to `buildInspectionUpdateData` undefined handling and
  JSON-repair fallback in AI router.
  — Verifies R8 (decouple draft body generation from ingest) works end-to-end on demand.

- **Validation: Auto alt-text on ingest** — 2026-05-26
  — Ingested `content/stage7-alttext-test-1779834434558` with
  `CONTENTFORGE_ALT_TEXT_ENABLED=true`; 4 alt-texts written via Vertex `gemini-2.5-flash`
  multimodal. Hotfix: `generateTextResponse` was used in `generateAltTexts` but missing from the
  destructured `require('./lib/ai-model-router')` in `functions/index.js` — added to import and
  redeployed `inspectAndPopulateContent`.
  — Verifies G5 (`imageAltTexts` map persisted to content doc) before exposing the feature
  publicly.

- **Validation: Token usage logging** — 2026-05-26
  — `gcloud logging read` in `hybridcloudworks-61e8d` showed multiple `[ai-model] vertex token
  usage` entries after 24h traffic with `CONTENTFORGE_LOG_TOKEN_USAGE=true`.
  — Confirms R9 instrumentation lands in Cloud Logging for future per-provider cost dashboards.

- **Set Firebase Functions config env vars for model selection** — 2026-05-26
  — Persisted `CONTENTFORGE_VERTEX_MULTIMODAL_MODEL=gemini-2.5-pro` (G3) and
  `CONTENTFORGE_VERTEX_DRAFT_MODEL=gemini-2.5-flash` (G4) in `functions/.env`; deployed to
  `inspectAndPopulateContent`, `generatePostContent`, and `generateAiCoverOnContentTrigger`.
  — Routes reasoning workloads to `gemini-2.5-pro` and cheap drafts to `gemini-2.5-flash` per the
  audit's recommended tiering.

- **chore(secrets): Secret Manager migration for AI provider keys** (`41ca2add`) — 2026-05-26
  — Wired `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`,
  `REPLICATE_API_KEY`, `FIRECRAWL_API_KEY` via `defineSecret`; stripped plaintext from
  `functions/.env`. Verified all 8 Cloud Run services use `valueFrom.secretKeyRef`. Alt-text path
  re-verified on `content/stage7-alttext-test-1779843199713`.
  — Eliminates plaintext API keys from `.env`/Cloud Run metadata; centralizes rotation. Residual
  plaintext on historical Cloud Run revisions mitigated by provider-side rotation (the May 27
  `ebf91cfd` commit).

- **fix(functions): Dedupe duplicate `exports.syncMcpTools`** (`00482c8e`) — 2026-05-26
  — Kept canonical OAuth-aware export supporting both `apiKeyEnvVar` (Bearer) and `oauthToken`
  modes; removed the older duplicate.
  — Conflicting exports in `functions/index.js` were preventing predictable selection at deploy
  time.

---

## 2026-05-11 — AI cost & capability audit (7 stages) + Firebase/GCP cost audit

- **AI Cost & Capability Audit — Stages 1–7 complete** (`8376be1`, `305e473`) — 2026-05-11
  — Stages 1–6 produced the full inventory, cost math, gap analysis, caching audit, and 17-item
  Tier 1–4 recommendations table. Stage 7 shipped every approved item: R1 deferred Imagen-4 to
  publish time (`cbf9b81`), R2/G1/R10 added image-model env vars defaulting to
  `google/imagen-4-fast`, R3 deleted the deprecated `scripts/generate-ai-covers.js`, R4/R6
  refreshed router defaults (`claude-sonnet-4-6`/`claude-haiku-4-5`/`gpt-5-mini`/`gpt-5-nano`),
  R5 threaded `systemPrompt` through the router and wired Anthropic `cache_control` to the
  ≥1,024-token extracted prompts, R8 introduced `CONTENTFORGE_METADATA_ONLY` plus the new
  `generatePostContent` HTTP function, R9 added token-usage logging behind a flag, G2 added the
  `gpt-image-1` fallback path, and G5 added flagged auto alt-text generation. G3/G4 reduced to
  env-var-only swaps; G6/G7/G8/R7 (TTS, embeddings, flux-schnell) deferred.
  — Imagen-4 was firing on every ingest (94 URLs/day × $0.04 ≈ $113/mo, 72% of AI spend); R1 + R2
  cuts image spend ~80% and the rest of the bundle modernizes models, adds caching, and unblocks
  alt-text + on-demand draft generation.

- **AI Audit Stage 7 R1 — Defer Imagen-4 to publish time** (`cbf9b81`) — 2026-05-11
  — `buildInspectionUpdateData` no longer auto-fires `altCoverImageTrigger`; new
  `applyPublishTimeCoverTrigger` helper in `publishNewBlog` sets the trigger only when content
  transitions to `published_blog` without a cover. Preserved two explicit opt-ins
  (`generateAiCoverOnInspect=true` and legacy `skipImageGeneration`) for the regenerate-during-
  review workflow.
  — Largest single AI saver in the audit; 60–80% expected reduction in Imagen-4 spend.

- **Firebase / GCP Cost Audit — F1–F12 closed** — 2026-05-11
  — F1 (`7864a08`) replaced 4 admin full-collection scans with bounded queries + `count()` aggs +
  a maintained `dashboard_stats/v1` summary doc updated via `FieldValue.increment` triggers (added
  2 composite indexes); cuts $7→<$1/mo at 1K docs and $72→<$5/mo at 10K. F2+F3 (`1d48afe`)
  deferred `archiveScrapedImages` to publish time and added a 90-day Cloud Storage lifecycle rule
  in `platform/firebase/storage-lifecycle.json`. F4 (`91f773a`) switched `/about` certifications
  and `CustomSessionizeWidget` from live Firestore to build-time JSON snapshots
  (`scripts/generate-public-data.cjs`). F5 (`b12adb8`) replaced full-payload `[ai-model]` logs
  with metadata fingerprints (~5KB/ingest saved). F6 (`7b9bba0`) removed dead duplicate `blogs/`
  triggers (`inspectAndPopulateArticle`, `generateAiCoverOnTrigger`), decommissioned via
  `functions:delete`, and archived 10 legacy dev scripts. F7 (`e4dfcb8`) dropped
  `inspectAndPopulateContent` memory 1GiB→512MiB. F8 (`5bb6791`) trimmed scheduler cadence
  (`cleanupSoftDeletedContent` 1h→4h, `monitorPublishingPipeline` 1h→6h) and skipped empty-run
  heartbeats; ~140→10 scheduled invocations/day. F9 (`1af9321`) added a 640w/1280w/2048w WebP
  responsive variant pipeline + `<ResponsiveCoverImage>`. F10 (`58e9f27`) split `vendor-firebase`
  by sub-package (public chunk 456→340 KB, ~35 KB gzip saved/visit; Auth/Storage now lazy via
  `@/lib/firebaseStorage`). F11 confirmed `us-central1` indefinitely (<20% non-US audience). F12
  enabled BigQuery billing export and a $250 monthly budget with 20/40/60/80/100% alerts.
  — Largest single Firebase saver was F1; the bundle pulls the project from $80–120/mo at scale
  to <$15/mo at 10K docs and adds a budget tripwire for any regression.

---

## 2026-05-10 — Dependency upgrades, GitHub issues, theming + queue hardening

- **Dependency upgrades — React 19 + Vite 8 + Tailwind 4 + react-router 7** — 2026-05-10
  — Closed all 13 outstanding dependency PRs (8 merged + 5 superseded by bundled commits). PR #172
  consolidated 9 safe minor/patch bumps (firebase 12.12.1, react-hook-form 7.74, vitest 4.1.5,
  @playwright/test 1.59.1, axios 1.15.2, sharp 0.34.5, etc.); PR #173 bumped firebase-tools
  15.15→15.16; workflow bumps for azure/setup-helm 1→3.5, actions/setup-java 4→5.2,
  actions/github-script 7→9, actions/upload-artifact 4→7; PR #160 brought replicate 0.34→1.4
  (required `useFileOutput:false` compat shim in `cms-functions.js:generateImageByPrompt`);
  PR #169 react-zoom-pan-pinch 3→4; commit `29ae4ba` shipped @vitejs/plugin-react 5→6 + Vite 7→8 +
  esbuild devDep; commit `990c963` shipped react-router-dom 6→7 with v7 future flags; commit
  `a092ffc` shipped react 18→19 (codebase already R19-ready); commits `fbfb8fc` shipped Tailwind
  3→4 + tailwind-merge 1→3 — migrated `tailwind.config.js` to CSS `@theme inline` blocks, replaced
  `tailwindcss-animate` with `tw-animate-css`, bumped `react-helmet-async` 2→3. Build time ~4× via
  Oxide engine.
  — Brings the stack to current majors, unblocks v4 canonical classes, and resolves all open
  dependency PRs. `@theme inline` was critical to preserve the provider-theme cascade — without it
  `bg-primary` baked white at parse time instead of resolving Azure blue under `.theme-azure`.

- **GitHub issues closed — #171, #174, #147, #175** — 2026-05-10
  — #171: restored `lighthouse:recommended` preset, contrast 86→0, heading order fixed on
  AWS/Azure/Terraform, SEO meta-description fallback in `index.html`, source maps `hidden`,
  console-error e2e guardrail, bundle split into 7 named chunks (−120 KB main vendor);
  suppressions documented in `.lighthouserc.json` `_comment_*` fields. #174: Azure-edu hover
  contrast fixed by scoping `.theme-{provider} a` default-color rules to exclude button-styled
  `<a>` elements across azure/aws/github/finops. #147: jsx-eslint MetaProperty noise resolved by
  hoisting `import.meta.env.VITE_SOCIAL_*_URL` reads in `Footer.jsx` to module-scope `const`s.
  #175: 43 lint warnings cleared via inline-style→named-CSS refactor and 24 complexity refactors +
  7 mechanical fixes in `functions/`; lint scope extended to `functions/`, verified
  `npm run lint -- --max-warnings=0` exit 0 across `src/` + `functions/`.
  — Brings the issue tracker to zero open dependency/lint/lighthouse defects ahead of the OWASP/
  WCAG sweep.

- **Theming, light/dark failsafe pipeline & queue hardening** — 2026-05-10
  — Removed hardcoded `class="dark"` from `index.html:2` and added a pre-paint theme bootstrap
  script (later externalized in `17616634`). Consolidated theme toggles to the single floating
  bottom-right button. `ThemeContext` now tracks OS preference and defaults to
  `prefers-color-scheme`. Lifted dark `--muted-foreground` L60→L80% (contrast 4.6:1→10:1, affects
  384 occurrences of `text-muted-foreground`). Per-page contrast sweeps across
  Footer/Header/Rosetta Stone badges/Contact submit/Azure-edu hover buttons. Built a three-layer
  failsafe: ESLint `no-restricted-syntax` + `scripts/axe-theme-scan.mjs` Playwright crawl + e2e
  contrast spec blocking merges (documented in `Frontend-Theming-Guide.md`). Queue persistence
  forensic investigation traced the "175→104 articles" loss to a daily 04:00 CT hard-delete cron
  + Delete-Rejected-Now button with no age filter; converted `deleteRejectedContentBatch` to
  soft-delete and extended the reaper grace from 24h→7d (~8-day recoverable window). Added audit
  logging to all destructive cron paths via `buildSystemAuditLogData`. Extended `ConfirmModal`
  with a `preview` prop (bulk-reject renders top-10). Added per-card decay countdown badges in
  `QueuePage.jsx`, disambiguated the `Needs Review` filter, added URL-persisted sort controls.
  Consolidated dedup pipeline (URL + canonical + normalized title within a 7-day window) into a
  shared `findDuplicateContent` helper across all 3 ingestion paths.
  — Light mode regressions, contrast failures, and silent queue-data loss were the top three
  reliability/UX risks before launch; this work closes all three and adds CI guardrails so they
  don't regress.

---

## 2026-04-29 — Security, performance, dependency hardening + CI hygiene

- **PR #150 — Performance hardening** — 2026-04-29
  — Resource hints in `index.html`, `font-display:swap`, IBM Plex Mono self-hosted, ghost deps
  removed, FrameworkRadar lazy-loaded, Lighthouse coverage expanded to 9 routes.
  — Pre-launch performance baseline for Core Web Vitals.

- **PR #149 — Security hardening** — 2026-04-29
  — Added 6 HTTP security headers in `firebase.json`; Storage catch-all locked to `if false`;
  Firestore social/wiki collections restricted to `isAdmin()`; `scan-security.yml` blocks on
  CRITICAL/HIGH; GitHub Action versions pinned by digest.
  — Closes the open-by-default surface area before launch and prevents silent action-version
  drift.

- **PR #148 — Dependency hardening** — 2026-04-29
  — Added Dependabot config across 3 ecosystems, annotated npm overrides with CVE
  justifications, added SBOM generation to `scan-security.yml`.
  — Establishes the dependency-update cadence and produces an auditable SBOM artifact.

- **CI/CD workflow hygiene** — 2026-04-29
  — Deleted `check-comprehensive.yml` (redundant with `check-quality` + `check-e2e`). Added
  concurrency groups to all PR check workflows. Decoupled Lighthouse from deploy
  (`deploy-frontend.yml` 20+min → 2–3 min). `check-quality.yml` switched from full build+tests to
  `npm run test:admin` only. Path-filtered `scan-security.yml`.
  — Cuts PR feedback latency and removes a duplicate workflow that was double-billing minutes.

---

## Historical — Admin portal, editor, route factory, lifecycle baseline

- **Admin Portal Performance** — historical
  — Replaced full-collection reads with summary doc + targeted queries on Dashboard, Published,
  Queue, Publish, OpsHealth pages; ImageGallery 500-record fetch converted to incremental loading.
  — Original Firestore-cost regression that motivated the F1 work above.

- **Editor Delivery** — historical
  — Wider article layout in `BlogDetailTemplate`; inline body modules (fact, recommendation,
  links, picture, spacer); drag-and-drop module ordering; byline control; spacer style presets.
  — Enables the inline-module authoring model the editorial pipeline now depends on.

- **Admin Reliability** — historical
  — Extracted `BlogReviewBoard` from the `ReviewPage` monolith; removed dead multi-target publish
  stubs; removed legacy `blogs` fallback from `EditorPage`; wired audit logging into mutation
  flows; surfaced save/publish errors; hardened `api.js` (URL validation, timeout/retry);
  `firebaseConfig.js` fails fast on missing env vars.
  — Closes the most common admin-side failure modes (silent saves, env drift, monolithic page
  blowups).

- **Route & UX standardization** — historical
  — Introduced `src/lib/routeFactory.ts`; header navigation uses provider-aware route generation;
  CI route-validation script; routing guide added to `documentation/`.
  — Single source of truth for routes, preventing the provider/route mismatch class of bug.

- **Live publishing & editorial verification** — historical
  — Prod smoke test passed; Azure published content resolves to the wide article detail layout
  (`1136px` desktop); byline read-order corrected (`siteAuthor` > `publishedByName` >
  `createdByName`); inline module pipeline and drag-and-drop ordering verified end-to-end.
  — Demonstrated the editorial pipeline works in production before opening it to non-author
  contributors.

- **Codebase cleanup baseline** — historical
  — Lint clean across `src/` + `functions/`; PR quality gate enforces zero warnings; provider
  route/page contract validated in CI.
  — Becomes the zero-warning baseline that subsequent OWASP/WCAG/Tailwind-v4 work builds on.

- **Lifecycle, abstraction & migration baselines** — historical
  — Framework + architecture editorial pipeline delivered across review/detail/submission flows;
  public visibility rules standardized for published content; content lifecycle contract
  consolidated; AI model abstraction, deployment readiness validation, and data-model migration
  planning documented. Core Stage 2 frontend delivery reached production-ready baseline. _Stages 3
  & 4 (backend infra, integration/load testing, automation, FinOps shift-left) descoped May 10,
  2026._
  — Establishes the architectural baseline referenced throughout the AI and Firebase cost audits.
