# =============================================================================
# network.tf — the spoke virtual network, the Functions integration subnet,
# and its network security group.
#
# Split out of main.tf on 2026-08-29 (T-754). Terraform reads every .tf file in
# this directory as ONE module: same namespace, same state, same plan. Nothing
# moved between states and no resource address changed — an empty plan is the
# proof, and `functions/test/terraform-source.js` is why the text-reading guards
# did not need to care.
# =============================================================================

# =============================================================================
# Workload VNet + Flex Consumption integration subnet
#
# Flex Consumption requires a /27 minimum subnet delegated to
# Microsoft.App/environments. /24 leaves room for growth.
# Service firewalls on Cosmos, Storage, and Key Vault are scoped
# to this subnet's CIDR (ADR-001, 2026-07-30).
# =============================================================================
resource "azurerm_virtual_network" "hcw" {
  name                = "vnet-${var.workload_name}-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["conn"].location
  resource_group_name = azurerm_resource_group.app["conn"].name
  address_space       = [var.vnet_address_space]
  tags                = local.tags
}

resource "azurerm_subnet" "functions_integration" {
  # This used to omit the region on the reasoning that a subnet is a child of
  # its VNet, which already carries it. CAF disagrees, and CAF wins here: its
  # example format is snet-<purpose>-<region>-<###>, region included, for the
  # same reason vnet carries it — subnet names show up in firewall rules, VNet
  # rules and support tickets detached from their parent, and a reader should
  # not have to walk up the tree to learn where the thing is.
  name                 = "snet-${var.workload_name}-func-${var.environment}-${var.region_abbreviation}-${var.instance}"
  resource_group_name  = azurerm_resource_group.app["conn"].name
  virtual_network_name = azurerm_virtual_network.hcw.name
  address_prefixes     = [var.functions_subnet_prefix]

  # REQUIRED for the Key Vault network rule below to have any effect.
  #
  # azurerm_key_vault.hcw sets network_acls.default_action = "Deny" and allows
  # this subnet via virtual_network_subnet_ids. A Key Vault VNet rule only
  # grants access when the subnet carries the Microsoft.KeyVault service
  # endpoint — without it the rule is inert and the vault denies the Function
  # App as well as everyone else.
  #
  # The failure mode is quiet: the app deploys clean, then its
  # @Microsoft.KeyVault(...) app-setting references fail to resolve and
  # getSecret() returns nothing, so a missing credential looks like missing
  # data rather than a network denial.
  # Microsoft.AzureCosmosDB is the same story for the Cosmos account's VNet
  # rule (T-504), and Microsoft.Storage for both storage accounts' rules
  # (content account, and the Functions host account since T-503): without
  # the endpoint the rule is inert and the firewall denies the Function App
  # along with everyone else.
  #
  # azurerm 5.0 removed the service_endpoints list in favour of repeated
  # service_endpoint blocks. Generated from a variable rather than written out
  # three times: the set is a deployment input — private endpoints would change
  # this posture, and a new VNet-ruled service appends to it — so it belongs
  # somewhere a tfvars file can reach.
  dynamic "service_endpoint" {
    for_each = toset(var.functions_subnet_service_endpoints)
    content {
      service = service_endpoint.value
    }
  }

  delegation {
    name = "flex-consumption"
    service_delegation {
      name = "Microsoft.App/environments"
      # `join/action`, which is what Azure actually assigns for this
      # delegation — the action set belongs to the service, not to us. Naming
      # anything else produces a plan that never converges: Terraform writes
      # the value, Azure replaces it with its own, and the next plan proposes
      # the same in-place update forever. Verify with:
      #   az network vnet subnet show ... --query "delegations[].actions"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

# The spoke's half of the same argument hub.tf makes for nsg-plat-shared: this
# NSG exists so that adding a rule is an edit to an existing, reviewed object
# rather than a decision to create security controls under time pressure. The
# integration subnet was the one subnet in the estate with no NSG at all
# (`networkSecurityGroup: null` on the live subnet, 2026-08-24), which is the
# state that makes "add a deny rule" a four-step change during an incident.
#
# EMPTY OF CUSTOM RULES, AND THAT IS THE WHOLE DESIGN. Azure's default rules
# still apply and are what this subnet needs: VNet-to-VNet in and out allowed,
# Azure Load Balancer in allowed, Internet in denied, Internet out allowed.
# Nothing about the running app changes. Inbound HTTP does not arrive here —
# it arrives at the App Service front end and the subnet carries only the app's
# OUTBOUND traffic — so the Internet-inbound deny costs nothing, and the
# Internet-outbound allow is what the app needs to reach the external model and
# ingest APIs it exists to call.
#
# Do NOT add an outbound deny here without first enumerating those APIs. The
# failure mode is a handler that hangs until its timeout rather than one that
# errors, which reads as a slow provider rather than as a blocked egress.
#
# Rollback if the app misbehaves after this lands is deleting the association
# (not the NSG); an unassociated NSG affects nothing.
resource "azurerm_network_security_group" "functions_integration" {
  name                = "nsg-${var.workload_name}-func-${var.environment}-${var.region_abbreviation}-${var.instance}"
  location            = azurerm_resource_group.app["conn"].location
  resource_group_name = azurerm_resource_group.app["conn"].name
  tags                = local.tags
}

resource "azurerm_subnet_network_security_group_association" "functions_integration" {
  subnet_id                 = azurerm_subnet.functions_integration.id
  network_security_group_id = azurerm_network_security_group.functions_integration.id
}
