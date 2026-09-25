# A payload shaped like the Landing Zone Builder's output: registry sources
# with version constraints, exactly as a learner would download and as the
# `terraform-validate` job receives it. smoke.sh hands this directory to
# hcw-terraform-validate with no network; the script rewrites each module
# below to its vendored copy under /opt/avm and the init must then succeed.
# Nothing here is changed by that: the rewrite happens on the tmpfs copy.
terraform {
  required_version = ">= 1.12"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.4"
    }
    alz = {
      source  = "azure/alz"
      version = "~> 0.21"
    }
  }
}

provider "azurerm" {
  features {}
}

module "management" {
  source  = "Azure/avm-ptn-alz-management/azurerm"
  version = "~> 0.9"

  location                = "centralus"
  resource_group_name     = "rg-alz-management"
  automation_account_name = "aa-alz-management"
}

module "alz" {
  source  = "Azure/avm-ptn-alz/azurerm"
  version = "0.21.0"

  architecture_name  = "alz"
  location           = "centralus"
  parent_resource_id = "root"
}

module "connectivity" {
  source  = "Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm"
  version = ">= 0.17.0, < 0.18.0"
}
