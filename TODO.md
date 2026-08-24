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
| Medium | 0 |
| Low | 1 |
| Total | 1 |

## Low

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
