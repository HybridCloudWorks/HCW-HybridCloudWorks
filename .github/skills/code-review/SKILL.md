---
name: hcw-code-review
description: >-
  Repository-specific code review for the HybridCloudWorks site — the React
  frontend, Azure Functions API, Terraform infrastructure, operational
  scripts, GitHub workflows, VPS Labs agent, and Cloudflare edge probe. Use
  this whenever reviewing a diff, branch, or pull request in this repository,
  whenever the user asks to "review", "check", or "audit" changes to any
  component here, and before opening a PR with non-trivial changes — even if
  the user doesn't say the words "code review". It routes the review to
  per-component checklists and the exact verification commands CI will run.
---

# HybridCloudWorks code review

Review changes the way this repository's CI and reviewers will: component by
component, with the repo's own checks, against a live production estate.

## 1. Scope the review

Establish exactly what is being reviewed before reading any code:

```bash
git diff --stat main...HEAD        # a branch
git diff --stat HEAD               # the working tree
git show <sha> --stat              # a single commit
```

For a PR, fetch its diff/files first. Then map every touched path to a
component using the table below, and read the matching reference file for each
component in the diff. Don't read references for components the diff doesn't
touch — with one exception: a frontend diff that adds or changes an API call
also needs `references/functions.md` for the contract check, even when
`functions/**` itself is untouched.

| Touched path | Component | Reference to read |
| --- | --- | --- |
| `frontend/**` | Public site + admin portal (React 19, Vite, Tailwind 4, MSAL) | `references/frontend.md` |
| `functions/**` | Azure Functions API, workers, timers (Node 22 ESM) | `references/functions.md` |
| `infra/**` | Terraform root module — **live production**, HCP Terraform state | `references/infra.md` |
| `scripts/**`, `.github/workflows/**` | Operational scripts and CI/CD | `references/scripts-workflows.md` |
| `vps-agent/**`, `edge/**` | Labs job executor and Cloudflare availability probe | `references/agents-edge.md` |
| `docs/**`, `TODO.md`, `CHANGELOG.md`, other `*.md` | Documentation discipline | Section 3 below |

## 2. Review each component

For each component, do three passes in this order:

1. **Correctness** — read the diff for real bugs: broken logic, unhandled
   error paths, race conditions, contract drift between frontend calls and
   Functions routes, Terraform changes that would destroy/recreate live
   resources. A finding needs a concrete failure scenario ("with input X,
   this does Y"), not a style opinion.
2. **Security** — this repo runs a public site with an Entra-protected admin
   plane over production data. Apply the security checklist in Section 3 and
   the component reference.
3. **Verification** — run the component's own checks (each reference lists
   them). Some of these CI runs too (`ci.yml`: lint, format, build, test per
   package; `iac-validate.yml`: fmt/validate/tflint/Trivy) — skipping those
   just moves the failure to CI. Others are review-time validators CI does
   not run (the frontend route/provider/content-matrix checks, PowerShell
   validation), which makes running them here the only gate. Report what you
   ran and what it proved, matching the PR
   template's Verification section: checks run, evidence, checks not run and
   why.

Rank findings by severity. Prefer few, high-confidence findings over a long
list of nits — this repo's review culture (see the PR template) values
verified evidence over volume.

## 3. Cross-cutting checks (every review)

These apply regardless of component, and CI enforces most of them:

- **Secrets.** No credentials, connection strings, tokens, Cosmos keys, or
  real `tfvars` values anywhere — including test fixtures and examples. A
  real value in Git history is treated as disclosed and rotated. Frontend
  `VITE_*` variables are public by construction: only client IDs, tenant IDs,
  scopes, and URLs belong there.
- **Telemetry is content-free.** Log correlation identifiers, not paths,
  query strings, route values, document IDs, or payloads.
- **Dependency and Actions pinning.** New GitHub Actions, dependencies, and
  base images must be pinned per repository policy; `dependency-review` and
  `repository-policy` workflows gate this.
- **Documentation discipline.** New Markdown files are rejected by the
  Repository Policy workflow unless allowlisted in
  `scripts/validate-repository-structure.ps1`. Narrative docs belong in
  `docs/` (published to docs.hybridcloudworks.com), open work in `TODO.md`, completed work
  in `CHANGELOG.md`. If a change completes tracked work, check that TODO.md
  and CHANGELOG.md moved with it.
- **Owner-facing instructions** (in docs, TODO items, PR bodies): must follow
  `.claude/CLAUDE.md` — PowerShell by default, bash flagged explicitly,
  one-line commands, **no placeholders** in pasteable commands (look values
  up in `infra/variables.tf`), control-plane `az` verbs over data-plane, no
  `az --query` with brackets, exact URLs for browser steps.
- **Test movement.** Changed behavior needs changed tests. This repo
  co-locates tests (`*.test.js` / `*.test.mjs` next to source); a diff that
  changes a file with a sibling test but not the test is a flag to
  investigate, not an automatic finding.

## 4. MCP context (Copilot code review)

When this skill runs inside GitHub Copilot code review, five read-only MCP
servers are defined for the repository in `.github/copilot-mcp.json`. GitHub
reads that configuration from repository settings, not from the file, so the
servers are available only once the owner has applied it there — the
procedure and rationale are in `docs/runbooks/copilot-code-review-mcp.md`.
When a server named below is available, use it to verify rather than assert;
when it is not, say so in the finding and fall back to the evidence in the
diff and the repository, rather than reporting a tool error as a finding.
Inside a code review GitHub runs MCP in read-only mode and keeps only tools
whose own definitions carry `readOnlyHint: true`, so a review session may see
fewer servers than the file lists — the documentation servers in particular
depend on how their vendors annotate their tools:

| Component in the diff | Consult | For |
| --- | --- | --- |
| `infra/**` | `terraform` — `search_providers`, `get_provider_details` | Whether an `azurerm` / `cloudflare` argument exists on the pinned provider version, and whether changing it forces replacement of a live resource. |
| `functions/**`, `frontend/**` (MSAL, SWA config), `infra/**` (Azure resources) | `microsoft-learn` — `microsoft_docs_search`, then `microsoft_docs_fetch` | Current Azure Functions, Cosmos DB, Key Vault, Static Web Apps, Entra ID / MSAL and Application Insights behaviour. |
| `edge/**`, Cloudflare resources in `infra/**` | `cloudflare-docs` — `search_cloudflare_documentation` | Workers, cron triggers, DNS and transform-rule semantics. |
| `infra/**` (a change to a live resource) | `azure` — `role_assignment_list`, `functionapp_get`, `storage_account_get`, `group_resource_list`, `monitor_activitylog_list` | What is deployed *now*, to judge what the diff would do to it: the role assignments an `oidc.tf` edit adds to or removes from, a Function App's current settings names, a storage account's network rules, who last changed the resource. Control-plane reads under a Reader-only identity; no content, no logs. |
| Any PR whose CI is red | `github-mcp-server` — Actions tools (`actions_get`, `actions_list`), code-scanning and Dependabot alert tools | Why the failing job failed, and whether an alert already covers a finding, before writing it up. Read-only on this repository. |

Cite the page or the resource you read in the finding, with the time for a
live read. The `azure` server is the only one that sees the live estate, and
it sees it read-only: it can say what a resource *is*, never what a plan
*would do* — "the plan shows" still comes from evidence in the pull request.
None of these servers reaches the HCP Terraform workspace, the Cloudflare
account, Key Vault contents, Cosmos documents or blob data, and none can write
anywhere; a review comment that suggests otherwise is wrong about its tools.

## 5. Report

Structure the final report as:

1. **Verdict** — one sentence: mergeable as-is, mergeable with nits, or
   blocking findings.
2. **Findings** — most severe first, each with file:line, the failure
   scenario, and a suggested fix.
3. **Verification** — commands run per component and their results; checks
   deliberately skipped and why (e.g. no Azure credentials for a deployed
   smoke check, no TFC token for a real plan).

When asked to review a PR (not just a diff), also check the PR body against
`.github/pull_request_template.md`: the Verification section must list what
was actually run, and the infrastructure section must be filled or removed
appropriately.
