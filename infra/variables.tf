# =============================================================================
# variables.tf — Azure infrastructure variables
# All sensitive values are set as workspace variables in HCP Terraform Cloud
# Org: HybridCloudWorks | Workspace: hybridcloudworks-azure
#
# Variable names here MUST match TF Cloud workspace variable keys exactly.
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
  description = "Azure region for all resources (East US 2 for best latency to central US audience)"
  type        = string
  default     = "eastus2"
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
# Cosmos DB
# -----------------------------------------------------------------------------
variable "cosmos_db_account_name" {
  description = "Cosmos DB account name (globally unique)"
  type        = string
  default     = "hcw-cosmos-prod"
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

# -----------------------------------------------------------------------------
# Cloudflare (DNS management — shared with root terraform)
# -----------------------------------------------------------------------------
variable "cloudflare_api_token" {
  description = "Cloudflare API token — Zone:Read + DNS:Edit scoped to hybridcloudworks.com"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare Zone ID for hybridcloudworks.com"
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
    project     = "hybridcloudworks"
    environment = "prod"
    managed_by  = "terraform"
    migrated_from = "firebase"
  }
}
