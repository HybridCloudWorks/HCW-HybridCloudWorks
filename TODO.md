# TODO

Actionable engineering work for HCW-HybridCloudWorks.

**Classification (Code Review SOP, CODE_REVIEW_PROMPT.md v1.0, Phase 10):** this
file holds work an engineer can resolve without human input — bugs, refactoring,
technical debt, missing tests, security remediation, performance remediation,
cleanup, follow-up validation, and documentation tasks caused by reviewed code.

Anything that needs a human decision, an approval, an access grant, or
credential ownership belongs in [REVIEW.md](REVIEW.md), not here. Required
inputs and configuration inventory belong in [CHECKLIST.md](CHECKLIST.md).
Completed work moves to [CHANGELOG.md](CHANGELOG.md).

**If this file lists no open items, there is no known outstanding engineering
work** — that is a valid and deliberate state, not a missing document.

---

## Status

| | |
| --- | --- |
| Open items | 6 |
| Last updated | 2026-08-09 |
| Source | Code Review SOP run, repository-wide scope |

---

## Open Items

### T-001 — Implement `publishScheduledContent` timer
**Severity:** High &nbsp;·&nbsp; **Category:** Defect / incomplete feature &nbsp;·&nbsp; **Label:** Confirmed Issue

`functions/src/functions/schedulers.js:27` registers a timer on a 15-minute
cadence whose body is a TODO behind `FEATURE_FLAG_SCHEDULERS`.

The admin Calendar page writes `scheduledPublishDate` (via the
`saveContentSchedule` RPC) and the publish queue surfaces scheduled items, but
**nothing consumes the field** — scheduled content never goes live. The feature
is reachable and appears to work in the UI, which makes this a silent failure
rather than a visibly missing feature.

**Fix:** query `content` for documents with `scheduledPublishDate <= now` that
are not already `Live`, then drive them through the existing
`transitionContentStatus` / `publishContent` path rather than writing status
fields directly, so the state machine and audit trail stay authoritative.

**Validation:** unit tests over the query predicate and the boundary condition
(exactly-now, past, future, missing field, malformed date string).

---

### T-002 — Implement the remaining scheduler timers
**Severity:** Medium &nbsp;·&nbsp; **Category:** Incomplete feature &nbsp;·&nbsp; **Label:** Confirmed Issue

Three further timers in `functions/src/functions/schedulers.js` are registered
with empty bodies:

| Timer | Line | Cadence | Missing behavior |
| --- | --- | --- | --- |
| `syncRssFeeds` | 15 | hourly | fetch feed URLs from config, parse, upsert content |
| `cleanupTempStorage` | 38 | daily | delete orphaned blobs via `blob-storage.js` |
| `checkAgentHealth` | 50 | 5 min | mark `lab_agents` offline when `lastPing` is stale |

`checkAgentHealth` is the one with a visible consequence: the Labs page derives
agent online/offline state itself from `lastSeenAt`, so stale agents display
correctly today, but nothing ever writes the offline status back.

---

### T-003 — Implement the Cosmos change-feed side effects
**Severity:** Medium &nbsp;·&nbsp; **Category:** Incomplete feature &nbsp;·&nbsp; **Label:** Confirmed Issue

`functions/src/functions/cosmos-triggers.js:28` and `:46` carry unimplemented
side effects ported from the source `onDocumentWritten` handlers, including
"if status == 'completed', notify the user". Determine which side effects are
still required after the port before implementing — some may have been
superseded by the synchronous RPC paths.

---

### T-004 — Complete or formally park the `vps-agent` scaffold
**Severity:** Medium &nbsp;·&nbsp; **Category:** Technical debt &nbsp;·&nbsp; **Label:** Confirmed Issue

`vps-agent/index.js` carries three TODOs (port original logic, implement the
change-feed listener or polling loop, start the heartbeat interval). The Labs
platform's server side is complete — `enqueueLabJob`, `getLabsSnapshot`,
`getLabJob`, `cancelLabJob` all exist — so the agent is the only missing half.

Until it is finished the Labs UI can queue jobs that nothing will ever claim.
Either complete it or gate the Labs UI behind a feature flag so the dead-end is
not reachable.

---

### T-005 — Port the AI-gated RPC set
**Severity:** Medium &nbsp;·&nbsp; **Category:** Incomplete feature &nbsp;·&nbsp; **Label:** Requires Validation

17 RPCs in `.azure/api-surface.json` remain unimplemented: `aiProxy`,
`mcpProxy`, `klaviyoProxy`, `linkieProxy`, `publerProxy`,
`generateArticleDraft`, `generateCuratedArticleImage`, `generatePreviewImages`,
`generateReviewHeroImage`, `generateReviewerDigestManual`,
`generateSocialCaption`, `batchInspect`, `fetchRssFeedsManual`,
`createContentFromRecording`, `syncMcpTools`, `testAiProvider`,
`triggerAiImageGeneration`.

These are called from live admin UI paths, so each currently fails at runtime.
Blocked on provider credentials being seeded — see
[CHECKLIST.md](CHECKLIST.md) and [REVIEW.md](REVIEW.md) §4.2.

---

### T-006 — Reconcile `Review.md` content against the SOP classification
**Severity:** Low &nbsp;·&nbsp; **Category:** Documentation &nbsp;·&nbsp; **Label:** Documentation Impact

`REVIEW.md` predates the SOP and mixes human blockers with engineer-resolvable
work. Sections describing environment limits, access, and approvals are correct
for REVIEW.md; sections describing code work (§5.1 handler TODOs, §5.2
vps-agent, §2.6 package boundary) have been lifted into this file as T-001–T-004
and should be pruned from REVIEW.md once confirmed.

§5.0 ("the frontend is still a Firebase client — this is the Go-Live blocker")
is **obsolete**: the Firebase decoupling completed in PRs #61–#66 and the file
counts it cites are now zero.

---

## Recently Closed

Moved to [CHANGELOG.md](CHANGELOG.md) when released.

| Item | Closed by |
| --- | --- |
| Frontend Firebase decoupling (34 files → 0) | #61–#66 |
| Dependency advisories cleared (2 high, 1 moderate) | #67 |
| Admin auth swap to Entra ID / MSAL | #60 |
