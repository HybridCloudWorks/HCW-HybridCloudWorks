# =============================================================================
# backend.tf — HCP Terraform Cloud remote state
# Org: HybridCloudWorks | Workspace: Personal-Site_HCW
# TF Cloud working directory MUST be set to: platform/terraform
# Settings → General → Terraform Working Directory → platform/terraform
# =============================================================================
terraform {
  cloud {
    organization = "HybridCloudWorks"
    workspaces {
      name = "Personal-Site_HCW"
    }
  }
}
