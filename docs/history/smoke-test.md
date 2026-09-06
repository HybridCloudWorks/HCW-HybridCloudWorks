# Live Smoke Test

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


Run this after every production deploy. Use the live site — not localhost.

**Setup before you start:**

- Admin browser tab: `https://hybridcloudworks.com/admin`
- Incognito tab: `https://hybridcloudworks.com` (public, unauthenticated)
- Have one non-live test article ready (or create one in Section 4)

---

## Section 0 — Deployment Gate

Do not continue until both pass.

- [ ] Latest `deploy-frontend` GitHub Actions run on `main` → **success**
- [ ] Latest `deploy-functions` GitHub Actions run on `main` → **success**
- [ ] `https://hybridcloudworks.com` loads in incognito — no blank screen or broken layout
- [ ] `https://hybridcloudworks.com/aws` loads normally
- [ ] `https://hybridcloudworks.com/azure` loads normally

---

## Section 1 — Admin Access

- [ ] `/admin` loads — shows sign-in or dashboard
- [ ] Sign in with admin account — dashboard loads
- [ ] Dashboard shows all four panels: **ContentForge Flow**, **Pipeline Readiness**, **Publishing
      Operations**, **Workflow Alerts**
- [ ] **Pipeline Readiness** → Functions URL shows `Ready` _(if Missing, admin actions that call
      functions will fail)_
- [ ] **Publishing Operations** renders numeric cards without crashing
- [ ] **Workflow Alerts** filter buttons (Open / Acknowledged / Resolved) are clickable

---

## Section 2 — Dashboard Actions

Run these one at a time. Each should complete within ~45 seconds.

- [ ] Click **Run RSS Fetch Now** → success message with feed/entry counts
- [ ] Click **Run Batch Inspect** → success message with triggered/total counts
- [ ] Click **Generate Reviewer Digest** → success message with queued item counts
- [ ] Refresh dashboard → still loads cleanly with valid panels

---

## Section 3 — Queue Filters

- [ ] `/admin/queue` loads with filter controls
- [ ] Status filter → **Needs Review** → list refreshes correctly
- [ ] Status filter → **Ingested (Uninspected)** → list refreshes correctly
- [ ] Status filter → **Approved: Blog** → list refreshes correctly
- [ ] Type filter → **Architecture** → page does not crash
- [ ] Type filter → **Frameworks** → page does not crash
- [ ] Type filter → **All Types** → full queue view returns

---

## Section 4 — Test Content

If suitable test items already exist, skip creation steps and record their IDs.

- [ ] Immediate-publish candidate exists (blog-type, not live, valid title + draft)
- [ ] Scheduled-publish candidate exists (separate item, not live)
- [ ] Reject/restore throwaway item exists (safe to reject, not a real article)

_To create: `/admin/submit` → create with a title that clearly marks it as a smoke-test item._

---

## Section 5 — Queue Review Actions

- [ ] Locate immediate-publish candidate in queue → correct title and provider shown
- [ ] Click **View** on it → review page opens
- [ ] Locate reject/restore throwaway → confirm it is not live
- [ ] Click **Reject** on throwaway → item leaves active list
- [ ] Filter → **Rejected** → throwaway item appears
- [ ] Click **Restore to Review** → item returns to reviewable state
- [ ] Find an inspectable ingested item → click **Inspect Now** → completes without UI error
- [ ] Click **Send to Publish** on immediate-publish candidate → item moves toward `approved_blog`

---

## Section 6 — Blog Review Page

- [ ] Open `/admin/queue/{contentId}` for the immediate-publish candidate → review board loads
- [ ] Title, summary, and metadata match the test item
- [ ] **Open in Editor** link → editor opens for the same content ID

---

## Section 7 — Architecture Review _(skip if no architecture content exists)_

- [ ] Open an architecture item from queue → `Architecture Studio` badge visible
- [ ] Change one non-destructive field → save completes without error
- [ ] Click the publish action → item sent forward, returns to architecture queue view

---

## Section 8 — Framework Review _(skip if no framework content exists)_

- [ ] Open a framework item from queue → `Framework Studio` badge visible
- [ ] Change one non-destructive field → save completes without error
- [ ] Click the publish action → item sent forward
- [ ] Open delete dialog → cancel it → item is not deleted

---

## Section 9 — Editor (new 3-tab architecture)

Use the immediate-publish candidate.

**Load and tabs**

- [ ] `/admin/editor/{contentId}` loads without errors — all three tabs visible: **Content**,
      **Modules**, **Metadata**
- [ ] Preview panel renders on the right side

**Content tab**

- [ ] Selected section is highlighted in the section strip
- [ ] Edit section textarea — text updates locally
- [ ] Switch view mode to **Raw** → full draft textarea appears
- [ ] Switch view mode to **Diff** → diff message appears in preview panel
- [ ] Switch view mode to **Sections** → returns to section editing

**Modules tab**

- [ ] Modules tab loads — shows modules for the selected section (or empty state)
- [ ] **Show all** toggle → shows all modules across all sections
- [ ] Select module type **Fact** → content textarea appears
- [ ] Select module type **Code** → monospace textarea appears
- [ ] Select module type **Links** → links textarea with format hint appears
- [ ] Select module type **Image** → URL + caption inputs appear; image picker shows if candidates
      exist
- [ ] Select module type **Spacer** → spacer style buttons appear
- [ ] Click **Add to Article** → module appears in the list
- [ ] Click **Edit** on a module → form loads with that module's content
- [ ] Change a field → click **Apply Changes** → change is reflected in preview
- [ ] Click **Done** → editing state clears
- [ ] Drag a module to reorder → order updates
- [ ] Click **Delete** on a module → module is removed

**Metadata tab**

- [ ] Title field is populated
- [ ] Author, date, tags fields are populated
- [ ] Summary section expands/collapses
- [ ] Sidebar content section expands/collapses

**Save and persist**

- [ ] Click **Save Draft** → saved indicator or timestamp appears
- [ ] Refresh page → saved changes persist

**Conflict detection**

- [ ] Open same article in two admin tabs → save a change in tab A
- [ ] In tab B, make a different change → click **Save** → conflict warning appears (amber banner)
- [ ] Click **Reload** in tab B → remote content replaces local stale content
- [ ] Re-trigger conflict → click **Force Save** in tab B → save completes with tab B content

---

## Section 10 — Immediate Publish

- [ ] `/admin/published` loads — shows **Ready to Publish** and published sections
- [ ] Immediate-publish candidate appears in **Ready to Publish** and is not already live
- [ ] Click **Review** for the candidate → review link works, back navigation works
- [ ] Click **Publish Blog** → item is treated as live
- [ ] **Latest Publish Diagnostics** → `expectedPublicUrl` is populated and differs from `sourceUrl`
- [ ] Item leaves **Ready to Publish**
- [ ] Item appears in the published list with status and date
- [ ] Open the public blog URL in incognito → page loads with correct title and content
- [ ] Article is reachable from the expected provider blog area

---

## Section 11 — Scheduled Publish

- [ ] Scheduled-publish candidate is approved/staged but not live
- [ ] `/admin/calendar` loads with month view and queue panel
- [ ] Candidate appears in instant-publish queue (not already in a calendar slot)
- [ ] Double-click a future date (at least 15 min ahead) → scheduling modal opens
- [ ] Select the candidate inside the modal → item is marked
- [ ] Double-click an hour slot → scheduling confirmed, modal closes
- [ ] Item appears on the chosen calendar day
- [ ] In Firestore Console: `scheduledPublishDate` is set, `Live` is still `false`
- [ ] After the scheduler window passes: item becomes live
- [ ] Item is live in both `/admin/published` and on the public site

---

## Section 12 — Workflow Alerts

- [ ] Return to `/admin` → dashboard loads cleanly after publish activity
- [ ] **Publishing Operations** shows coherent values (due, published, skipped, failed, last run)
- [ ] Open alert exists → **Acknowledge** action succeeds → alert leaves Open filter
- [ ] Switch to **Acknowledged** filter → acknowledged alert is visible
- [ ] Enter a resolution note → click **Resolve** → alert moves to Resolved
- [ ] Switch to **Resolved** filter → alert shows with resolution note
- [ ] Click **Reopen** → alert returns to active state

---

## Section 13 — Unpublish

- [ ] In `/admin/published`, locate the live immediate-publish candidate
- [ ] Trigger unpublish → confirm → item leaves live state
- [ ] Refresh `/admin/published` → item is no longer shown as live
- [ ] Check public URL in incognito → article is no longer live

---

## Section 14 — Firestore Rules

- [ ] Open Firebase Console → Firestore Rules → rules are current and match intended release
- [ ] Incognito (signed out) → attempt `/admin` → cannot perform admin actions
- [ ] Signed in as admin → simple content save works → admin writes still succeed

---

## Section 15 — Firestore Indexes

- [ ] Firebase Console → Firestore Indexes → scheduled-publish index on `content`
      (`scheduledPublishDate` + `Live`) exists and is enabled
- [ ] If Section 11 failed: check function logs for missing-index errors

---

## Section 16 — Firestore Data Verification

- [ ] Open immediate-publish candidate in Firestore `content` → status, title, draft, live fields
      are consistent with last action taken
- [ ] Provider, slug-related fields, and publish timestamps are present when live
- [ ] Corresponding record exists in Firestore `blogs` after publish
- [ ] Title and summary match between `content` and `blogs`

---

## Section 17 — Public Site Final Pass

- [ ] Homepage loads normally in incognito after all admin activity
- [ ] Provider page for the published article loads normally
- [ ] Live article URL → readable, correct title, not malformed
- [ ] Refresh the article page → still loads correctly

---

## Pass / Fail

**Passes when all of these are true:**

1. Both deploy workflows succeeded
2. Admin dashboard loads and all action buttons work
3. Queue filters and actions work
4. Editor — all 3 tabs functional, modules add/edit/delete/reorder, save persists, conflict
   detection works
5. Immediate publish produces a live public article
6. Scheduled publish produces a live public article after scheduler runs
7. Alert acknowledge / resolve / reopen all persist in Firestore
8. Unpublish removes article from live state
9. Firestore rules block unauthenticated admin actions
10. Firestore indexes needed by scheduled publish are present

**Treat as a release blocker if any of these occur:**

- Functions URL is missing — admin actions that call backend functions will fail silently
- Item publishes from the wrong state, or cannot publish from the correct state
- Immediate publish succeeds in admin but produces no public page
- Scheduled publish misses its window with no log explanation
- Editor conflict protection allows a silent overwrite (tab B overwrites tab A with no warning)
- Alert actions do not persist in Firestore
- Unauthenticated users can perform admin actions
