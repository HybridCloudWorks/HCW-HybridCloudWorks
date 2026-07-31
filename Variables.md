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
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | SWA deployment token (output from Terraform: `static_web_app_api_key`) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase service account JSON for data migration only (Phase 4). Deleted after cutover. |

---

## GitHub Repository Variables (`Settings → Variables → Actions`)

Non-sensitive values used by workflows.

| Variable Name | Description | Example |
|---------------|-------------|---------|
| `FUNCTION_APP_HOSTNAME` | Azure Functions hostname for smoke test (output from Terraform: `azure_functions_hostname`) | `hcw-functions-prod.azurewebsites.net` |
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
| `COSMOS_CONNECTION_STRING` | 🔴 Yes | Required by Cosmos DB change-feed trigger binding only. Not used by application code — application code uses managed identity via `DefaultAzureCredential`. |
| `STORAGE_ACCOUNT_NAME` | 🟡 No | Content storage account name |
| `STORAGE_BLOB_ENDPOINT` | 🟡 No | Blob endpoint URL |
| `STORAGE_QUEUE_ENDPOINT` | 🟡 No | Queue endpoint URL |
| `KEY_VAULT_URI` | 🟡 No | Key Vault vault URI |
| `ENTRA_TENANT_ID` | 🟡 No | Tenant ID for JWT validation |
| `ENTRA_CLIENT_ID` | 🟡 No | Client ID for JWT audience validation |
| `FEATURE_FLAG_SCHEDULERS` | 🟡 No | `"false"` until scheduler business logic is ported. Set `"true"` to enable. |
| `NODE_ENV` | 🟡 No | `production` |

---

## Azure Key Vault Secrets (seeded via `secret-sync-keyvault.yml`)

Secrets stored in Key Vault and accessed at runtime by the Function App via managed identity.
The workflow `secret-sync-keyvault.yml` must be implemented and run before Phase 3 begins.

| Secret Name | Description |
|-------------|-------------|
| `TELEGRAM-BOT-TOKEN` | Telegram Bot API token (also used to derive webhook secret: `sha256(token)`) |
| `OPENAI-API-KEY` | OpenAI API key (if using external OpenAI rather than Azure OpenAI) |
| `PUBLER-API-KEY` | Publer social scheduling API key |
| `KLAVIYO-API-KEY` | Klaviyo mailing list API key |
| `PLAUD-API-KEY` | Plaud recording service API key |
| `GITHUB-APP-TOKEN` | GitHub App token for content pipeline integrations |
| `SESSIONIZE-API-KEY` | Sessionize speaker events API key |

> Add new secrets here before adding them to Key Vault. This list is the authoritative index.

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
| `cosmos_db_endpoint` | Set `COSMOS_ENDPOINT` in VPS agent `.env` |
| `key_vault_uri` | Set `KEY_VAULT_URI` for local dev |
| `function_app_url` | Set as GitHub variable `FUNCTION_APP_HOSTNAME` |
| `static_web_app_api_key` | Set as GitHub secret `AZURE_STATIC_WEB_APPS_API_TOKEN` |
| `functions_subnet_id` | Reference when adding additional service firewall rules |
