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

### A-001 — Associate the unlabelled form controls

`jsx-a11y/label-has-associated-control` reports 20 violations across
`frontend/src` — `<label>` elements with no associated control. The rule is
disabled in `eslint.config.js`; it was off because it crashed on ESLint 9, and
since the ESLint 10 upgrade it runs correctly and these are real findings.
Associate each label with its control (nesting, or `htmlFor`/`id`), then delete
the rule's `off` entry so it cannot regress. Screen-reader users get no field
name from an unassociated label, so each one is a small but genuine defect.

## Test coverage follow-up

One boundary case is left, and it is not resolvable from the repository:

- The deployed no-op Labs job path, after a human supplies the Entra access
  needed for an authenticated live check (the live prerequisite remains in
  [REVIEW.md](REVIEW.md)).

The API base, public content limit, and partial configuration cases are
covered; see [CHANGELOG.md](CHANGELOG.md).

Completed items are removed from this file after the corresponding regular
entry is present in `CHANGELOG.md`; item numbers are not reused.
