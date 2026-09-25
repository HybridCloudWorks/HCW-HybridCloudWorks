# =============================================================================
# lab-hybrid.tf — the Azure half of the Hybrid Lab (ADR 0032 decision 3, #664)
# =============================================================================
#
# The lab host itself is a Hostinger VPS, provisioned from the separate
# `hcw-lab` workspace (`infra-lab/`) and onboarded to Azure Arc by Ansible.
# What lives in THIS workspace is only what the production estate needs in
# order to see it:
#
#   - the resource group the Arc machine is onboarded into, and
#   - a Reader grant on that group for the Function App's managed identity, so
#     GET /api/public/labs/estate can read the machine's status through Azure
#     Resource Graph (functions/src/lib/labs/estate.js).
#
# Nothing else. The Arc machine resource is created by `azcmagent connect` on
# the host, under a service principal holding only Azure Connected Machine
# Onboarding on this group (ADR 0032 decision 3; its credential is an Ansible
# Vault entry, never a Terraform value). The data collection rule and the
# machine-configuration policy assignment follow in their own issues.
#
# The role assignment is the whole grant. Resource Graph returns only rows the
# caller can read, and Reader is `*/read` — so the identity can describe this
# group's contents and cannot change them, and cannot see any other group it
# was not already granted. No credential is minted or stored for this path:
# the Function App's system identity signs its own token.

# Not an entry in local.app_resource_groups (main.tf): that map names the
# `site` workload's groups, and this is the `hybrid` workload's, so the name
# takes a different middle segment and the ADR fixes it in full —
# rg-lab-hybrid-prod-cus. It is also a lifecycle boundary of its own: deleting
# the lab must never be "delete rg-web", and vice versa.
resource "azurerm_resource_group" "lab_hybrid" {
  name     = "rg-lab-hybrid-${var.environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = local.tags
}

# Reader on the lab group only. Scoped to the group rather than the machine
# because the machine does not exist until the host is onboarded, and a grant
# on a resource that Terraform does not manage would have nothing to reference.
resource "azurerm_role_assignment" "func_lab_hybrid_reader" {
  scope                = azurerm_resource_group.lab_hybrid.id
  role_definition_name = "Reader"
  principal_id         = azurerm_function_app_flex_consumption.hcw.identity[0].principal_id
}
