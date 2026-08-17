# Security Policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/security/advisories/new)
for anything sensitive. Do **not** open a public issue containing exploit
details, tokens, endpoints, or tenant identifiers.

## Scope

- Frontend SPA (`frontend/`), Azure Functions API (`functions/`), migration
  tooling (`scripts/`), infrastructure (`infra/`), CI workflows (`.github/`).
- The deployed Azure environment behind hybridcloudworks.com.

## Handling rules already in force

- No static cloud credentials exist in the repository or GitHub secrets;
  deployment uses OIDC federated identities (`infra/oidc.tf`). Anything that
  looks like a credential in history is a finding — report it.
- Any secret value that appears in a commit, issue, log, or the Wiki is
  treated as disclosed and rotated (`CHECKLIST.md` policy).
- Dependency vulnerabilities are tracked by Dependabot and CodeQL; accepted
  residual risks are recorded in the root `README.md` and `REVIEW.md`.
