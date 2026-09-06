# Dependency Notes

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## `package.json` Overrides Rationale

The `overrides` block forces specific transitive dependency versions to patch security
vulnerabilities in packages that haven't released upstream fixes. Each entry is documented below.

| Override                        | Reason                                                                                    | Remove when                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `debug ^4.3.7`                  | GHSA-gxpj-cx7g-858c (debug prototype pollution in <4.3.7)                                 | Parent packages pull in ≥4.3.7 by default |
| `highlight.js ^11.9.0`          | GHSA-7wwv-vh3v-89cq (ReDoS in <11.9.0)                                                    | All consumers declare ≥11.9.0             |
| `prismjs ^1.30.0`               | GHSA-x7hr-w5r3-7x7h (XSS in <1.30.0); GHSA-3949-f494-cm99                                 | All consumers declare ≥1.30.0             |
| `minimatch ^10.2.2`             | GHSA-f8q6-p94x-37v3 (ReDoS in <3.0.5); upgrade chain forces v10                           | Consumers pull in ≥10                     |
| `glob ^13.0.6`                  | Depends on old minimatch; upgrade forces glob v13                                         | Consumers pull in ≥13                     |
| `rimraf ^6.1.3`                 | Depends on old glob; upgrade forces rimraf v6                                             | Consumers pull in ≥6                      |
| `archiver ^7.0.1`               | GHSA-4g88-fppr-53pp (zip-bomb / path traversal in older versions)                         | archiver publishes ≥7 as default          |
| `readdir-glob ^3.0.0`           | Depends on old glob; v3 uses glob ≥13                                                     | Consumers pull in ≥3                      |
| `ajv ^8.18.0`                   | Schema validation correctness; eslint/eslintrc require ajv 6 internally (nested override) | eslint resolves ajv natively              |
| `@eslint/eslintrc → ajv 6.14.0` | eslintrc requires ajv 6 API — cannot use 8 here; pinned to ensure compatibility           | eslintrc updates its own ajv peer         |
| `eslint → ajv 6.14.0`           | Same as above                                                                             | eslint updates its own ajv peer           |

## Remaining Unfixed Vulnerabilities

The following moderate vulnerabilities have no current upstream fix. They are tracked here and will
be auto-resolved by Dependabot when fixes are released.

| Package            | CVE / GHSA                                                            | Severity | Notes                                                               |
| ------------------ | --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| `dompurify ^3.3.0` | GHSA-h8r8-wccr-v5f2 (mutation-XSS via re-contextualization)           | Moderate | No fix in stable channel as of 2026-04-28; monitor for ≥3.3.x patch |
| `dompurify ^3.3.0` | GHSA-v9jr-rg53-9pgp (prototype pollution via CUSTOM_ELEMENT_HANDLING) | Moderate | Requires `--force` bump; evaluate once upstream publishes           |
