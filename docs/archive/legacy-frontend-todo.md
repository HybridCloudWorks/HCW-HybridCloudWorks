# HCW Root TODO

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Status:** Active consolidated tracker
**Last Updated:** June 12, 2026

This file is the single root tracker for all remaining work pulled from:

- `docs/architecture/security-validation-stage2-2026-06-07.md`
- the legacy root tracker content
- `TODO2.0.md`

Validation spot-checks against the current repo state confirm the notable items below are still open:

- `VITE_GCP_FUNCTIONS_URL` is still consumed by the client helpers and was confirmed present during the June 12, 2026 production frontend build.
- `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`, and `KLAVIYO_LIST_ID` are now provisioned from Notion through `secrets-resync.yml` / `secret-sync.yml` and bound to the deployed Cloud Functions.
- `EditorListPage`, `recordAdminAudit()`, and `LabRunner` are present in code, but the broader UX and labs roadmap items are still incomplete.

Completed items have been omitted from this root tracker. This file only lists work that is still pending.

---

## Priorities

### Security Validation Follow-up

Source: `docs/architecture/security-validation-stage2-2026-06-07.md`

- [x] Confirm `VITE_GCP_FUNCTIONS_URL` is set in production deploy environments.
  - Reason: `useGenerateCuratedImages.js` now uses `postJSON()`, which throws if the URL is missing.
  - Verified: June 12, 2026 direct Firebase Hosting build injected `VITE_GCP_FUNCTIONS_URL=https://us-central1-hybridcloudworks-61e8d.cloudfunctions.net`.
- [ ] Verify the `axios` version constraint in `functions/package.json` still matches the installed lockfile state.
  - Current doc note says `^1.16.1` looked suspicious and should be checked with `npm ls axios` in `functions/`.

### Database Model Convergence

Source: legacy root tracker

- [ ] Decide whether to enter Phase A for the `content`-first convergence plan now or defer until the next content surge.
  - Phase A scope: schema lock + CI contract checks.
- [ ] Finish the remaining Phase B/Phase C/Phase D work for `content` / `blogs` convergence.
  - Fallback telemetry is already wired, but the full deprecation gate is still pending.
- [ ] Keep the intentional legacy-read / dual-write sites mapped and reviewed before deprecating `blogs`.
  - Admin fallback: `src/pages/admin/SocialHubPage.jsx`
  - Legacy maintenance / dual-write: `functions/cms-functions.js`, `functions/index.js`

### Scraping Fallback Rollout

Source: legacy root tracker

- [ ] Run `functions/test-scrape-fallback.js` against a curated difficult-URL set and record the direct + reader fallback success rate.
- [ ] Define the headless rollout gate, timeout budget, and kill-switch criteria before any Cloud Run work.
- [ ] Only proceed to a Cloud Run headless fallback if the direct + reader fallback benchmark misses the target success rate.

### Admin Portal UX

Source: legacy root tracker

- [ ] Add an admin-portal UX surface that shows roadmap readiness, active validation checks, and links to the relevant docs.

### Platform Roadmap

Source: `TODO2.0.md`

#### P0 Security

- [ ] Rotate the Publer API key manually in the Publer dashboard.
  - Rationale: the old `VITE_PUBLER_*` key was previously shipped in browser bundles.
- [x] Provision these Secret Manager secrets:
  - `LINKIE_API_KEY`
  - `KLAVIYO_PRIVATE_KEY`
  - `KLAVIYO_LIST_ID`
  - Verified: June 12, 2026 `secret-sync` logs showed all three set in Firebase Secret Manager, followed by a successful `deploy-functions` run.

#### P1 Public Pages

- [ ] Decide whether Terraform and GitHub should have Architecture and Framework pages, or remove the dead links that still point there.
- [ ] Audit mobile grids for layouts that need an explicit `grid-cols-1` base.

#### P2 Restyle Completion

- [ ] Finish any remaining Hyoga-style typography / layout work not yet fully applied across the public pages.
- [ ] Keep provider color themes preserved while completing the dark-luxe shared layout pass.

#### P4 Admin Portal Polish

- [ ] Add AI content profiling on submit.
- [ ] Unify the image workflow in EditorPage.
- [ ] Add content versioning and restore points.
- [ ] Add rejection recovery UX in QueuePage.
- [ ] Finish `EditorListPage`.
- [ ] Add drag-and-drop scheduling affordances and bulk scheduling support in the calendar flow.
- [ ] Add an Activity Log page for `recordAdminAudit()`.
- [ ] Add monthly AI cost budget alerts and response caching.
- [ ] Finish the remaining integration improvements:
  - Publer retries, character counts, engagement analytics
  - Credly bulk import, auto-sync, expiry alerts
  - Sessionize re-sync and AI-prefill
  - YouTube OAuth or remove the placeholder badge
  - Plaud webhook / auto-pull and multi-speaker transcripts
  - Global content search, auto-refreshing queue, keyboard shortcuts, toast confirmations

#### P5 Labs

- [ ] Build the frontend `LabRunner` component with provider-themed editor chrome and streaming output.
- [ ] Start with Terraform `validate`, then expand to Ansible `--syntax-check`, GitHub workflow dispatch, and later graded challenges.

## Additional Features

### P6 Innovations

- [ ] Architecture diagram interactivity.
- [ ] Cert-prep mode.
- [ ] AI site assistant.
- [ ] Newsletter pipeline.
- [ ] Engagement loop features.
- [ ] Comparison engine.
- [ ] Performance pre-rendering.
- [ ] PWA/offline admin portal.
- [ ] Public roadmap/changelog page.
- [ ] Speaking-events upgrade.

---

## Notes

- `TODO2.0.md` remains as the full platform roadmap reference.
- This root file is the live tracker for what still needs action.
- If an item gets completed, move it out of this file and into the changelog or archive docs.
