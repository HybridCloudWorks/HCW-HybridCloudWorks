# =============================================================================
# hub.tf — Platform Connectivity: the free half of a hub-and-spoke topology
#
# Everything here has no hourly charge. That is the point, and it is the whole
# scope: a hub virtual network, its address plan, network security groups, a
# route table, and the peering to the HCWSite spoke.
#
# What is DELIBERATELY absent, and why:
#
#   Azure Firewall   ~$288/mo Basic, ~$912/mo Standard
#   Azure Bastion    ~$138/mo
#   VPN Gateway      ~$138/mo
#   DDoS Protection  ~$2,944/mo
#
# The monthly budget for this entire platform is USD 150 (var.budget_amount_usd),
# so any one of those is between roughly one and twenty times the whole budget.
# More to the point, none of them has a job to do yet: there are no virtual
# machines to reach through Bastion, no on-premises network to terminate a VPN
# against, and the Function App egresses through the App Service platform's own
# outbound addresses rather than through this network (see the note on the
# spoke peering below). Buying them now would be paying to inspect traffic that
# does not traverse this hub.
#
# The address space is reserved for them regardless. Carving GatewaySubnet,
# AzureFirewallSubnet and AzureBastionSubnet out of the plan costs nothing
# today and avoids re-addressing the hub later — subnets cannot be resized
# after creation, and a hub with no room for a firewall is a hub that gets
# rebuilt. The subnets themselves are not created; only the ranges are spoken
# for by the address plan in variables.tf.
#
# Reserved subnet names are fixed by Azure and must match exactly
# (GatewaySubnet, AzureFirewallSubnet, AzureBastionSubnet). A prefixed name
# makes the service undeployable, which is why they do not follow the
# repository's naming convention and must not be "corrected" to it.
# =============================================================================

resource "azurerm_resource_group" "platform_conn" {
  provider = azurerm.conn

  name     = "rg-conn-hub-${var.environment}-${var.region_abbreviation}"
  location = var.azure_location
  tags     = var.tags
}

resource "azurerm_virtual_network" "hub" {
  provider = azurerm.conn

  # `plat` in the workload slot: the org token belongs in management-group IDs
  # only, and platform resources take `plat` (Naming-Convention wiki page).
  name                = "vnet-plat-hub-${var.environment}-${var.region_abbreviation}"
  location            = azurerm_resource_group.platform_conn.location
  resource_group_name = azurerm_resource_group.platform_conn.name
  address_space       = [var.hub_address_space]
  tags                = var.tags
}

# A shared-services subnet is the only one with a tenant today. The reserved
# ranges above it stay uncreated until the service that needs them arrives.
resource "azurerm_subnet" "hub_shared" {
  provider = azurerm.conn

  name                 = "snet-plat-shared-${var.environment}-${var.region_abbreviation}"
  resource_group_name  = azurerm_resource_group.platform_conn.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = [var.hub_shared_subnet_prefix]
}

# Default-deny on inbound from outside the virtual network. Azure's own
# default rules already permit VNet-to-VNet and deny Internet inbound; this
# NSG exists so that adding a rule is an edit to an existing, reviewed object
# rather than a decision to create security controls under time pressure.
resource "azurerm_network_security_group" "hub_shared" {
  provider = azurerm.conn

  name                = "nsg-plat-shared-${var.environment}-${var.region_abbreviation}"
  location            = azurerm_resource_group.platform_conn.location
  resource_group_name = azurerm_resource_group.platform_conn.name
  tags                = var.tags
}

resource "azurerm_subnet_network_security_group_association" "hub_shared" {
  provider = azurerm.conn

  subnet_id                 = azurerm_subnet.hub_shared.id
  network_security_group_id = azurerm_network_security_group.hub_shared.id
}

# Empty of routes on purpose. A user-defined route table only earns its keep
# once there is a next hop to point at — today that would be a firewall that
# does not exist. It is created now so the spoke association is already in
# place when one does, because associating a route table later is a change to
# every subnet rather than a change to one object.
resource "azurerm_route_table" "hub" {
  provider = azurerm.conn

  # Named for its job — routing SPOKE traffic through a future hub firewall —
  # which is the row the Naming-Convention Connectivity table gives it.
  name                = "rt-plat-spoke-${var.environment}-${var.region_abbreviation}"
  location            = azurerm_resource_group.platform_conn.location
  resource_group_name = azurerm_resource_group.platform_conn.name
  tags                = var.tags
}

# =============================================================================
# Peering — hub <-> HCWSite spoke
#
# Peering has no hourly charge; it bills per GB in each direction. Nothing
# traverses it today: the Function App reaches Cosmos, Key Vault and Storage
# through service endpoints, which keep traffic on the Azure backbone without
# crossing this peering, and it reaches the internet through the App Service
# platform's outbound addresses rather than through the VNet. So the running
# cost is effectively zero and the value is topological — the shape is correct
# before a second workload arrives, and peering both directions later is two
# more resources to remember rather than one that already exists.
#
# Peering is NOT transitive. A second spoke will reach this one only through a
# network virtual appliance in the hub, which is another reason the address
# space above leaves room for one.
# =============================================================================

resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  provider = azurerm.conn

  name                      = "peer-hub-to-${var.workload_name}"
  resource_group_name       = azurerm_resource_group.platform_conn.name
  virtual_network_name      = azurerm_virtual_network.hub.name
  remote_virtual_network_id = azurerm_virtual_network.hcw.id

  allow_virtual_network_access = true
  allow_forwarded_traffic      = true

  # Both false deliberately. There is no gateway in this hub to share, and
  # allow_gateway_transit on a hub without a gateway is a configuration that
  # reads as intent and does nothing.
  allow_gateway_transit = false
  use_remote_gateways   = false
}

resource "azurerm_virtual_network_peering" "spoke_to_hub" {
  name                      = "peer-${var.workload_name}-to-hub"
  resource_group_name       = azurerm_resource_group.app["conn"].name
  virtual_network_name      = azurerm_virtual_network.hcw.name
  remote_virtual_network_id = azurerm_virtual_network.hub.id

  allow_virtual_network_access = true
  allow_forwarded_traffic      = false

  allow_gateway_transit = false
  use_remote_gateways   = false
}
