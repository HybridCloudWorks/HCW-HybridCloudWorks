# TODO

Actionable engineering work for the HybridCloudWorks website. This file only
contains work an engineer can implement in the repository. Owner decisions,
production approvals, credentials, external access, and live-environment
operations belong in [REVIEW.md](REVIEW.md). Verified completion belongs in
[CHANGELOG.md](CHANGELOG.md).

## Status — 2026-08-24

| Priority | Open items |
| --- | ---: |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Total | 5 |

## Medium

### T-411 — Port Listen & Learn as a scoped website feature

Implement the worker, API reads, player, and admin experience as one coherent
feature. The work depends on an owner decision about Azure Speech or another
text-to-speech provider, YouTube API access, and the storage/retention policy;
those inputs are listed in [REVIEW.md](REVIEW.md). Do not port the old Firebase
implementation wholesale.

### T-319 — Bound RSS item arrays

Bound `items[]` in `functions/src/lib/public-reads.js` and in the future
`syncRssFeeds` writer. Preserve the newest items based on `pubDate`, add a
matching unit test, and keep the anonymous response bounded even when one feed
is malformed or unusually large.

## Low

### T-410 — Evaluate the remaining upstream feature candidates

Review the admin queue improvements, Architecture listing, draw.io tooling, and
other upstream candidates as separate product changes. Port only a selected
feature with current Azure API and authorization seams; do not merge the old
Firebase data/auth layers or copy an entire upstream branch.

### T-407 — Remove unreachable backend dependencies

Confirm whether `cheerio`, `rss-parser`, `google-auth-library`, and other
non-route dependencies in `functions/package.json` are still needed by active
handlers. Remove only packages with no runtime or test consumer, then run the
Functions test suite and dependency review.

### D-001 — Revisit the ESLint 10 upgrade

Re-evaluate the upgrade when `eslint-plugin-react`, `eslint-plugin-react-hooks`,
and `eslint-plugin-jsx-a11y` support ESLint 10. Keep the current ESLint 9 line
until the complete frontend lint suite is green on the newer major.

## Test coverage follow-up

Add focused tests for the remaining boundary cases:

- API base resolution when the Azure provider is selected.
- Public content limits for non-numeric, zero, negative, and oversized values.
- Partial MCP/AI configuration updates that omit an existing secret field.
- The deployed no-op Labs job path after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
