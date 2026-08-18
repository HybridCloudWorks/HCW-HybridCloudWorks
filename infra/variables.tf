# =============================================================================
# variables.tf — Azure infrastructure variables
# All sensitive values are set as workspace variables in HCP Terraform Cloud
# Org: HybridCloudWorks | Workspace: hybridcloudworks-azure
#
# Variable names here MUST match TF Cloud workspace variable keys exactly.
# See Variables.md at the repository root for the full variables/secrets catalog.
# =============================================================================

# -----------------------------------------------------------------------------
# Azure Subscription
# -----------------------------------------------------------------------------
variable "azure_subscription_id" {
  description = "Azure subscription ID for all resources"
  type        = string
  sensitive   = true
}

variable "azure_location" {
  description = "Azure region for all resources"
  type        = string
  default     = "southcentralus"
}

variable "environment" {
  description = "Environment name (prod, staging, dev)"
  type        = string
  default     = "prod"
}

# -----------------------------------------------------------------------------
# Naming
# -----------------------------------------------------------------------------
variable "project_name" {
  description = "Project name used in resource naming"
  type        = string
  default     = "hybridcloudworks"
}

variable "resource_group_name" {
  description = "Azure resource group name"
  type        = string
  default     = "rg-hybridcloudworks-prod"
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------
variable "vnet_address_space" {
  description = "Address space for the workload VNet"
  type        = string
  default     = "10.40.0.0/16"
}

variable "functions_subnet_prefix" {
  description = "Address prefix for the Functions Flex integration subnet"
  type        = string
  default     = "10.40.0.0/24"
}

# -----------------------------------------------------------------------------
# Cosmos DB
# -----------------------------------------------------------------------------
variable "cosmos_db_account_name" {
  description = "Cosmos DB account name (globally unique)"
  type        = string
  default     = "hcw-cosmos-prod"
}

variable "cosmos_local_auth_disabled" {
  description = "Disable Cosmos key (local) authentication — AAD/managed-identity only. The durable answer to REVIEW §0.2. Set false only if plan review surfaces a key consumer."
  type        = bool
  default     = true
}

variable "cosmos_allow_azure_datacenter_ips" {
  description = "Include the '0.0.0.0' sentinel in the Cosmos firewall, allowing Azure datacenter IPs. Required while heal-computed-properties runs on GitHub-hosted runners (which are Azure-hosted). Drop when that job moves in-VNet."
  type        = bool
  default     = true
}

variable "cosmos_admin_ip_rules" {
  description = <<-EOT
    Operator IPv4 addresses/CIDRs allowed through the Cosmos firewall, for
    smoke tier 2 or live-data inspection (REVIEW §0.3). Same pattern as
    admin_ip_rules on Key Vault: populate for the window, apply, work, empty
    it, apply again. Empty is the correct steady state.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.cosmos_admin_ip_rules : can(cidrnetmask("${ip}/32")) || can(cidrnetmask(ip))])
    error_message = "cosmos_admin_ip_rules entries must be IPv4 addresses or CIDR ranges."
  }
}

# -----------------------------------------------------------------------------
# Storage
# -----------------------------------------------------------------------------
variable "storage_account_name" {
  description = "Azure Storage account name (globally unique, 3-24 chars, lowercase alphanumeric)"
  type        = string
  default     = "hcwstorageprod"
}

# -----------------------------------------------------------------------------
# Function App
# -----------------------------------------------------------------------------
variable "function_app_name" {
  description = "Azure Function App name (globally unique)"
  type        = string
  default     = "hcw-functions-prod"
}

# -----------------------------------------------------------------------------
# Key Vault
# -----------------------------------------------------------------------------
variable "key_vault_name" {
  description = "Azure Key Vault name (globally unique, 3-24 chars)"
  type        = string
  default     = "hcw-keyvault-prod"
}

variable "purge_protection_enabled" {
  description = "Enable Key Vault purge protection. Set false only during initial dev; must be true before production secrets are written."
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Budget
# -----------------------------------------------------------------------------
variable "budget_amount_usd" {
  description = "Monthly budget ceiling in USD"
  type        = number
  default     = 150
}

variable "budget_alert_email" {
  description = "Email address for budget alert notifications"
  type        = string
}

# -----------------------------------------------------------------------------
# Auth / Entra ID
# -----------------------------------------------------------------------------
variable "entra_tenant_id" {
  description = "Entra ID tenant ID for JWT validation and OIDC deployment"
  type        = string
  sensitive   = true
}

# NOTE: `entra_client_id` was removed here. It fed the ENTRA_CLIENT_ID app
# setting, which the API used as its JWT audience — the single-registration
# model DECISION 3 replaces. Nothing in this configuration consumed it
# afterwards, and leaving a required variable with no consumer forces operators
# to supply a value for nothing. The SPA client id is still needed, but by the
# frontend build, not by this Terraform.

# DECISION 3 — two app registrations: a public-client SPA, and a separate API
# exposing api://<api-client-id>. The API validates `aud` against its OWN
# identifier.
#
# With a single registration an ID token minted for the SPA carries
# aud = <client-id>, indistinguishable from an access token for the API — so a
# token the browser was never meant to send to an API would be accepted by it.
#
# No default, and functions/src/lib/auth/verify-token.js refuses to start
# without it. That is deliberate: jsonwebtoken only applies the audience check
# when `audience` is truthy, so an unset value does not fail — it SKIPS audience
# validation and successfully verifies any Microsoft-signed token for the
# tenant, including a Graph token.
variable "entra_api_audience" {
  description = "Application ID URI of the API registration (e.g. api://<guid>) — validated as the JWT audience"
  type        = string

  validation {
    condition     = length(trimspace(var.entra_api_audience)) > 0
    error_message = "entra_api_audience must not be empty; an empty audience silently disables audience validation."
  }
}

# -----------------------------------------------------------------------------
# GitHub OIDC deployment identities (used for federated credential setup)
# -----------------------------------------------------------------------------
# These two are not cosmetic. They compose the federated credential `subject`
# in oidc.tf, which GitHub's OIDC token must match EXACTLY. A stale value does
# not warn — the token is issued, Azure declines it, and azure/login fails with
# a generic AADSTS70021 "no matching federated identity record found".
#
# Both were stale until now: the repository moved to the HybridCloudWorks org,
# and nothing consumed these variables, so nothing surfaced the drift.
variable "github_org" {
  description = "GitHub organisation owning the repository — must match the OIDC token issuer claim"
  type        = string
  default     = "HybridCloudWorks"
}

variable "github_repo" {
  description = "GitHub repository name (without org prefix) — must match the OIDC token subject claim"
  type        = string
  default     = "HCW-HybridCloudWorks"
}

variable "github_deploy_ref" {
  description = "Git ref allowed to assume the deployment identity. Deploys are gated to this branch."
  type        = string
  default     = "refs/heads/main"
}

# -----------------------------------------------------------------------------
# Key Vault seeding access
# -----------------------------------------------------------------------------
variable "admin_ip_rules" {
  description = <<-EOT
    Public IPv4 addresses or CIDRs permitted to reach Key Vault, for seeding
    secrets by hand as Azure Owner. Empty is the correct steady state: the vault
    is then reachable only by the Function App over its subnet.

    Populate for the seeding window, apply, run the `az keyvault secret set`
    commands, then empty it and apply again. Secret values are never managed by
    Terraform, so they do not enter state or Terraform Cloud.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for ip in var.admin_ip_rules : can(cidrnetmask("${ip}/32")) || can(cidrnetmask(ip))])
    error_message = "admin_ip_rules entries must be IPv4 addresses or CIDR ranges."
  }
}

# -----------------------------------------------------------------------------
# Cloudflare (DNS management)
# -----------------------------------------------------------------------------
variable "cloudflare_api_token" {
  description = "Cloudflare API token — Zone:Read + DNS:Edit scoped to the domain"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for the domain"
  type        = string
}

# -----------------------------------------------------------------------------
# Domain
# -----------------------------------------------------------------------------
variable "domain" {
  description = "Base domain for all services"
  type        = string
  default     = "hybridcloudworks.com"
}

# -----------------------------------------------------------------------------
# Tags
# -----------------------------------------------------------------------------
variable "tags" {
  description = "Default tags applied to all Azure resources"
  type        = map(string)
  default = {
    workload           = "hybridcloudworks"
    environment        = "prod"
    owner              = "platform"
    costCenter         = "content-platform"
    managedBy          = "terraform"
    criticality        = "high"
    dataClassification = "internal"
  }
}
