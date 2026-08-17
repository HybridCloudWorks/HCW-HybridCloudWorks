# Contributing

This repository is the application, infrastructure, migration, and delivery
source of truth for HybridCloudWorks. It runs under a strict documentation and
review discipline — read this before your first pull request.

## Where things go

| Content | Home |
| --- | --- |
| Narrative documentation (architecture, runbooks, ADRs, analysis) | [GitHub Wiki](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki) — never free-floating in-repo Markdown. Operational pages that deserve PR review (runbooks, standards) are staged in `.github/wiki/` and auto-synced to the Wiki on merge |
| Review state (work, blockers, inputs, completed) | `TODO.md`, `REVIEW.md`, `CHECKLIST.md`, `CHANGELOG.md` at the root |
| Tooling-adjacent docs (this file, `infra/README.md`, templates) | Next to the tooling, allowlisted in `scripts/validate-repository-structure.ps1` |

CI enforces this via the Repository Policy workflow. If you add a Markdown
file and CI rejects it, the fix is usually to move the content to the Wiki —
not to extend the allowlist.

## Workflow

1. Branch from `main`. No direct pushes to `main`.
2. Keep the four SOP documents true: new work lands in `TODO.md`, completed
   work moves to `CHANGELOG.md`, human blockers to `REVIEW.md`, new required
   inputs to `CHECKLIST.md`.
3. Open a PR using the template; fill the verification section with what you
   actually ran.
4. CI must be green: build/test, CodeQL, repository policy, and — for
   `infra/**` — IaC validation (fmt, validate, tflint, Trivy).

## Infrastructure changes (`infra/`)

The environment is **live production** with state in HCP Terraform Cloud.

- Read `infra/README.md` and the Wiki
  [Deployment Runbook](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/wiki/Deployment-Runbook) first.
- Never rename a resource address without a `moved` block.
- Never commit state, saved plans, real `tfvars` values, or credentials.
- Attach the plan output (or TFC run link) to the PR.
- Production applies require human approval in HCP Terraform; nothing in
  GitHub auto-applies.

## Security

Never commit secrets. `CHECKLIST.md` holds references and formats only; a real
value appearing anywhere in Git history is treated as disclosed and rotated.
Report vulnerabilities per [SECURITY.md](SECURITY.md).
