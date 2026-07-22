# =============================================================================
# backend.tf — Terraform Cloud backend for Azure resources
# Org: HybridCloudWorks | Workspace: hybridcloudworks-azure
# =============================================================================
terraform {
  cloud {
    organization = "HybridCloudWorks"
    workspaces {
      name = "hybridcloudworks-azure"
    }
  }
}
