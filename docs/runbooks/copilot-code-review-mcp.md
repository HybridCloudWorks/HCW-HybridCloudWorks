# Copilot code review — MCP servers

> **Status: configuration written, not yet applied.** The file
> `.github/copilot-mcp.json` is the reviewed source of record. GitHub does not
> read it from the repository; the owner pastes its contents into the
> repository's Copilot settings once (procedure below), and again after any
> change to the file lands on `main`.

Every Copilot review in this repository ends with the hint *"Configure MCP
servers for context-aware, tailored reviews."* This page is that
configuration: which Model Context Protocol (MCP) servers the reviewer may
call, why those three, what was deliberately left out, and the exact steps to
turn it on and to prove it is working.

## What this changes

Copilot code review runs in a GitHub-hosted session and, by default, can only
see the pull request and the repository, plus two built-in MCP servers
(GitHub, read-only on this repository, and Playwright). With MCP servers
configured it can also pull reference material into the review — the current
Azure documentation for a Functions setting it is unsure of, the Terraform
Registry page for an `azurerm` argument, the Cloudflare Workers docs for the
availability probe — instead of guessing or staying silent.

The configuration is **shared** with the Copilot cloud agent (the agent that
takes an issue and opens a pull request). Anything enabled here is enabled
there too. GitHub's reference:
[Configure MCP servers for your repository](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)
and [MCP servers and agent skills for code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review#mcp-servers-and-agent-skills).

Two facts from those pages shape every choice below:

- **Copilot calls MCP tools autonomously.** Nothing asks the owner before a
  tool runs. GitHub's own guidance is to allowlist specific read-only tools
  rather than `*`.
- **Copilot is more likely to use the servers when told to.** A
  review-focused skill directory (this repository already has
  `.github/skills/code-review/`) and custom instructions that name the MCP
  context both raise the odds. The skill now carries a section saying which
  server to consult for which component.

## The servers, and why each one

Every server is official (published by the vendor whose product it
documents), read-only, and needs **no credential** — so there is nothing to
store in the `copilot` environment and nothing that can leak.

| Server | Publisher | Transport | Why it is here |
| --- | --- | --- | --- |
| `microsoft-learn` | Microsoft — [Microsoft Learn MCP Server](https://learn.microsoft.com/en-us/training/support/mcp), source at [MicrosoftDocs/mcp](https://github.com/microsoftdocs/mcp) | Remote HTTP, `https://learn.microsoft.com/api/mcp`, no key | The estate is Azure Static Web Apps, Azure Functions (Flex Consumption, Node 22), Cosmos DB serverless, Key Vault, Entra ID and MSAL, Application Insights. A reviewer that can read the current Learn page for `host.json`, a Cosmos consistency setting or an MSAL scope catches drift from documented behaviour instead of asserting from training data. Tools: `microsoft_docs_search`, `microsoft_docs_fetch`, `microsoft_code_sample_search`. |
| `cloudflare-docs` | Cloudflare — [Cloudflare's own MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), source at [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/docs-ai-search) | Remote HTTP, `https://docs.mcp.cloudflare.com/mcp`, no auth | `edge/availability-probe/` is a Worker on a cron trigger ([ADR 0024](../decisions/0024-edge-availability-probe.md)), and `infra/` manages Cloudflare DNS and the transform rules. This is the public documentation server only — not the account API server at `mcp.cloudflare.com`, which is OAuth and would give the reviewer a live account. Tool: `search_cloudflare_documentation`. |
| `terraform` | HashiCorp — [Terraform MCP server](https://developer.hashicorp.com/terraform/mcp-server), source at [hashicorp/terraform-mcp-server](https://github.com/hashicorp/terraform-mcp-server) | Local container `hashicorp/terraform-mcp-server:1.3.0@sha256:423a6b8e2ee0…` (digest-pinned; the full digest is in `.github/copilot-mcp.json`), started by the review session | `infra/` is a single Terraform root module against **live production**. Half of what an infra review checks is "does this argument exist on this provider version, and does changing it force replacement" — exactly what `get_provider_details` answers from the Registry. Restricted to the `registry` toolset and eight read tools (the [tools reference](https://developer.hashicorp.com/terraform/mcp-server/reference)); no `TFE_TOKEN` is passed, so the HCP Terraform workspace, runs, plans and state stay out of reach. The image is pinned by digest, not by tag — a tag can be retargeted, a digest cannot; bump both together, as with every other pinned dependency here. |

The tool allowlist is applied twice for the Terraform server: on the server's
own command line (`--tools=...`, so the container never registers anything
else) and in Copilot's `tools` array (so Copilot never asks for anything
else). Either one alone would be enough; both is the same belt-and-braces the
`iac-validate.yml` guard uses.

### Deliberately not configured

- **Azure MCP Server** (`@azure/mcp`, the GitHub docs' own Azure example).
  It reads live resources in the subscription, so it needs an Azure identity
  with Reader on production handed to an agent that runs without approval.
  The documentation need it would serve is met by Microsoft Learn. Revisit
  only if reviews start needing resource state, and then with `--read-only`
  and OIDC through a `copilot-setup-steps.yml`, per
  [Customize the agent environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment).
- **HCP Terraform access** for the Terraform server (`TFE_TOKEN`). Would
  expose workspace `hcw-azure`'s runs, plan JSON and state metadata to the
  reviewer. Plan evidence belongs in the pull request body, attached by a
  human, as `infra/README.md` already requires.
- **A wider GitHub MCP token.** The built-in server is already read-only on
  this repository, which is all a review of this repository needs.
- **Cloudflare account API server** (`https://mcp.cloudflare.com/mcp`). OAuth
  to the live account; the docs server covers the review use.

## Apply (owner, once — and after every change to the file)

Repository administrator required. Nothing here needs a secret.

1. Check out `main` after the pull request carrying `.github/copilot-mcp.json`
   has merged, and copy the file's contents to the clipboard. PowerShell,
   from the repository root:

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

    **Success looks like:** the page reloads with the three server names
    visible in the box and no red validation message. A failure is a
    validation error naming a key — the fix is in the file, via a pull
    request, not in the box.

4. Confirm the code-review toggle is on. Still under **Settings → Copilot**,
   open **Code review** and check **Allow Copilot to use MCP tools when
   reviewing pull requests** is enabled. It is on by default; this step is
   a read, not a change.

That is the whole procedure. There is no `COPILOT_MCP_*` secret to add
because none of the three servers takes one.

## Verify on the next pull request

1. Open or update any pull request; Copilot reviews it as it does today.
2. On the pull request timeline, the Copilot review entry has a
   **View session** link. Open it and read the **Setting up environment**
   section.

    **Success looks like:** `microsoft-learn`, `cloudflare-docs` and
    `terraform` listed as started, each with its tool list beneath. If
    `terraform` is missing and the other two are present, the session's
    runner could not start the container — read the step's log line; the
    remote servers are unaffected.

3. When a review comment used a server, GitHub prints an attribution at the
   bottom of that comment naming the skill or MCP server. Not every comment
   will carry one; Copilot uses the context "when relevant". A review of a
   docs-only pull request may show none, and that is correct.

The first reviews to watch are an `infra/` change (expect Terraform Registry
attributions) and a `functions/` change (expect Microsoft Learn).

## Change or roll back

- **Change a server or tool:** edit `.github/copilot-mcp.json` in a pull
  request, then repeat *Apply* after the merge. The file, not the settings
  box, is what gets reviewed — a change pasted straight into the box and not
  into the file will be overwritten by the next apply and confuse the next
  reader.
- **Turn MCP off for reviews only:** the toggle in step 4 above. The cloud
  agent keeps the servers.
- **Remove everything:** clear the MCP configuration box and save. The two
  built-in servers remain.

## Related

- [ADR 0026 — required checks filter inside the job](../decisions/0026-required-checks-filter-inside-the-job.md):
  Copilot's review is advisory context for the human merge decision; the
  fourteen required contexts are unchanged by anything on this page.
- `.github/skills/code-review/SKILL.md` — the review skill Copilot loads,
  which now names which server to consult per component.
- [Deployment runbook](deployment-runbook.md) — where plan evidence for
  `infra/` changes is produced, since the reviewer deliberately cannot reach
  HCP Terraform itself.
