# .claude — agent harness

Configuration for Claude Code working against this repository.

`scripts/validate-repository-structure.ps1` classifies this directory as the
**agent harness**, not the site: it is excluded from the Markdown documentation
policy that sends narrative docs to the Wiki, and excluded from the CodeQL scan.

## What is here

| Path | Purpose |
| --- | --- |
| `settings.json` | Permission allowlist — which commands run without prompting |

## What is deliberately not here

**Agent and skill definitions.** The `.claude/agents/**` and `.claude/skills/**`
bundles that previously lived here were removed on 2026-08-20 and relocated
outside the repository. They were 6,687 files, they were vendored rather than
authored here, and they were the source of **every open CodeQL alert** — the
skill bundles ship `scripts/*.py` that are security *demonstration* code (a
hash-cracking skill that hashes with MD5, a TLS skill that enables legacy
protocols to show them off). Nothing imported or executed them, and
`.github/codeql/codeql-config.yml` already excluded the directory, but GitHub's
CodeQL **default setup** ignores `config-file` entirely and scanned them anyway.

Removing them removes the alerts at the source rather than dismissing each one,
which would have recorded a security judgement about demonstration code instead
of removing the scanner that should never have been looking at it.

## settings.json

`permissions.allow` entries are read-only or verification commands that were
prompted repeatedly during the infrastructure work — `terraform plan`, `az`
list/show calls, `gh` list calls, the repository-policy gate, and the test
runners. They change nothing.

**`terraform apply` is deliberately absent.** The last apply against this
configuration destroyed and recreated 125 resources. That belongs behind a
prompt every time, and HCP Terraform's own confirmation is a second gate, not a
substitute for the first. Add it only for a session where you intend to apply,
and remove it afterwards.

Adding an entry is a real decision: a standing grant applies to every future
session, not just the one that needed it.
