# Copilot code review — MCP servers

> **Status: configuration written, not yet applied.** The file
> `.github/copilot-mcp.json` is the reviewed source of record. GitHub does not
> read it from the repository; the owner pastes its contents into the
> repository's Copilot settings once (procedure below), and again after any
> change to the file lands on `main`. Two of the five servers need one owner
> step each before the paste — a Terraform apply for the Azure identity, a
> fine-grained token for the GitHub server — and the order matters. The owner
> steps are tracked in
> [issue #369](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/369).

Every Copilot review in this repository ends with the hint *"Configure MCP
servers for context-aware, tailored reviews."* This page is that
configuration: which Model Context Protocol (MCP) servers the reviewer may
call, why those five, how the two that touch live systems are kept read-only
without a stored credential, what was deliberately left out, and the exact
steps to turn it on and to prove it is working.

## What this changes

Copilot code review runs in a GitHub-hosted session and, by default, can only
see the pull request and the repository, plus two built-in MCP servers
(GitHub, read-only on this repository, and Playwright). With MCP servers
configured it can also pull reference material and live state into the
review — the current Azure documentation for a Functions setting, the
Terraform Registry page for an `azurerm` argument, the Cloudflare Workers docs
for the availability probe, the role assignments actually present on a
resource group, the CI run that failed on the pull request — instead of
guessing or staying silent.

The configuration is **shared** with the Copilot cloud agent (the agent that
takes an issue and opens a pull request), and so is the setup-steps workflow
below. Anything enabled here is enabled there too. GitHub's reference:
[Configure MCP servers for your repository](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers),
[MCP servers and agent skills for code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review#mcp-servers-and-agent-skills)
and [Customizing Copilot code review's environment](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review#customizing-copilot-code-reviews-environment).

Three facts from those pages shape every choice below:

- **Copilot calls MCP tools autonomously.** Nothing asks the owner before a
  tool runs. GitHub's own guidance is to allowlist specific read-only tools
  rather than `*`. A review comment is also untrusted input to the reviewer,
  so every principal it can act as must be one that can change nothing.
- **Copilot code review runs `copilot-setup-steps.yml` before it starts**, in
  the same Actions-hosted environment the cloud agent uses. That is how an
  Azure sign-in reaches the Azure MCP Server without any secret being stored:
  the job exchanges its GitHub OIDC token for an Azure token, exactly as the
  deploy and monitor workflows do.
- **Copilot is more likely to use the servers when told to.** A
  review-focused skill directory (`.github/skills/code-review/`) and custom
  instructions that name the MCP context both raise the odds. The skill
  carries a section saying which server to consult for which component.

## The servers, and why each one

Every server is official (published by the vendor whose product it
documents or exposes) and read-only. Three need no credential at all. The two
that reach live systems — Azure and GitHub — are covered in their own
sections, because how they authenticate is the whole point.

| Server | Publisher | Transport | Why it is here |
| --- | --- | --- | --- |
| `microsoft-learn` | Microsoft — [Microsoft Learn MCP Server](https://learn.microsoft.com/en-us/training/support/mcp), source at [MicrosoftDocs/mcp](https://github.com/microsoftdocs/mcp) | Remote HTTP, `https://learn.microsoft.com/api/mcp`, no key | The estate is Azure Static Web Apps, Azure Functions (Flex Consumption, Node 22), Cosmos DB serverless, Key Vault, Entra ID and MSAL, Application Insights. A reviewer that can read the current Learn page for `host.json`, a Cosmos consistency setting or an MSAL scope catches drift from documented behaviour instead of asserting from training data. Tools: `microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search`. |
| `cloudflare-docs` | Cloudflare — [Cloudflare's own MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), source at [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/docs-ai-search) | Remote HTTP, `https://docs.mcp.cloudflare.com/mcp`, no auth | `edge/availability-probe/` is a Worker on a cron trigger ([ADR 0024](../decisions/0024-edge-availability-probe.md)), and `infra/` manages Cloudflare DNS and the transform rules. This is the public documentation server only — not the account API server at `mcp.cloudflare.com`, which is OAuth and would give the reviewer a live account. Tool: `search_cloudflare_documentation`. |
| `terraform` | HashiCorp — [Terraform MCP server](https://developer.hashicorp.com/terraform/mcp-server), source at [hashicorp/terraform-mcp-server](https://github.com/hashicorp/terraform-mcp-server) | Local container `hashicorp/terraform-mcp-server:1.3.0@sha256:423a6b8e2ee0…` (digest-pinned; the full digest is in `.github/copilot-mcp.json`), started by the review session | `infra/` is a single Terraform root module against **live production**. Half of what an infra review checks is "does this argument exist on this provider version, and does changing it force replacement" — exactly what `get_provider_details` answers from the Registry. Restricted to the `registry` toolset and eight read tools (the [tools reference](https://developer.hashicorp.com/terraform/mcp-server/reference)); no `TFE_TOKEN` is passed, so the HCP Terraform workspace, runs, plans and state stay out of reach. The image is pinned by digest, not by tag — a tag can be retargeted, a digest cannot; bump both together, as with every other pinned dependency here. |
| `azure` | Microsoft — [Azure MCP Server](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/), source at [microsoft/mcp](https://github.com/microsoft/mcp/tree/main/servers/Azure.Mcp.Server), package [`@azure/mcp`](https://www.npmjs.com/package/@azure/mcp) | Local, `npx @azure/mcp@3.0.0-beta.41`, started by the review session; signs in through the Azure CLI session `copilot-setup-steps.yml` leaves behind | Lets the reviewer check a Terraform or Functions change against what is actually deployed: the role assignments on a resource group, a Function App's current configuration, the activity log for the resource a PR touches, a storage account's network rules. See [The Azure server](#the-azure-server-read-only-federated-no-secret) for the identity and the fourteen tools. |
| `github-mcp-server` | GitHub — [GitHub MCP Server](https://github.com/github/github-mcp-server), remote endpoint documented in [remote-server.md](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) | Remote HTTP, `https://api.githubcopilot.com/mcp/readonly`, toolsets pinned by header | Replaces the built-in GitHub server's default toolsets with a wider **read-only** set on **this repository only**: Actions (why did the CI job on this PR fail), code scanning and Dependabot alerts, discussions, plus the default repos, issues and pull requests. See [The GitHub server](#the-github-server-wider-read-only-still-one-repository) for the token and its scope. |

The tool allowlist is applied twice for the Terraform and Azure servers: on
the server's own command line (`--tools=...` / `--tool ...`, so the process
never registers anything else) and in Copilot's `tools` array (so Copilot
never asks for anything else). Either one alone would be enough; both are the
same belt-and-braces the `iac-validate.yml` guard uses.

### The Azure server: read-only, federated, no secret

**Why this is safe to hand to an autonomous reviewer**, in four layers, each
of which holds on its own:

1. **The identity can change nothing.** `github_copilot_review` in
   `infra/oidc.tf` is a new user-assigned managed identity holding **Reader**
   on the four workload resource groups (`rg-web-site-prod-cus`,
   `rg-db-site-prod-cus`, `rg-stor-site-prod-cus`, `rg-sec-site-prod-cus`)
   and nothing else. Reader is `*/read`: control-plane reads only. It carries
   no data action and no `list*/action`, so it cannot list storage keys,
   Cosmos keys, Function App settings or Key Vault secrets, and cannot read a
   blob, a document or a secret. It is deliberately **not** the existing
   `github_reader` identity, which holds a config write on the Function App
   for the deploy-time origin window.
2. **There is no stored credential to leak.** `copilot-setup-steps.yml` runs
   `azure/login` under OIDC in the `copilot` environment; the identity's
   federated credential trusts exactly the subject
   `repo:HybridCloudWorks/HCW-HybridCloudWorks:environment:copilot` (in both
   the name and immutable-ID forms, like every credential in this estate).
   No ref-form credential exists on it, so no branch-triggered workflow can
   assume it by accident. The three values the workflow needs
   (`COPILOT_REVIEW_CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`) are repository
   **variables** — identifiers that grant nothing without a token, per
   [Variables and secrets](../standards/variables-and-secrets.md).
3. **The server refuses writes.** `--read-only` on the command line drops
   every mutating tool before the server registers anything.
4. **The tool list is fourteen names, chosen by hand** from the server's own
   metadata (`readOnly`, `secret`), pinned with `--tool` on the command line
   and again in Copilot's allowlist. Everything that reads *content* is out —
   Cosmos item query/search, blob get, Key Vault secret/key/certificate get,
   app-settings get, and every Log Analytics or Application Insights **log
   query** tool, since telemetry is readable under Reader. What is in:

    | Tool | Reads |
    | --- | --- |
    | `subscription_list`, `group_list`, `group_resource_list` | Inventory: what exists, in which group |
    | `role_assignment_list` | RBAC on a scope — the thing an `oidc.tf` review most needs to see live |
    | `functionapp_get`, `appservice_webapp_get`, `appservice_webapp_deployment_get` | Function App and site configuration, deployment history |
    | `storage_account_get`, `storage_blob_container_get` | Account and container properties (network rules, public access, versioning) — not blob content |
    | `cosmos_list` | Cosmos accounts (control plane) — not documents |
    | `monitor_activitylog_list` | Who changed what, when, on a resource |
    | `monitor_metrics_definitions`, `monitor_metrics_query`, `monitor_webtests_get` | Metrics and availability-test definitions — numbers, not log rows |

    `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` pins the credential chain to
    the CLI session, so the server cannot fall through to any other
    credential that happens to be on the runner.

**What Reader can still see, said plainly:** resource configuration and
tags, role assignments, metrics, and the activity log. Application Insights
*telemetry* is technically readable under Reader too, which is why no
log-query tool is enabled — and the telemetry is content-free by policy
regardless (correlation identifiers, no payloads).

**Known uncertainty.** GitHub's documentation says code review reuses
`copilot-setup-steps.yml`; a community thread from August 2026
([#203859](https://github.com/orgs/community/discussions/203859)) reports
the setup steps not running for reviews, unresolved. The failure mode is
safe: without the sign-in the Azure server starts with no credential and
every tool call fails closed, and the other four servers are unaffected. The
*Verify* section says how to tell which case you are in.

### The GitHub server: wider read-only, still one repository

The built-in GitHub MCP server already gives the reviewer read-only access to
this repository with a token GitHub scopes per review. What it does not give
is the **Actions** toolset (workflow runs and job logs — "why is this PR's CI
red"), **code scanning** and **Dependabot** alerts, or **discussions**. GitHub's
documented way to widen it is a personal access token stored as the Agents
secret `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN`, which Copilot uses for the
`github-mcp-server` entry ([Customizing the built-in GitHub MCP server](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers#customizing-the-built-in-github-mcp-server)).

Kept narrow in four ways:

- **Endpoint**: `https://api.githubcopilot.com/mcp/readonly`. The `/readonly`
  path drops every write tool server-side, whatever the token could do.
- **Toolsets**: the `X-MCP-Toolsets` header names `context, repos, issues,
  pull_requests, actions, code_security, dependabot, discussions`. Not
  `secret_protection` (alert locations and partial values), not `orgs`,
  `users`, `notifications` or `gists` (the token holder's own account), not
  `copilot` (would let the reviewer start agent sessions).
- **Token**: a **fine-grained** personal access token, resource owner
  `HybridCloudWorks`, repository access **only** `HCW-HybridCloudWorks`, with
  exactly the read permissions those toolsets need (listed in *Apply*), and a
  **90-day expiry**. No classic token: a classic `repo` scope is read-write on
  every repository the holder can reach.
- **Store**: an Agents secret, which only MCP servers can read (the
  `COPILOT_MCP_` prefix keeps it out of the agent's own environment). The
  entry wires it in explicitly, as
  `"Authorization": "Bearer $COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN"` in
  its `headers` — GitHub's own example relies on the secret's name alone,
  but an explicit header is the documented substitution mechanism, works
  either way, and makes the wiring visible to a reader of the file. While
  the secret is absent the header carries no usable token and the server
  fails to authenticate; the built-in per-review token is not a fallback for
  this entry, which is why step 4 comes before step 5.

**The honest trade-off.** This is the one long-lived, user-bound credential in
the whole configuration. Reads happen as the token's owner, it must be
re-issued every 90 days, and GitHub's own docs are the only path to the
wider toolsets. If that cost is not worth "Copilot can read the failing CI
job", delete the `github-mcp-server` entry from the file and the built-in
server continues exactly as today. It is included because the CI-failure
context is the single most common thing a reviewer of this repository needs
that it cannot see.

### Deliberately not configured

- **HCP Terraform access** for the Terraform server (`TFE_TOKEN`). Would
  expose workspace `hcw-azure`'s runs, plan JSON and state metadata to the
  reviewer. Plan evidence belongs in the pull request body, attached by a
  human, as `infra/README.md` already requires.
- **Any data-plane Azure role, and any Azure log-query tool.** Content is
  not context. A reviewer needs to know a container's network rules, not what
  is in it.
- **Reader on the Management subscription or the `conn` group.** The central
  Log Analytics workspace and the spoke network are out of scope for a code
  review, and out of reach for this identity.
- **Cloudflare account API server** (`https://mcp.cloudflare.com/mcp`). OAuth
  to the live account; the docs server covers the review use.
- **A classic GitHub token, or a fine-grained one with organisation-wide
  repository access.**

## Apply (owner)

Repository administrator, Azure Owner on the application subscription (for
the apply approval), and `gh` and `az` signed in. Do the steps in this
order — the paste is last because two servers depend on what comes before.
The same list, as checkboxes, is
[issue #369](https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/issues/369).

### 1. Merge, then approve the Terraform apply

Merging the pull request queues a plan on the `hcw-azure` workspace. Approve
it at <https://app.terraform.io/app/hcw/workspaces/hcw-azure/runs>.

**Success looks like:** the known permanent diff (3 to add, 1 to change, 3
to destroy — the `RUNTIME_CONFIG_WRITER` strip, see
`scripts/assert-expected-plan.mjs`) **plus exactly seven adds**: one
`azurerm_user_assigned_identity`, two `azurerm_federated_identity_credential`,
four `azurerm_role_assignment` (Reader on `web`, `db`, `stor`, `sec`).
Nothing else changes or is destroyed. Any other destroy is a reason to stop
and read the plan, not to approve it.

### 2. Seed the client-id variable

PowerShell, from the repository root on `main`. The script reads the
`copilot_review_client_id` output from the workspace's applied state and
upserts it alongside the variables it already manages:

```powershell
git checkout main; git pull origin main; ./scripts/set-github-variables.ps1
```

**Success looks like:** a line naming `COPILOT_REVIEW_CLIENT_ID` and a GUID.
It is a variable, not a secret — the value is printed on purpose.

### 3. Prove the sign-in, before Copilot has to

PowerShell:

```powershell
gh workflow run copilot-setup-steps.yml --repo HybridCloudWorks/HCW-HybridCloudWorks; Start-Sleep -Seconds 20; gh run list --repo HybridCloudWorks/HCW-HybridCloudWorks --workflow copilot-setup-steps.yml --limit 1
```

**Success looks like:** the run is `completed success` and its single step,
*Azure Login*, prints the subscription it signed into. **The failure that
matters** is `AADSTS700213: No matching federated identity record found` —
the subject GitHub presented does not match what Entra trusts. Compare the
subject quoted in the error against the workspace's `federated_subjects`
output (Outputs tab on the workspace page above); the two `:environment:copilot`
entries must be there. A login failure complaining about an empty `client-id`
means step 2 did not land.

### 4. Create the GitHub token and store it

1. Open <https://github.com/settings/personal-access-tokens/new> and create
   a **fine-grained** token:
    - **Resource owner:** `HybridCloudWorks`.
    - **Expiration:** 90 days. Put the date in a calendar; GitHub also emails
      a week before.
    - **Repository access:** *Only select repositories* →
      `HCW-HybridCloudWorks`.
    - **Repository permissions**, all **Read-only**: Actions, Code scanning
      alerts, Contents, Dependabot alerts, Discussions, Issues, Metadata
      (selected automatically), Pull requests. Nothing under *Account
      permissions*.
2. If the organisation restricts fine-grained tokens, approve it at
   <https://github.com/organizations/HybridCloudWorks/settings/personal-access-tokens>.
3. Store it as an **Agents** secret named
   `COPILOT_MCP_GITHUB_PERSONAL_ACCESS_TOKEN`. In the repository, **Settings →
   Secrets and variables → Agents → Secrets → New repository secret** (the
   Agents tab sits beside the Actions tab at
   <https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/secrets/actions>).
   `gh secret set` cannot write this store, so this one is a browser step.

**Success looks like:** the secret listed under Agents with that exact name.
The name is load-bearing: Copilot looks for it verbatim.

### 5. Paste the MCP configuration

1. Copy the file's contents to the clipboard. PowerShell, from the
   repository root:

    ```powershell
    git checkout main; git pull origin main; Get-Content -Raw .github/copilot-mcp.json | Set-Clipboard
    ```

    The same in Git Bash, if that is the window open:

    ```bash
    git checkout main && git pull origin main && cat .github/copilot-mcp.json | clip
    ```

2. Open the repository's Copilot MCP settings. The page is reached from
   **Settings → Code, planning, and automation → Copilot → MCP servers**;
   the deep link that has carried this configuration is
   <https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/settings/copilot/coding_agent>
   (GitHub moved the setting to a shared "MCP servers" page and says
   existing configurations were migrated; if that URL lands elsewhere, use
   the menu path).
3. In **MCP configuration**, replace whatever is in the box with the
   clipboard contents and click **Save MCP configuration**. GitHub validates
   the JSON on save.

    **Success looks like:** the page reloads with the five server names
    visible in the box and no red validation message. A failure is a
    validation error naming a key — the fix is in the file, via a pull
    request, not in the box.

4. Confirm the code-review toggle is on. Still under **Settings → Copilot**,
   open **Code review** and check **Allow Copilot to use MCP tools when
   reviewing pull requests** is enabled. It is on by default; this step is
   a read, not a change.

The Copilot firewall does not apply to MCP servers or to setup steps
([Customize the firewall](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-the-firewall)),
so no allowlist entry is needed for `learn.microsoft.com`,
`docs.mcp.cloudflare.com`, Docker Hub, npm or `management.azure.com`.

## Verify on the next pull request

1. Open or update any pull request; Copilot reviews it as it does today.
2. On the pull request timeline, the Copilot review entry has a
   **View session** link. Open it and read the **Setting up environment**
   section.

    **Success looks like:** the `copilot-setup-steps` job listed as run with
    *Azure Login* green, then `microsoft-learn`, `cloudflare-docs`,
    `terraform`, `azure` and `github-mcp-server` listed as started, each with
    its tool list beneath — fourteen tools under `azure`. If `terraform` is
    missing and the rest are present, the runner could not start the
    container; if `azure` started but the setup job is absent, you are in the
    [known uncertainty](#the-azure-server-read-only-federated-no-secret) case
    and every Azure tool call in the session log will show an authentication
    failure — nothing is exposed, and the other servers still work.

3. When a review comment used a server, GitHub prints an attribution at the
   bottom of that comment naming the skill or MCP server. Not every comment
   will carry one; Copilot uses the context "when relevant". A review of a
   docs-only pull request may show none, and that is correct.

The first reviews to watch are an `infra/` change (expect Terraform Registry
and `azure` attributions — `role_assignment_list` on an `oidc.tf` change is
the canonical one) and a `functions/` change (expect Microsoft Learn).

## Change or roll back

- **Change a server or tool:** edit `.github/copilot-mcp.json` in a pull
  request, then repeat step 5 after the merge. The file, not the settings
  box, is what gets reviewed — a change pasted straight into the box and not
  into the file will be overwritten by the next apply and confuse the next
  reader.
- **Widen or narrow what Azure shows:** the tool list in the file and the
  role assignments in `infra/oidc.tf` are the two dials; a wider tool with no
  role behind it fails closed, a wider role with no tool to use it is inert.
  Change both in one pull request, with the reason in the commit.
- **Turn MCP off for reviews only:** the toggle in step 5.4. The cloud agent
  keeps the servers.
- **Revoke the Azure access outright:** remove the `github_copilot_review`
  resources from `infra/oidc.tf` in a pull request (four role assignments,
  two credentials, one identity — seven destroys, the plan should show
  nothing else) and delete `COPILOT_REVIEW_CLIENT_ID`. The workflow then
  fails at login and the server fails closed.
- **Revoke the GitHub token:** delete it at
  <https://github.com/settings/personal-access-tokens> and delete the Agents
  secret. The `github-mcp-server` entry then fails to authenticate; remove it
  from the file to fall back to the built-in server.
- **Remove everything:** clear the MCP configuration box and save. The two
  built-in servers remain.

## Related

- [ADR 0026 — required checks filter inside the job](../decisions/0026-required-checks-filter-inside-the-job.md):
  Copilot's review is advisory context for the human merge decision; the
  fourteen required contexts are unchanged by anything on this page.
- [Variables and secrets](../standards/variables-and-secrets.md) — why the
  client id is a variable and the token is the one justified secret;
  [Required inputs §4.2–4.4](../standards/required-inputs.md) — the live
  inventory of both.
- `.github/skills/code-review/SKILL.md` — the review skill Copilot loads,
  which names which server to consult per component.
- [Deployment runbook](deployment-runbook.md) — where plan evidence for
  `infra/` changes is produced, since the reviewer deliberately cannot reach
  HCP Terraform itself.
