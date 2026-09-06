# Smoke Test Signoff

!!! note "Historical record"
    Retained as evidence of how the Azure platform was built. Not an active
    runbook for starting a new migration.


## Run Metadata

| Field                         | Value                 |
| ----------------------------- | --------------------- |
| Date                          |                       |
| Tester                        |                       |
| Deploy commit (frontend)      |                       |
| Deploy commit (backend)       |                       |
| GitHub Actions run (frontend) |                       |
| GitHub Actions run (backend)  |                       |
| Overall result                | PASS / FAIL / PARTIAL |

---

## Content Used

| Item                        | Content ID | Notes |
| --------------------------- | ---------- | ----- |
| Immediate-publish candidate |            |       |
| Scheduled-publish candidate |            |       |
| Reject/restore throwaway    |            |       |

---

## Section Results

| Section                     | Result             | Notes |
| --------------------------- | ------------------ | ----- |
| 0 — Deployment Gate         |                    |       |
| 1 — Admin Access            |                    |       |
| 2 — Dashboard Actions       |                    |       |
| 3 — Queue Filters           |                    |       |
| 4 — Test Content            |                    |       |
| 5 — Queue Review Actions    |                    |       |
| 6 — Blog Review Page        |                    |       |
| 7 — Architecture Review     | SKIP / PASS / FAIL |       |
| 8 — Framework Review        | SKIP / PASS / FAIL |       |
| 9 — Editor                  |                    |       |
| 10 — Immediate Publish      |                    |       |
| 11 — Scheduled Publish      |                    |       |
| 12 — Workflow Alerts        |                    |       |
| 13 — Unpublish              |                    |       |
| 14 — Firestore Rules        |                    |       |
| 15 — Firestore Indexes      |                    |       |
| 16 — Firestore Data         |                    |       |
| 17 — Public Site Final Pass |                    |       |

---

## Blocking Issues

List any step that failed and why. Leave blank if none.

| Step | Failure description | Blocker? |
| ---- | ------------------- | -------- |
|      |                     |          |

---

## Key Evidence

- Immediate publish public URL:
- Scheduled publish public URL:
- Any error messages (exact text, not summaries):

---

## Decision

- [ ] **GO** — all pass criteria met, no blockers
- [ ] **NO-GO** — one or more blockers present (list in Blocking Issues above)
- [ ] **CONDITIONAL GO** — known issues documented, non-blocking

Signed off by: ****\*\*\*\*****\_\_\_****\*\*\*\***** Date: \***\*\_\_\_\*\***
