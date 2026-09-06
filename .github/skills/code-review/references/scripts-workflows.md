# Operational scripts and CI review — `scripts/`, `.github/workflows/`

`scripts/` holds Node 22 ESM operational tooling (Vitest-tested, ESLint) and
PowerShell operator scripts. `.github/workflows/` holds CI, validation,
monitors, and manual release workflows — all on GitHub-hosted runners.

## What to check in the diff

### `scripts/*.mjs`
- Every non-trivial script here has a sibling `*.test.mjs`; changed behavior
  without a test change is a flag. The tests run with `npm test` from
  `scripts/` (the same command `ci.yml` runs).
- Several scripts are **workflow contracts** — they're invoked by a workflow
  with specific inputs/outputs, and some have invocation tests pinning that
  (`check-unresolved-secrets.invocation.test.mjs`,
  `manifest-workflow.test.mjs`, `workflow-write-permissions.test.mjs`,
  `oidc-subjects.test.mjs`). When a script's CLI or output changes, find and
  review the workflow that calls it in the same pass.
- Scripts that hit Azure (`smoke-deployed.mjs`, container-spec generation)
  use `@azure/identity` — no keys, no connection strings. Scripts that hit
  GitHub use the app-token helper (`github-app-token.mjs`), not PATs.
- Monitors (`check-deploy-drift.mjs`, `check-unresolved-secrets.mjs`,
  `check-tfc-plan.mjs`, `assert-expected-plan.mjs`) exist to distinguish
  real failures from reporting failures — review that error paths exit
  non-zero and that "success" means the thing actually verified, not that
  the command ran (this repo has been burned by that distinction; see
  `.claude/CLAUDE.md`).

### PowerShell (`*.ps1`)
- Must pass `scripts/validate-powershell.ps1` and the hygiene test
  (`powershell-hygiene.test.mjs`). Owner-pasteable commands follow the
  CLAUDE.md rules: no placeholders, no bash-isms, one line where possible.
- `validate-repository-structure.ps1` is the Markdown allowlist — a diff
  extending the allowlist deserves scrutiny: the usual right fix is moving
  the doc to `docs/`, not growing the allowlist.

### Workflows (`.github/workflows/*.yml`)
- **Permissions**: each workflow declares least-privilege `permissions:`;
  `workflow-write-permissions.test.mjs` pins which workflows may write.
  A new `write` scope is a finding unless justified.
- **Pinning**: third-party actions pinned per repository policy
  (dependency-review and repository-policy workflows enforce).
- **No auto-apply/auto-deploy**: Azure releases are explicit manual
  dispatches (`deploy-azure-frontend.yml`, `deploy-functions.yml`);
  Terraform applies only via HCP Terraform review. A trigger change that
  makes deployment automatic on push/merge is blocking.
- **Untrusted input**: no `pull_request_target` with checkout of PR code, no
  interpolation of PR titles/bodies/branch names into `run:` shells.
- **Monitors** (`monitor-*.yml`, `verify-alert-state.yml`,
  `validate-deployed.yml`): check schedule frequency against cost/noise and
  that failure actually surfaces (creates an issue / fails visibly) rather
  than dying silently.

## Verification commands

Run from `scripts/` — including for workflow-only diffs: several tests in
this suite (`workflow-write-permissions.test.mjs`, the invocation tests) pin
`.github/workflows/` content, so a workflow change can fail them without
touching any `.mjs` file:

```bash
npm run lint
npm test
```

PowerShell validation (`pwsh` required — note in the report if unavailable):

```powershell
./scripts/validate-powershell.ps1
./scripts/validate-repository-structure.ps1
```
