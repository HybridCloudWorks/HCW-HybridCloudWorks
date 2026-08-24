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
| Low | 2 |
| Total | 4 |

## Medium

### T-411 — Port Listen & Learn as a scoped website feature

Implement the worker, API reads, player, and admin experience as one coherent
feature. The work depends on an owner decision about Azure Speech or another
text-to-speech provider, YouTube API access, and the storage/retention policy;
those inputs are listed in [REVIEW.md](REVIEW.md). Do not port the old Firebase
implementation wholesale.

### T-412 — Decompose `QueuePage.jsx`

`frontend/src/pages/admin/QueuePage.jsx` is 1,310 lines and holds the admin
area's riskiest code: the bulk paths transition many documents one at a time
and each partial failure has to be attributed back to its own card. Split the
mutating actions, the banners and the item card into their own modules so the
bulk logic can be tested without rendering the card markup, then add tests for
the partial-failure paths. Do this against this repository's file — the
upstream equivalent (T-410) is written against Firestore-era helpers — and keep
the existing behaviour, including which actions each status filter allows.

## Low

### T-410 — Port the draw.io hotspot tooling

The candidate evaluation is complete and recorded in
[CHANGELOG.md](CHANGELOG.md); the draw.io tooling is the one it recommends, and
which candidate is actually built is an owner decision listed in
[REVIEW.md](REVIEW.md). Once selected, port `lib/drawio/parseDrawio.js` and
`lib/drawio/hotspotGeometry.js` with their upstream test and fixture, and the
diagram panel that uses them, so hotspots are generated from an uploaded
`.drawio` file instead of typed into `ArchitectureReviewBoard` by hand. Route
the upload through `POST /api/cms/uploads/{container}`; the parsing is pure and
carries no Firebase coupling, and `InteractiveDiagram` already consumes the
hotspot shape. Do not bring the Architecture listing pages with it: they depend
on `ContentReviewBrowser` and a Firestore-query data seam.

### D-001 — Revisit the ESLint 10 upgrade

Two plugins still block it as of 2026-08-24: `eslint-plugin-react` 7.37.5 caps
its peer range at `eslint@^9.7` and `eslint-plugin-jsx-a11y` 6.10.2 at
`eslint@^9`. `eslint-plugin-react-hooks` and `@typescript-eslint/eslint-plugin`
already declare `^10`. Re-evaluate when the other two do, and keep the ESLint 9
line until the complete frontend lint suite is green on the newer major.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
