## What

<!-- One paragraph: what this PR changes and why. Link the TODO.md item,
     issue, or wiki page that motivated it. -->

## Kind of change

- [ ] Application code (`frontend/`, `functions/`, `vps-agent/`)
- [ ] Infrastructure (`infra/`) — **attach or link the Terraform plan output**
- [ ] CI / repository policy (`.github/`, `scripts/validate-repository-structure.ps1`)
- [ ] Documentation / SOP files (`README.md`, `TODO.md`, `REVIEW.md`, `CHECKLIST.md`, `CHANGELOG.md`, Wiki)

## Infrastructure changes only

<!-- Delete this section if infra/ is untouched. -->

- [ ] `terraform plan` reviewed; **no unexpected destroy/create pairs**
- [ ] No resource addresses renamed without `moved` blocks
- [ ] No secrets, state, saved plans, or real tfvars values introduced
- [ ] Tags (`var.tags`) preserved on any new resource
- [ ] `CHECKLIST.md` updated if a new required input was introduced

## Verification

<!-- What did you run, and what did it show? Test output, plan excerpt,
     smoke-check result. "CI is green" is the floor, not the answer. -->

## SOP bookkeeping

- [ ] `TODO.md` / `REVIEW.md` / `CHANGELOG.md` updated to reflect this change
- [ ] Root `README.md` updated if repository structure, authority, or delivery status changed
