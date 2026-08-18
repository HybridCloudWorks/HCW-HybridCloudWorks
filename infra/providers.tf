# =============================================================================
# providers.tf — Azure provider requirements
# Backend (HCP Terraform Cloud) is declared in backend.tf
# =============================================================================
terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    # Cloudflare remains for DNS management
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# There is no credential in this block on purpose, and its absence is the
# configuration — not an omission to be "fixed" by adding client_id/secret.
#
# Runs execute in HCP Terraform with dynamic provider credentials. When the
# workspace has TFC_AZURE_PROVIDER_AUTH=true and TFC_AZURE_RUN_CLIENT_ID set,
# HCP Terraform mints a short-lived OIDC token per run phase and exports
# ARM_CLIENT_ID, ARM_OIDC_TOKEN and ARM_USE_OIDC into the run environment; the
# azurerm provider picks those up with no HCL. ARM_TENANT_ID is a plain
# workspace environment variable alongside them.
#
# The identity behind TFC_AZURE_RUN_CLIENT_ID is created ONCE, outside this
# configuration, by scripts/bootstrap-terraform-oidc.ps1 — Terraform cannot
# create the credential Terraform authenticates with. See the Bootstrap section
# of the Deployment Runbook. The GitHub Actions identity in oidc.tf is a
# different handshake and is managed here.
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
  }
  subscription_id = var.azure_subscription_id
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
