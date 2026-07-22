# =============================================================================
# providers.tf — Provider requirements
# Backend (HCP Terraform Cloud) is declared in backend.tf
# =============================================================================
terraform {
  required_version = ">= 1.5"

  required_providers {
    hostinger = {
      source  = "hostinger/hostinger"
      version = "~> 0.1"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "hostinger" {
  api_token = var.hostinger_api_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
