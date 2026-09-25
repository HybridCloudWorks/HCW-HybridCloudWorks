/**
 * One spoke (#667): the resource group, the optional route table whose
 * default route points at the firewall, and the virtual network from
 * avm-res-network-virtualnetwork with one workload subnet and a two-way
 * peering to the hub. Identity, corp and online spokes are all this shape;
 * `routeToFirewall` is what makes a spoke private.
 *
 * The module's inputs are its current ones: `parent_id` is the resource
 * group id (the module is azapi-based and takes no `resource_group_name`),
 * `address_space` is a set, `subnets[].route_table.id` attaches the table,
 * and `peerings[].create_reverse_peering` writes the hub side too. The hub
 * side references are the connectivity module's outputs
 * `virtual_network_resource_ids` and `firewall_private_ip_addresses`, both
 * keyed by hub, and the hub is `primary`.
 */
import { block, moduleSource, obj, q } from './format';

const HUB_VNET_ID = 'module.connectivity.virtual_network_resource_ids["primary"]';
const FIREWALL_IP = 'module.connectivity.firewall_private_ip_addresses["primary"]';

function resourceGroup(key, name) {
  return block(`resource "azurerm_resource_group" "spoke_${key}"`, [
    ['provider', `azurerm.${key}`],
    '',
    ['location', 'var.location'],
    ['name', q(`rg-alz-${name}-\${var.location}`)],
  ]);
}

function routeTable(key, name) {
  return block(`resource "azurerm_route_table" "spoke_${key}"`, [
    ['provider', `azurerm.${key}`],
    '',
    ['location', 'var.location'],
    ['name', q(`rt-alz-${name}-\${var.location}`)],
    ['resource_group_name', `azurerm_resource_group.spoke_${key}.name`],
    ['bgp_route_propagation_enabled', 'false'],
    '',
    ...block('route', [
      ['name', q('default-via-firewall')],
      ['address_prefix', q('0.0.0.0/0')],
      ['next_hop_type', q('VirtualAppliance')],
      ['next_hop_in_ip_address', FIREWALL_IP],
    ]),
  ]);
}

function workloadSubnet(key, addressSpace, routeToFirewall) {
  const subnet = [
    ['name', q('snet-workload')],
    ['address_prefixes', `[${addressSpace}]`],
  ];
  if (routeToFirewall)
    subnet.push(['route_table', obj([['id', `azurerm_route_table.spoke_${key}.id`]])]);
  return obj([['workload', obj(subnet)]]);
}

function hubPeering(name) {
  return obj([
    [
      'hub',
      obj([
        ['name', q(`peer-${name}-to-hub`)],
        ['remote_virtual_network_resource_id', HUB_VNET_ID],
        ['allow_forwarded_traffic', 'true'],
        ['create_reverse_peering', 'true'],
        ['reverse_name', q(`peer-hub-to-${name}`)],
        ['reverse_allow_forwarded_traffic', 'true'],
      ]),
    ],
  ]);
}

function virtualNetwork(key, name, addressSpace, routeToFirewall) {
  return block(`module "spoke_${key}"`, [
    ...moduleSource('avm-res-network-virtualnetwork'),
    '',
    ['location', 'var.location'],
    ['name', q(`vnet-alz-${name}-\${var.location}`)],
    ['parent_id', `azurerm_resource_group.spoke_${key}.id`],
    ['address_space', `[${addressSpace}]`],
    ['enable_telemetry', 'var.enable_telemetry'],
    '',
    ['subnets', workloadSubnet(key, addressSpace, routeToFirewall)],
    '',
    ['peerings', hubPeering(name)],
    '',
    ['providers', obj([['azapi', `azapi.${key}`]])],
  ]);
}

/**
 * The lines for one spoke. `addressSpace` is the HCL expression of its /24;
 * `routeToFirewall` adds the route table and attaches it to the subnet.
 */
export function spokeBlocks({ key, name, addressSpace, routeToFirewall }) {
  const blocks = [resourceGroup(key, name)];
  if (routeToFirewall) blocks.push(routeTable(key, name));
  blocks.push(virtualNetwork(key, name, addressSpace, routeToFirewall));
  return blocks.flatMap((b, i) => (i === 0 ? b : ['', ...b]));
}
