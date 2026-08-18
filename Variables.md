# Variables & Secrets Catalog — HCW on Azure

All variables and secrets required to deploy and operate this workload.
Set sensitive values **only** in HCP Terraform Cloud workspace variables or
GitHub repository secrets/variables — never commit actual values.

Legend: 🔴 Secret (sensitive) | 🟡 Variable (non-sensitive) | 🟢 Derived (output from Terraform)

---

## Terraform Cloud Workspace — `hybridcloudworks-azure`

Set these in the HCP Terraform Cloud workspace under **Variables**.

| Name | Type | Sensitive | Description |
|------|------|-----------|-------------|
| `azure_subscription_id` | Terraform | 🔴 Yes | Azure subscription ID |
| `entra_tenant_id` | Terraform | 🔴 Yes | Entra ID tenant ID |
| `cloudflare_api_token` | Terraform | 🔴 Yes | Cloudflare token: Zone:Read + DNS:Edit |
| `budget_alert_email` | Terraform | 🟡 No | Email for budget threshold alerts |
| `entra_client_id` | Terraform | 🟡 No | Entra app registration client ID |
| `cloudflare_zone_id` | Terraform | 🟡 No | Cloudflare Zone ID for the domain |
| `azure_location` | Terraform | 🟡 No | Default: `southcentralus` |
| `budget_amount_usd` | Terraform | 🟡 No | Default: `150` |
| `purge_protection_enabled` | Terraform | 🟡 No | Default: `false` — set `true` before first prod secret write |
| `vnet_address_space` | Terraform | 🟡 No | Default: `10.40.0.0/16` |
| `functions_subnet_prefix` | Terraform | 🟡 No | Default: `10.40.0.0/24` |
| `domain` | Terraform | 🟡 No | Default: `hybridcloudworks.com` |
| `cosmos_db_account_name` | Terraform | 🟡 No | Must be globally unique |
| `storage_account_name` | Terraform | 🟡 No | Must be globally unique, 3-24 chars |
| `function_app_name` | Terraform | 🟡 No | Must be globally unique |
| `key_vault_name` | Terraform | 🟡 No | Must be globally unique, 3-24 chars |

---

## GitHub Repository Secrets (`Settings → Secrets → Actions`)

| Secret Name | Description |
|-------------|-------------|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deployment token (output from Terraform: `swa_token`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service account JSON for data migration only (Phase 4). Deleted after cutover. |

---

## GitHub Repository Variables (`Settings → Variables → Actions`)

Non-sensitive values used by workflows.

| Variable Name | Description | Example |
|---------------|-------------|---------|
| `FUNCTION_APP_HOSTNAME` | Azure Functions hostname for smoke test (output from Terraform: `function_hostname`) | `hcw-functions-prod.azurewebsites.net` |
| `VITE_ENTRA_CLIENT_ID` | Entra ID application client ID (public, safe in browser) | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `VITE_ENTRA_TENANT_ID` | Entra ID tenant ID (public, safe in browser) | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `VITE_SOCIAL_X_URL` | Twitter/X profile URL | `https://x.com/yourhandle` |
| `VITE_SOCIAL_LINKEDIN_URL` | LinkedIn profile URL | `https://linkedin.com/in/yourhandle` |
| `VITE_SOCIAL_GITHUB_URL` | GitHub profile URL | `https://github.com/yourhandle` |

---

## Azure Function App Settings (set by Terraform)

These are set automatically by `infra/main.tf`. Listed here for reference and local dev.

| Setting | Sensitive | Description |
|---------|-----------|-------------|
| `COSMOS_ENDPOINT` | 🟡 No | Cosmos DB account endpoint URL |
| `COSMOS_DATABASE` | 🟡 No | Cosmos DB database name |
| `STORAGE_ACCOUNT_NAME` | 🟡 No | Content storage account name |
| `STORAGE_BLOB_ENDPOINT` | 🟡 No | Blob endpoint URL |
| `STORAGE_QUEUE_ENDPOINT` | 🟡 No | Queue endpoint URL |
| `KEY_VAULT_URI` | 🟡 No | Key Vault vault URI |
| `ENTRA_TENANT_ID` | 🟡 No | Tenant ID for JWT validation |
| `ENTRA_CLIENT_ID` | 🟡 No | Client ID for JWT audience validation |
| `FEATURE_FLAG_SCHEDULERS` | 🟡 No | `"false"` until scheduler business logic is ported. Set `"true"` to enable. |
| `NODE_ENV` | 🟡 No | `production` |

---

## Azure Key Vault Secrets

Secrets stored in Key Vault and accessed by the Function App via managed identity — as app-setting
`@Microsoft.KeyVault(SecretUri=…)` references, except where marked runtime-read.

**Seeded by hand as Azure Owner. The runbook is [Review.md §4.2](Review.md).** There is no
`secret-sync-keyvault.yml` — it was removed rather than finished (disabled, mapping was a literal
`TODO`, held the last static `AZURE_CREDENTIALS` reference, and pushing GitHub secrets into Key
Vault would have duplicated every value into a second store). Earlier revisions of this section
described that workflow as a prerequisite for Phase 3; it is not, and never will be.

**Platform**

| Secret Name | Description |
|-------------|-------------|
| `AWS-ACCESS-KEY-ID` | AWS pricing API; scope the IAM policy to `pricing:GetProducts` only |
| `AWS-SECRET-ACCESS-KEY` | as above |
| `CF-ORIGIN-SECRET` | proves a request arrived via Cloudflare; `client-identity.js` fails closed without it |
| `CLIENT-IP-SALT` | rate-limit key derivation |
| `GCP-SERVICE-ACCOUNT-JSON` | **runtime read** — multi-line JSON blob, kept out of app settings |

**Ported from Site-Main's `defineSecret` bindings**

| Secret Name | Description |
|-------------|-------------|
| `ANTHROPIC-API-KEY` | AI drafting, WAF scoring, architecture section generation |
| `OPENAI-API-KEY` | AI generation fallback |
| `PERPLEXITY-API-KEY` | research and enrichment |
| `REPLICATE-API-KEY` | image generation |
| `FIRECRAWL-API-KEY` | URL ingestion and scraping |
| `LINKIE-API-KEY` | Linkie proxy |
| `YOUTUBE-API-KEY` | `youtubeChannelStats` |
| `PUBLER-API-KEY` | Publer social scheduling proxy and calendar sync |
| `PUBLER-WORKSPACE-ID` | identifier; travels with the key rather than splitting across two stores |
| `KLAVIYO-PRIVATE-KEY` | newsletter subscribe and weekly digest |
| `KLAVIYO-LIST-ID` | identifier; as above |
| `TELEGRAM-BOT-TOKEN` | notifications; webhook secret derives as `sha256(token)` |
| `TELEGRAM-CHAT-ID` | notification target |
| `GITHUB-APP-INSTALLATION-ID` | site-rebuild trigger |
| `GITHUB-APP-PRIVATE-KEY` | **runtime read** — multi-line RSA PEM signed into a JWT, kept out of app settings for the same reason as the GCP JSON |
| `HOSTINGER-API-TOKEN` | VPS control |

**Corrections applied to this table** — it previously called itself authoritative while disagreeing
with both the code and `Review.md`:

- `KLAVIYO-API-KEY` does not exist. Site-Main declares `KLAVIYO_PRIVATE_KEY` **and** `KLAVIYO_LIST_ID`.
- `GITHUB-APP-TOKEN` does not exist. Site-Main declares `GITHUB_APP_INSTALLATION_ID` **and**
  `GITHUB_APP_PRIVATE_KEY`; there is no single "app token."
- `PLAUD-API-KEY` removed. Plaud is an **MCP server entry** (`src/lib/aiEngine.js:110`,
  `https://mcp.plaud.ai/mcp`); its credentials live in the `mcp_servers` collection as
  admin-configured data and migrate as data, not as a deploy secret.
- `SESSIONIZE-API-KEY` removed. Sessionize is a **public profile URL** in site settings
  (`settingsSchema.js:109`, `type: 'url'`). There is no API key.
- Nine real bindings were missing entirely: Anthropic, Perplexity, Replicate, Firecrawl, Linkie,
  YouTube, Hostinger, `PUBLER_WORKSPACE_ID`, `TELEGRAM_CHAT_ID`.

> Add new secrets here **and** to `infra/main.tf`'s `app_settings` before adding them to Key Vault.
> This list is the authoritative index; verify it against
> `grep -rhoE "defineSecret\(['\"][A-Z0-9_]+" functions/` in Site-Main, which is the ground truth
> until that repository is retired.

---

## VPS Agent (Hostinger) — `.env` file (never committed)

The VPS agent on Hostinger **cannot use managed identity**. It uses a dedicated service principal
with the minimum required Cosmos DB RBAC scope. This is the only approved static-credential
exception (documented in Architecture_Plan §5.1 VPS agent note).

| Variable | Description |
|----------|-------------|
| `COSMOS_ENDPOINT` | Cosmos DB account endpoint |
| `COSMOS_DATABASE` | Database name |
| `AZURE_CLIENT_ID` | Service principal client ID (not the app registration — a separate SP) |
| `AZURE_CLIENT_SECRET` | Service principal client secret |
| `AZURE_TENANT_ID` | Tenant ID |
| `COSMOS_DATABASE` | Database name |
| `AGENT_ID` | Unique agent identifier (e.g. `vps-hostinger-01`) |

The service principal must be granted `Cosmos DB Built-in Data Contributor` scoped to the
`lab_jobs` and `lab_agents` containers only — not the entire account.

---

## Local Development (`.env.local` — never committed)

Copy from `.env.local.example` (to be created). Minimum required for local function dev:

```bash
COSMOS_ENDPOINT=https://<account>.documents.azure.com:443/
COSMOS_DATABASE=hybridcloudworks
# For local dev, use az login — DefaultAzureCredential picks it up automatically.
# No COSMOS_KEY needed when using az login.

KEY_VAULT_URI=https://<vault>.vault.azure.net/
ENTRA_TENANT_ID=<tenant-id>
ENTRA_CLIENT_ID=<client-id>
FEATURE_FLAG_SCHEDULERS=false
```

---

## Derived outputs (read from Terraform after apply)

Run `terraform output` after `terraform apply` to get these values.

| Output | Use |
|--------|-----|
| `cosmos_endpoint` | Set `COSMOS_ENDPOINT` in VPS agent `.env` |
| `vault_uri` | Set `KEY_VAULT_URI` for local dev |
| `function_url` | Set as GitHub variable `FUNCTION_APP_HOSTNAME` |
| `swa_token` | Set as GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| `subnet_id` | Reference when adding additional service firewall rules |
