# Firebase / GCP Cost Inventory & Recommendations

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** May 10, 2026 **Status:** Stage 1 + Stage 2 complete. Same procedure as the AI
Review (see [AI-Integration-Inventory.md](../archive/ai-integration-inventory.md)). **Scope:** Every Firebase /
GCP touchpoint that bills usage. Goal: shed cost before Azure migration. Project:
`hybridcloudworks-61e8d`, region `us-central1`, Cloud Functions v2, Node 22. **Approval gate:** No
infrastructure / cost changes ship until each item is approved individually, same rules as the AI
review.

---

## 1. Cost surface — what bills

Firebase / GCP charges for, in rough order of likely spend on this project:

1. **Cloud Functions invocations + GB-seconds + outbound networking** — every Firestore-trigger
   call, scheduler tick, and admin HTTP endpoint
2. **Firestore reads / writes / deletes / storage** — admin dashboard queries, Firestore triggers,
   public site reads
3. **Cloud Storage GB-month + egress** — every scraped image, every Imagen-4 cover, every AI preview
4. **Firebase Hosting bandwidth** — public site visitors
5. **Cloud Scheduler jobs** — flat $0.10/job/month for each schedule
6. **Cloud Logging ingestion** — every `logger.info` past the free tier costs ~$0.50/GiB
7. **Auth** — free at this scale
8. **Vertex AI** — covered separately in the AI inventory

---

## 2. Cloud Functions inventory

### 2.1 Schedulers (auto-fire, billed every tick + execution time)

| Export                      | Schedule                | Region      | Memory           | Timeout       | Notes                                             |
| --------------------------- | ----------------------- | ----------- | ---------------- | ------------- | ------------------------------------------------- |
| `fetchRssFeeds`             | every 2 hours           | us-central1 | 512MiB           | 300s          | RSS poll → ingestion fan-out                      |
| `fetchPodcastFeeds`         | every 2 hours           | us-central1 | (default 256MiB) | (default 60s) | No explicit config — using defaults               |
| `fetchBlogListings`         | every 6 hours           | us-central1 | 512MiB           | 540s          | Firecrawl-backed                                  |
| `scrapeSkillsHubRss`        | weekly Friday 09:00 UTC | us-central1 | (default)        | 120s          | Low frequency                                     |
| `generateReviewerDigest`    | daily 07:00 CT          | us-central1 | 256MiB           | 180s          | One email digest                                  |
| `cleanupRejectedContent`    | daily 04:00 CT          | us-central1 | 256MiB           | 540s          | Soft-delete now (was hard-delete pre-May 10 2026) |
| `cleanupSoftDeletedContent` | every hour              | us-central1 | 256MiB           | 540s          | Reaper (7-day grace)                              |
| `publishScheduledContent`   | every 15 min            | us-central1 | 512MiB           | 540s          | Scheduled-publish queue                           |
| `monitorPublishingPipeline` | every hour              | us-central1 | 256MiB           | 240s          | Pipeline-health metrics                           |

**9 schedulers × $0.10/mo flat = ~$0.90/mo for the jobs themselves.** The execution costs depend on
duration × invocations.

**Key issue:** `cleanupSoftDeletedContent` runs every hour and `monitorPublishingPipeline` runs
every hour — overlapping ops cadence. `publishScheduledContent` runs every 15 min even when there's
nothing scheduled (we just saw the no-op path writes a digest doc on every empty run). Pre-launch
with little traffic, this is meaningful background spend.

### 2.2 Firestore triggers (`onDocumentWritten`, fire on every write)

| Export                            | Document                  | Region      | Memory           | Timeout       |
| --------------------------------- | ------------------------- | ----------- | ---------------- | ------------- |
| `downloadSpeakerEventImage`       | `speakerevents/{eventId}` | us-central1 | (default 256MiB) | (default 60s) |
| `downloadCertBadgeImage`          | `certifications/{certId}` | us-central1 | (default)        | (default)     |
| `downloadBlogCoverImage`          | `blogs/{blogId}`          | us-central1 | (default)        | (default)     |
| `generateBlogCoverImage`          | `blogs/{blogId}`          | us-central1 | 512MiB           | (default)     |
| `inspectAndPopulateArticle`       | `blogs/{blogId}`          | us-central1 | **1GiB**         | 180s          |
| `inspectAndPopulateContent`       | `content/{contentId}`     | us-central1 | **1GiB**         | 180s          |
| `generateAiCoverOnTrigger`        | `blogs/{blogId}`          | us-central1 | 512MiB           | 120s+         |
| `generateAiCoverOnContentTrigger` | `content/{contentId}`     | us-central1 | 512MiB           | 120s+         |
| `createSlugPageOnTrigger`         | (TBD)                     | us-central1 | (default)        | (default)     |

**Key issue:** **Two pairs of overlapping triggers** — `inspectAndPopulateArticle` (blogs
collection) AND `inspectAndPopulateContent` (content collection) do the same job at 1GiB each. Same
with `generateAiCoverOnTrigger` AND `generateAiCoverOnContentTrigger`. If both collections still
receive writes, every ingest pays double. The `blogs` collection is legacy (TODO.md notes the
`blogs` fallback was removed from EditorPage in March 2026); the trigger may be dead weight.

### 2.3 HTTP endpoints (`onRequest`, billed per invocation)

40+ admin endpoints, almost all `region: us-central1`, `timeoutSeconds: 60`, `memory: 256MiB`.
Notable outliers:

- `generateArticleDraft` — 512MiB, 120s
- `generatePreviewImages` — 512MiB, 180s
- `getAdminDashboardSnapshot` — **512MiB**
- `batchInspect` — 300s
- `publishContentToBlogs` — 120s
- `generateCuratedArticleImage` — 512MiB, 120s
- `aiStackReadiness` — 256MiB, 60s

The 512MiB allocations are reasonable where AI/image work happens. The dashboard snapshot at 512MiB
is concerning given it's a read-only admin endpoint (see §3).

---

## 3. Firestore inventory

### 3.1 Server-side: full-collection scans on admin endpoints

This is the **biggest finding in the audit.**

[`functions/cms-functions.js:2118-2120`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L2118):

```js
function getAdminContentSnapshotQuery(db) {
  return db.collection('content').select(...ADMIN_CONTENT_SNAPSHOT_FIELDS);
}
```

**No limit. No where clause. Reads every doc in the `content` collection on every call.**
`.select()` only narrows field projection — Firestore still bills 1 read per document scanned
(Firestore charges per document, not per byte).

**Called by 4 separate admin endpoints:**

- `getAdminDashboardSnapshot` ([cms-functions.js:4044](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4044))
- `getQueueSnapshot` ([cms-functions.js:4221](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4221))
- `getPublishSnapshot` ([cms-functions.js:4263](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4263))
- `getOpsHealthSnapshot` ([cms-functions.js:4313](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4313))

**Impact:** every admin page load triggers up to **4 full-collection reads**. At 1000 docs in
`content`, one admin session loading dashboard + queue + publish + ops-health = **4000 document
reads**. Firestore bills $0.06 per 100K reads, so 100 admin sessions/day × 4000 reads = 12M
reads/month = **~$7/mo at 1000 docs, ~$72/mo at 10K docs**.

**Why this exists:** filtering and sorting happen in JS after the read
(`.filter(matchesQueueStatus).sort(...).slice(0, 10)`). Convenient to write but expensive to run.

The TODO.md note "DashboardPage broad content dataset read replaced ✅ with stats-doc +
limited-query model" was a **client-side** fix only — the client now calls
`getAdminDashboardSnapshot`, but the server-side handler still does the full scan. **Remediation is
incomplete.**

### 3.2 Client-side reads (public + admin)

| Surface                                                                                                     | Pattern                                                                                                                                  | Cost note                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Public `/about` page                                                                                        | `getDocs(collection(db, 'certifications'))` ([AboutPage.jsx:279](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx#L279))                                | Unbounded. Every visitor pays per-cert reads. Should be a static JSON or stats-doc.                    |
| `CustomSessionizeWidget`                                                                                    | `getDocs(collection(db, 'speakerevents'))` ([CustomSessionizeWidget.jsx:335](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/components/widgets/CustomSessionizeWidget.jsx#L335)) | Unbounded. Same pattern.                                                                               |
| Admin `useImagePrompts` hook                                                                                | Reads `image_prompts`, `image_prompts/{id}/sets`, `image_prompt_sets`, then loops `getDocs` per legacy page                              | Multiplies reads N-fold per admin gallery view                                                         |
| Admin `imageGallery.js`                                                                                     | `limit(max)` set ✅                                                                                                                      | Properly bounded                                                                                       |
| Editor `useEditorState`                                                                                     | `onSnapshot(doc)` ✅                                                                                                                     | Single-doc listen, fine                                                                                |
| Generic `useFirestore`                                                                                      | `onSnapshot(doc)`, `getDocs(query)`                                                                                                      | Wrapper, fine                                                                                          |
| Admin pages (`CoderCornerPage`, `FrameworksPage`, `EditorListPage`, `SpeakingEventsPage`, `SubmitUrlsPage`) | Various `getDocs(collection(db, 'content'))` with constraints                                                                            | Mostly OK — but admin still pays Firestore reads on top of the server-side full-collection scans above |

**Public-page issue:** the public site reads Firestore directly for `/about` and the speaker widget.
Every anonymous visitor incurs reads. At launch with even mild traffic this becomes the largest read
bill. These should be cached static JSON in `dist/` or generated at build time.

### 3.3 Firestore triggers — the draft-time write amplification

Same bug class as the AI Review:

- **`archiveScrapedImages`** ([index.js:1587](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1587)) — fires on every URL
  ingest. Downloads up to **10 images** per article into Cloud Storage. **Most ingested URLs never
  publish.** Every draft pays:
  - 10× outbound HTTP fetches (egress on the source side, ingress free)
  - 10× Cloud Storage writes (Class-A operations: $0.05 per 10K)
  - 10× Cloud Storage GB-month forever (until manually cleaned)

- **`scraped.markdown.substring(0, 50000)` + `contentHtml.substring(0, 100000)` +
  `contentPlainText.substring(0, 50000)`** ([index.js:1667-1669](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1667)) —
  every ingested article writes up to **200KB of redundant text** (markdown + HTML + plaintext) into
  Firestore. Firestore charges $0.18/GiB-month for storage. At 1000 ingested URLs = ~200MB =
  ~$0.04/mo storage. At 10K = $0.40/mo. The cost grows linearly and storing the same content three
  ways is the question.

- **Imagen-4 covers** — already covered in the AI Review (R1 fixes this).

### 3.4 Indexes

Composite indexes look reasonable (12 total in
[`firestore.indexes.json`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/platform/firebase/firestore.indexes.json)). Indexes are free; no
concern there.

---

## 4. Cloud Storage inventory

| Path                                        | Source                                     | Cleanup?       |
| ------------------------------------------- | ------------------------------------------ | -------------- |
| `blogs/{blogId}/images/scraped-{i}.{ext}`   | `archiveScrapedImages` (every ingest)      | None automatic |
| `blogs/{blogId}/images/generated-cover.png` | `generateBlogCoverImage` (SVG fallback)    | None automatic |
| `blogs/{blogId}/images/cover-{i}.png`       | `downloadBlogCoverImage`                   | None automatic |
| `blogs/{blogId}/...`                        | Imagen-4 covers (`uploadAiCoverToStorage`) | None automatic |
| `covers/{filename}`                         | `uploadGeneratedImage` (preview/curated)   | None automatic |
| `speakerevents/{eventId}/images/...`        | `downloadSpeakerEventImage`                | None automatic |
| `certifications/{certId}/images/...`        | `downloadCertBadgeImage`                   | None automatic |

**Key issue:** **no Storage lifecycle rules**. Imagen-4 covers (~$0.04 to generate) consume 2K PNGs
≈ 2-5 MB each. At 100 rejected drafts × 5 MB = 500 MB sitting forever. Cloud Storage bills
$0.020/GB-month standard, $0.010/GB-month for Nearline. A bucket lifecycle rule (e.g. delete files
in `blogs/*/images/` whose parent doc is `rejected` after 30 days) would shed this.

There is no Sharp resize / WebP conversion on the upload path. Imagen-4 PNGs are stored at full 2K
resolution. The hosting CDN (`firebasestorage.googleapis.com`) doesn't auto-resize — every public
site visitor downloads the full 2K PNG even when the browser wants a 400px thumbnail. **Bandwidth
waste on egress.**

---

## 5. Hosting & Auth

### Hosting

[`firebase.json`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/firebase.json):

- `dist` directory hosted with proper `Cache-Control: max-age=31536000` for `.js`, `.css`, images
- HTML uses `no-cache, no-store, must-revalidate` (correct for SPA shell)
- Headers fully configured: HSTS, CSP, X-Frame-Options, etc. (April 29 hardening per TODO.md)

✅ Hosting config is well-tuned. The bandwidth cost depends on traffic; pre-launch this is small.
Two improvements:

- The `dist/assets/vendor-firebase-*.js` chunk is **456 KB / 141 KB gzip** — every visitor downloads
  the full Firebase SDK even though most public pages don't need Auth, Functions, Storage. Could
  split lazy.
- Self-hosted IBM Plex Mono fonts include Vietnamese + Cyrillic + Latin extensions. If only Latin is
  used, ~50 KB of font weight is unused per visitor.

### Auth

Free at this scale. No concern.

---

## 6. Cloud Logging

`logger.info` is called liberally throughout `functions/` (200+ call sites). At GCP free tier (50
GiB/mo) this is fine pre-launch, but `logger.info` calls inside loops or fired-per-request handlers
will eat into it post-launch.

Two specific paths log heavily:

- `[generateAiCover] Prompt: ${prompt.substring(0, 120)}...` and per-target generation logs (~5
  lines per cover)
- `[ai-model] Sending article analysis request via ${aiProvider}` +
  `✅ Analysis complete: ${JSON.stringify(metadata, null, 2)}`
  ([index.js:1513](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1513)) — **dumps the full AI response JSON to logs.** This
  includes the 1000-word `postContent` field. At 5KB per response × every ingest, this is a
  meaningful logging-ingestion cost ($0.50/GiB beyond free tier).

---

## 7. Stage 2 — Recommendations table

Same Tier-1-through-4 framing as the AI Review. Cost estimates are pre-launch baseline; numbers grow
~10× post-launch.

| ID      | Tier | Type                   | Recommendation                                                                                                                                                                                                                                                                                                          | Files                                                                                                                                                                                                                                                                         | Est. monthly impact                                                                                                                                                               | Risk                                                                                                   | Rollback                               |
| ------- | ---- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **F1**  | 1    | Anti-pattern           | Replace 4 server-side full-collection scans with proper bounded queries + summary docs. Most can be: dashboard pulls a `dashboard_stats` doc + a `where('contentStatus', '==', 'needs_review').limit(20)` for recent items. Queue/Publish/OpsHealth get specific filtered queries instead of full scans + JS filtering. | [`functions/cms-functions.js:2118-2120`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L2118), [`:4044`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4044), [`:4221`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4221), [`:4263`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4263), [`:4313`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L4313) | At 1000 docs: ~$7/mo → <$1/mo. At 10K: ~$72/mo → <$5/mo. **Largest Firebase saver in the audit.**                                                                                 | Medium — needs new composite indexes + a stats-doc maintenance trigger; admin-portal smoke testing.    | Behind feature flag; revert single PR. |
| **F2**  | 1    | Lifecycle              | Don't archive scraped images at draft time. Defer `archiveScrapedImages` until publish (or admin clicks "Archive images"). Same draft-vs-published rubric as AI R1.                                                                                                                                                     | [`functions/index.js:1587`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1587), [`:1629`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1629)                                                                                                                                                                              | Saves ~10 Storage Class-A ops + ~10 outbound fetches per ingested-but-never-published URL. At 100 unpublished drafts × 10 images = 1000 ops/mo skipped + ~50 MB Storage saved/mo. | Low — `archiveScrapedImages` is already a discrete function; gate the call.                            | Single-line revert.                    |
| **F3**  | 1    | Storage hygiene        | Add Cloud Storage lifecycle rule: delete objects in `blogs/{blogId}/images/`, `content/{contentId}/images/`, `covers/` older than 60 days that have no live-content reference. Pair with R1 (AI lifecycle): rejected docs' Storage assets should auto-purge.                                                            | `gsutil` lifecycle config (new file)                                                                                                                                                                                                                                          | Pre-launch low ($1–3/mo); post-launch $20–80/mo at scale.                                                                                                                         | Low — additive cleanup; verify the lifecycle filter doesn't catch published assets.                    | Disable the lifecycle rule.            |
| **F4**  | 1    | Public-page reads      | The 2 public Firestore reads (`/about` certs, speaker widget) should be served as static JSON generated at build time, not live Firestore.                                                                                                                                                                              | [`src/pages/shared/AboutPage.jsx:279`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/pages/shared/AboutPage.jsx#L279), [`src/components/widgets/CustomSessionizeWidget.jsx:335`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/src/components/widgets/CustomSessionizeWidget.jsx#L335)                                                                          | Eliminates per-visitor Firestore reads. At 100 visitors/day × 50 certs/events = 150K reads/mo currently. Becomes 0.                                                               | Low — content updates infrequently; build-time generation is the right pattern.                        | Revert to live read.                   |
| **F5**  | 1    | Logging hygiene        | Stop logging full AI response JSON. Replace `logger.info('[ai-model] ✅ Analysis complete:', JSON.stringify(metadata, null, 2))` with a metadata-only log (`title`, `cloudProvider`, `model`, `tokenCount`).                                                                                                            | [`functions/index.js:1513`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1513), [`:1577`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1577)                                                                                                                                                                              | Cuts log-ingestion ~5KB per ingest. At 1000 ingests/mo: 5MB; at 10K: 50MB. Trivial pre-launch but compounds.                                                                      | Very low — additive logging change.                                                                    | Revert.                                |
| **F6**  | 2    | Trigger consolidation  | Audit whether `inspectAndPopulateArticle` (`blogs` collection) is still needed or fully replaced by `inspectAndPopulateContent` (`content` collection). Same for the two `generateAiCover*OnTrigger` pair. If `blogs` is legacy/unused, remove the trigger.                                                             | [`functions/index.js:1767`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1767), [`:1801`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1801), [`:2022`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L2022), [`:2135`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L2135)                                                                                              | If duplicate fires today: 50% of trigger invocations + GB-seconds eliminated. If legacy is dead, this is pure waste removal.                                                      | Medium — needs audit of `blogs` vs `content` write frequency to confirm legacy is dead before removal. | Re-export trigger if needed.           |
| **F7**  | 2    | Memory tuning          | Drop `inspectAndPopulateArticle` and `inspectAndPopulateContent` from **1GiB → 512MiB**. Functions v2 GB-second pricing is linear; halving memory halves the cost component when CPU isn't bottlenecked. Validate via local profiling first — scrape + Gemini call + ~50KB writes shouldn't need 1GiB.                  | [`functions/index.js:1771`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1771), [`:1805`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1805)                                                                                                                                                                              | ~50% saving on the 2 highest-frequency triggers' GB-second component.                                                                                                             | Medium — out-of-memory failures = lost data. Test with 5 large articles before flipping.               | Bump back to 1GiB.                     |
| **F8**  | 2    | Schedule cadence       | Cut `monitorPublishingPipeline` from hourly → every 6 hours; cut `cleanupSoftDeletedContent` from hourly → every 4 hours; only fire `publishScheduledContent` from "every 15 min" when there's actually scheduled content (use a count-doc trigger or skip the no-op digest write).                                     | [`functions/index.js:2300`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L2300), [`:2429`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L2429), [`:2573`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L2573)                                                                                                                                      | Pre-launch: hourly→6-hourly cuts 83% of those tick costs. Each invocation is small but adds up.                                                                                   | Low — these are background ops; cadence is policy.                                                     | Revert cron string.                    |
| **F9**  | 2    | Image format on upload | After Imagen-4 returns the PNG, run it through Sharp to produce both an original (full 2K) and a WebP at responsive sizes (640/1280/2048). Reference responsive `<img srcset>` from the public site. Keeps quality where needed; reduces visitor bandwidth.                                                             | [`functions/cms-functions.js:1808`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/cms-functions.js#L1808) (uploadGeneratedImage), [`functions/index.js:1965`](https://github.com/saulpatinojr/HCW-HybridCloudWorks/blob/main/frontend/functions/index.js#L1965) (uploadAiCoverToStorage)                                                                                            | Bandwidth savings on egress (Hosting + direct Storage URLs). At 1000 covers × 5 MB / mo of unnecessary bandwidth saved.                                                           | Medium — add Sharp pipeline + responsive image components on the frontend.                             | Keep PNG-only path.                    |
| **F10** | 3    | Bundle splitting       | Lazy-load the Firebase Auth + Functions + Storage SDKs; only the public pages that actually use Firestore should pull `firebase/firestore`. Currently `vendor-firebase-D5RYYAC-.js` = 456 KB / 141 KB gzip is on every page load.                                                                                       | `vite.config.js`, top-level Firebase imports                                                                                                                                                                                                                                  | ~80 KB gzip reduction for non-admin pages → faster load + bandwidth shaved per-visitor.                                                                                           | Medium — needs careful import-graph surgery; can break Auth bootstrap if mis-split.                    | Revert Vite chunk config.              |
| **F11** | 3    | Region                 | Today everything is `us-central1`. Egress from us-central1 to internet is $0.12/GB. If most visitors are US, fine. If post-launch we see meaningful EU/APAC traffic, consider Hosting multi-region (free, automatic) or migrating Firestore to a multi-region location. **Pre-launch: do nothing; just be aware.**      | n/a                                                                                                                                                                                                                                                                           | Variable. Defer until traffic data.                                                                                                                                               | n/a (info only)                                                                                        | n/a                                    |
| **F12** | 4    | Observability          | Enable GCP Billing Export to BigQuery + a budget alert at $50 / $100 / $250. We have no early-warning signal today if any of these recommendations regresses.                                                                                                                                                           | GCP console                                                                                                                                                                                                                                                                   | Enables future-tier audits with real numbers.                                                                                                                                     | Low.                                                                                                   | Disable export.                        |

---

## 8. Suggested rollout order

1. **F1** ✅ **SHIPPED May 11, 2026** — commit `7864a08`. Replaced 4 admin snapshot endpoints'
   full-collection scans with bounded `where().orderBy().limit()` queries + `count()` aggregations +
   a maintained `dashboard_stats/v1` doc (onWrite trigger on `content/{id}` applies
   `FieldValue.increment` transitions). Added 2 composite indexes
   (`content: contentStatus+fetchedAt desc`, `content: Live+contentStatus+updatedAt desc`).
   Auto-seeds the stats doc on first dashboard load if missing. Drift recoverable via the same
   fallback path.
2. **F2** ✅ **SHIPPED May 11, 2026** — commit `1d48afe`. `archiveScrapedImages` no longer fires at
   inspection time; drafts store URL refs only (`{original, alt, index}`). `publishNewBlog` archives
   to Cloud Storage at publish-time via `_internal_archiveScrapedImageRefs` (lazy-required from
   `functions/index.js`). Editor `imageUrl` fallback chain updated to prefer `stored` then
   `original` so draft scraped images render directly from source URLs.
3. **F3** ✅ **SHIPPED May 11, 2026** — commit `1d48afe`. Added Cloud Storage lifecycle rule via
   `gcloud storage buckets update --lifecycle-file=platform/firebase/storage-lifecycle.json`:
   deletes anything under `articles/` older than 90 days. Scoped to the scraped-images prefix that
   F2 stops writing to; published-article paths (`blogs/.../images/`, `covers/`) are intentionally
   not in scope to avoid false-positive deletions of long-lived assets. Riskier path coverage
   (`covers/`, AI variants) deferred to a future F3b that would require custom-metadata tagging at
   upload time.
4. **F4** ✅ **SHIPPED May 11, 2026** — commit `91f773a`. Replaced the `/about` certifications live
   Firestore read and the `CustomSessionizeWidget` speakerevents live read with build-time JSON
   snapshots served from `/data/certifications.json` (~118KB) and `/data/speakerevents.json` (~33KB)
   via Firebase Hosting (CDN-cached). The new `scripts/generate-public-data.cjs` runs in the
   `deploy-frontend.yml` workflow using the existing `GCP_SA_KEY` service account; the script skips
   cleanly when no credentials are present so `npm run build:data` is safe locally. Eliminates
   per-visitor Firestore reads on the public site.
5. **F5** ✅ **SHIPPED May 11, 2026** — commit `b12adb8`. `analyzeWithGemini` and
   `analyzeArchitectureDiagram` no longer ship the full metadata object (incl. the ~1000-word
   `postContent`) to Cloud Logging on every ingest. Replaced with structured fingerprints (title,
   cloudProvider, category, wordCount length, model). Saves ~5KB per ingest in log ingestion cost.
6. **F6** ✅ **SHIPPED May 11, 2026** — commit `7b9bba0`. Audit confirmed
   `inspectAndPopulateArticle` and `generateAiCoverOnTrigger` (both on `blogs/{id}`) were
   unreachable from any deployed code path — no live writer sets `inspectTrigger:true` on `blogs/`,
   the publish flow inherits `inspectTrigger:false` from content, and the admin "Re-Inspect" button
   targets `content/` via `requestContentInspection`. Both triggers removed from
   `functions/index.js`; deployed Cloud Functions decommissioned via `firebase functions:delete`. 10
   legacy dev scripts that targeted `blogs/` ingestion archived to
   `documentation/archive/legacy-scripts/`. Active `blogs/` triggers (`downloadBlogCoverImage`,
   `generateBlogCoverImage`) preserved — they fire from the publish flow.
7. **F7** ✅ **SHIPPED May 11, 2026** — commit `e4dfcb8`. Dropped `inspectAndPopulateContent` from
   `1GiB` → `512MiB`. Functions v2 GB-second cost halved for this trigger. With F6 removing the
   `inspectAndPopulateArticle` duplicate, this is the single surviving inspection trigger.
8. **F8** ✅ **SHIPPED May 11, 2026** — commit `5bb6791`. (F8a) `cleanupSoftDeletedContent` cron
   hourly → every 4h; `monitorPublishingPipeline` hourly → every 6h. The function-internal staleness
   threshold (45min) is independent of cadence, so alerting accuracy is unchanged. (F8b)
   `publishScheduledContent` no longer writes `workflow_digests/<date>.publishingOps` on empty runs
   (96 no-op writes/day eliminated). `OpsHealthPage` updated to read missing stats as "Idle (no due
   items)" and fall back to `publishingWatchdog.lastRunAt` for the heartbeat timestamp.
9. **F12** ✅ **SHIPPED May 11, 2026** — infrastructure-only (no commit). BigQuery dataset
   `hybridcloudworks-61e8d:billing_export` created; Billing → Billing export → Standard usage cost
   enabled and pointed at that dataset (data begins flowing within ~24h). Budget
   `HCW prod monthly budget` created against billing account `01E6BF-AD6F79-F7D514` with $250 cap
   and threshold alerts at 20% / 40% / 60% / 80% / 100% scoped to project `hybridcloudworks-61e8d`.
   Now provides early-warning if any future change regresses cost.
10. **F9** ✅ **SHIPPED May 11, 2026** — commit `1af9321`. Backend pipeline:
    `uploadCoverWithResponsiveVariants` in `functions/index.js` emits the Imagen-4 PNG plus 640w /
    1280w / 2048w WebP variants. `generateAiCoverOnContentTrigger` writes `aiImageVariants` and
    `altCoverImageVariants` alongside their PNG counterparts; `persistGeneratedContentImage` stores
    `imageVariants` on `generated_content_images`. Frontend: new `ResponsiveCoverImage` component
    uses `<img srcset>` + `sizes` when variants exist, falls back to plain PNG when not. Consumers
    updated: `BlogDetailTemplate` (hero), `CuratedArticlesGrid` (card images), `useBlogData`
    (surfaces `imageVariants` for listing pages). Out of scope: `ProviderBlogPage` uses CSS
    `backgroundImage` which doesn't support srcset; admin views kept on plain PNG (admins not the
    bandwidth target).
11. **F10** ✅ **SHIPPED May 11, 2026** — commit `58e9f27`. Split `vendor-firebase` chunk by SDK
    sub-package. `firebase/storage` and `firebase/auth` now in their own chunks loaded only on admin
    routes; public-page chunk dropped from **456 KB → 340 KB** (~35 KB gzip saved per visit). New
    `src/lib/firebaseStorage.js` lazy-instantiates `getStorage` on first read so the Storage SDK is
    out of the eager boot. Auth bootstrap unchanged (`firebase/app` still eager; `firebase/auth`
    loads when `useAdminAuth` / `AdminAuthGuard` mount).
12. **F11 — RESOLVED May 11, 2026.** Project owner confirmed audience will be <20% non-US for the
    foreseeable future. Decision: stay on `us-central1` indefinitely. No multi-region action needed.
    If traffic distribution materially changes later (e.g., >20% sustained non-US over a 30-day
    window), revisit by enabling Firebase Hosting multi-region first (free toggle, no code change)
    before considering the destructive Firestore multi-region migration.

## 9. Cross-references with the AI Review

- **F2** (defer image archive) is the storage-side analog of **AI R1** (defer Imagen-4 cover). Same
  root cause: spending on drafts that won't publish. Implement together.
- **F3** (Storage lifecycle) closes the loop — even with F2 + R1 in place, existing rejected-content
  assets sit in Storage forever without a cleanup rule.
- **F5** (log hygiene) and **AI R9** (router cost logging) both touch the same `[ai-model]` log
  lines — coordinate so neither change overwrites the other.

## 10. Approval gate

Same rules as the AI review: **no infrastructure changes ship without per-item approval.** F1 is the
highest-leverage decision (largest absolute saving and lowest risk for the impact). F2+F3+F4 are the
lifecycle/hygiene group that pairs with the AI review's R1.
