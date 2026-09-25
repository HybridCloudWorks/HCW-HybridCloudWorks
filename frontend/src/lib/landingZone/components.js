/**
 * The Landing Zone Builder's catalogue (#667): the eight components a learner
 * assembles, what each one teaches, which module deploys it, what it depends
 * on, and the knobs it exposes.
 *
 * Two groups. `platform` is what the organisation runs once: the management
 * group tree, the policy baseline, central logging, the hub network, the
 * firewall in it, and identity. `application` is what teams get, N times:
 * corp landing zones (reached through the hub) and online landing zones
 * (internet-facing). The names are the ones HashiCorp's validated pattern and
 * the `alz` architecture definition use, so a learner who reads on meets the
 * same words.
 *
 * `teaches` is the hand-written explanation, three to five sentences a
 * beginner reads: what the thing is, why a landing zone has it, and what
 * breaks without it. `avm` is the Azure Verified Module that deploys the
 * component, or null when the component is configuration of another
 * module's call (policy sits inside avm-ptn-alz; the firewall is a block of
 * the connectivity module). Every `avm` comes from avmVersions.js so the
 * catalogue and the pins cannot disagree.
 */
import { AVM_MODULES } from './avmVersions';

const pin = (name) =>
  Object.freeze({ source: AVM_MODULES[name].source, version: AVM_MODULES[name].version });

/** Azure Firewall SKUs, in price order. */
export const FIREWALL_SKUS = Object.freeze(['Basic', 'Standard', 'Premium']);

/** How many application landing zones of one kind a build may hold. */
export const MAX_LANDING_ZONES = 5;

/**
 * An IPv4 CIDR with a prefix the hub can carve subnets from. /8 to /24: the
 * module places a firewall subnet, a Bastion subnet and a gateway subnet
 * inside it, and /26 is the smallest of those, so a /24 is the tightest hub
 * that still fits.
 */
export function isCidr(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  return octets.every((octet) => octet <= 255) && prefix >= 8 && prefix <= 24;
}

export function isFirewallSku(value) {
  return FIREWALL_SKUS.includes(value);
}

/** What an Azure region id looks like: `centralus`, `westeurope`, `uksouth`. */
const REGION_ID = /^[a-z][a-z0-9]{2,31}$/;

export function isLocation(value) {
  return typeof value === 'string' && REGION_ID.test(value);
}

/** An integer count of landing zones, 0 to MAX_LANDING_ZONES. */
export function isLandingZoneCount(value) {
  if (value === null || value === '' || typeof value === 'boolean') return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_LANDING_ZONES;
}

/**
 * A management group id: letters, digits, hyphen, underscore, period and
 * parentheses, up to 90 characters, not starting with punctuation.
 */
const MANAGEMENT_GROUP_ID = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/;

export function isManagementGroupId(value) {
  return typeof value === 'string' && MANAGEMENT_GROUP_ID.test(value);
}

export function isBoolean(value) {
  return typeof value === 'boolean';
}

const option = (id, label, kind, defaultValue, validate, help) =>
  Object.freeze({ id, label, kind, default: defaultValue, validate, help });

/**
 * Every knob, with its default and the predicate a value must pass. `kind`
 * is what a Phase 2 form renders: `text`, `choice` (see `choices`), `boolean`
 * or `count`.
 */
export const OPTIONS = Object.freeze({
  location: option(
    'location',
    'Azure region',
    'text',
    'centralus',
    isLocation,
    'Where every regional resource is created: the Log Analytics workspace, the hub network, the firewall. Management groups and policy are tenant-wide and have no region.'
  ),
  rootParentId: option(
    'rootParentId',
    'Root management group id',
    'text',
    'alz',
    isManagementGroupId,
    'The id of the management group at the top of the landing zone tree. The alz architecture names it "alz"; every other group in the tree hangs under it.'
  ),
  hubCidr: option(
    'hubCidr',
    'Hub address space',
    'text',
    '10.0.0.0/16',
    isCidr,
    'The IPv4 range the hub virtual network owns. Spokes peer into it, so it must not overlap any spoke or on-premises range.'
  ),
  privateDnsZones: option(
    'privateDnsZones',
    'Private DNS zones',
    'boolean',
    true,
    isBoolean,
    'Create the private DNS zones for Azure Private Link services in the hub, linked to the hub network, so private endpoints in spokes resolve by name.'
  ),
  firewallSku: option(
    'firewallSku',
    'Firewall SKU',
    'choice',
    'Standard',
    isFirewallSku,
    'Basic is for small deployments under 250 Mbps; Standard adds threat intelligence and scales; Premium adds TLS inspection and intrusion detection.'
  ),
  corpCount: option(
    'corpCount',
    'Corp landing zones',
    'count',
    1,
    isLandingZoneCount,
    'How many corp subscriptions to place. Each is a spoke peered to the hub with no public inbound path.'
  ),
  onlineCount: option(
    'onlineCount',
    'Online landing zones',
    'count',
    1,
    isLandingZoneCount,
    'How many online subscriptions to place. Each may expose services to the internet and still peers to the hub for shared services.'
  ),
});

/** The choices a `choice` option offers, by option id. */
export const OPTION_CHOICES = Object.freeze({ firewallSku: FIREWALL_SKUS });

export const OPTION_IDS = Object.freeze(Object.keys(OPTIONS));

const component = ({ id, group, label, summary, teaches, avm, dependsOn, options, shortId }) =>
  Object.freeze({
    id,
    group,
    label,
    summary,
    teaches,
    avm,
    dependsOn: Object.freeze(dependsOn),
    options: Object.freeze(options),
    shortId,
  });

/**
 * In the order the issue lists them, which is the order the page, the
 * emitted files and the URL use. It is a reading order, not a topological
 * one: policy comes second because a learner meets it second, though it
 * depends on management, which comes third. `shortId` is the token `?lz=`
 * carries for the component.
 */
export const COMPONENTS = Object.freeze([
  component({
    id: 'management-groups',
    shortId: 'mg',
    group: 'platform',
    label: 'Management groups',
    summary: 'The tree of management groups every subscription is placed in.',
    teaches:
      'A management group is a container above subscriptions, and the tree of them is the skeleton of a landing zone: an "alz" root, a Platform branch for the shared services and a Landing zones branch for the workloads. Policy and role assignments made on a group flow down to every subscription beneath it, so one decision at the root governs hundreds of subscriptions without being repeated. The avm-ptn-alz module reads the "alz" architecture definition and creates the whole tree in one call. Without the tree, each subscription is its own island: every guardrail has to be assigned again for each one, and nothing stops a new subscription from arriving with none.',
    avm: pin('avm-ptn-alz'),
    dependsOn: [],
    options: ['location', 'rootParentId'],
  }),
  component({
    id: 'policy',
    shortId: 'policy',
    group: 'platform',
    label: 'Policy baseline',
    summary: 'The Azure Policy assignments the alz architecture makes on each management group.',
    teaches:
      'Azure Policy evaluates every resource against rules and can audit, deny or fix what it finds. The alz architecture assigns a baseline of these rules at each level of the tree: deny public IPs in corp, require encryption, send diagnostics to the central workspace, install the monitoring agent. The baseline is configuration of the same avm-ptn-alz call that builds the tree, with default values that point the policies at the Log Analytics workspace from the management component. Without it the tree is only a filing system; nothing enforces where logs go or what a team may create, and drift starts on the first day.',
    avm: null,
    dependsOn: ['management-groups', 'management'],
    options: [],
  }),
  component({
    id: 'management',
    shortId: 'mgmt',
    group: 'platform',
    label: 'Management',
    summary:
      'The Log Analytics workspace and Automation account that collect every subscription’s telemetry.',
    teaches:
      'The management subscription holds the platform’s eyes: a Log Analytics workspace that every other subscription sends its logs and metrics to, the data collection rules that tell the monitoring agent what to gather, and an Automation account for update management. The avm-ptn-alz-management module creates them together, with the user-assigned identity the agent runs as. The policy baseline depends on this component because its assignments need the workspace id as a parameter. Without central logging each team keeps its own workspace or none, and the first cross-subscription incident has no single place to ask what happened.',
    avm: pin('avm-ptn-alz-management'),
    dependsOn: ['management-groups'],
    options: [],
  }),
  component({
    id: 'connectivity-hub',
    shortId: 'hub',
    group: 'platform',
    label: 'Connectivity hub',
    summary: 'The hub virtual network, Bastion and DNS that every landing zone peers into.',
    teaches:
      'A hub-and-spoke network puts the shared network services in one virtual network, the hub, and peers every landing zone’s network, a spoke, to it. The hub holds the pieces that are expensive or dangerous to duplicate: the Bastion host for administrative access, the private DNS zones that let private endpoints resolve, and the gateway subnet for a future ExpressRoute or VPN. The avm-ptn-alz-connectivity-hub-and-spoke-vnet module creates the hub network with its subnets, route tables and these services from one object. Without a hub every spoke needs its own Bastion and DNS, spokes cannot reach each other or on-premises without pairwise peering, and there is no single point at which to inspect traffic.',
    avm: pin('avm-ptn-alz-connectivity-hub-and-spoke-vnet'),
    dependsOn: ['management-groups'],
    options: ['hubCidr', 'privateDnsZones'],
  }),
  component({
    id: 'firewall',
    shortId: 'fw',
    group: 'platform',
    label: 'Azure Firewall',
    summary: 'The firewall in the hub that every spoke’s traffic is routed through.',
    teaches:
      'Azure Firewall is a managed, stateful firewall that sits in its own subnet of the hub. The connectivity module creates it with a firewall policy and writes route tables that send spoke traffic to it, so traffic between spokes, to the internet and to on-premises passes one inspection point. It is a block of the hub’s configuration rather than a separate module, which is why it depends on the hub. The SKU sets the ceiling: Basic for small environments, Standard for most, Premium when TLS inspection and intrusion detection are required. Without it each spoke egresses to the internet directly and there is no central place for rules or logs.',
    avm: null,
    dependsOn: ['connectivity-hub'],
    options: ['firewallSku'],
  }),
  component({
    id: 'identity',
    shortId: 'id',
    group: 'platform',
    label: 'Identity',
    summary: 'The identity subscription for domain controllers and directory services.',
    teaches:
      'The identity subscription is where an organisation runs the services that authenticate everything else: Active Directory domain controllers, Entra Domain Services or the connectors that sync them. It sits under the Platform management group so it inherits the platform guardrails but is isolated from workloads, and it usually peers to the hub so every spoke can reach a domain controller. The avm-ptn-alz-application-landing-zone-identity-and-access module is the pattern module for this subscription. Without a dedicated identity subscription these services end up inside one team’s landing zone, and that team can outlive, delete or misconfigure what everyone depends on.',
    avm: pin('avm-ptn-alz-application-landing-zone-identity-and-access'),
    dependsOn: ['management-groups'],
    options: [],
  }),
  component({
    id: 'corp',
    shortId: 'corp',
    group: 'application',
    label: 'Corp landing zone',
    summary: 'An application subscription for internal workloads, reached only through the hub.',
    teaches:
      'A corp landing zone is a subscription for workloads that are internal to the organisation: reached over the private network, through the hub, and never from the internet. It is placed under the Corp management group, so the corp policies apply, among them the ones that deny public IP addresses and require private endpoints. Its virtual network is a spoke peered to the hub, with routes that send outbound traffic through the firewall. Without the corp group there is no place to put a workload that must be private by policy, and a private application gets the same rules as a public one.',
    avm: pin('avm-ptn-alz-application-landing-zone-identity-and-access'),
    dependsOn: ['management-groups', 'connectivity-hub'],
    options: ['corpCount'],
  }),
  component({
    id: 'online',
    shortId: 'online',
    group: 'application',
    label: 'Online landing zone',
    summary: 'An application subscription that may face the internet and still uses the hub.',
    teaches:
      'An online landing zone is a subscription for workloads that serve the internet: a public website, an API, a customer portal. It is placed under the Online management group, whose policies allow public endpoints where corp’s deny them, while the root policies about logging, encryption and monitoring still apply. Its network is also a spoke, so it reaches shared services and DNS through the hub. Without a separate online group, either public workloads are blocked by the corp rules or the corp rules are loosened for everyone.',
    avm: pin('avm-ptn-alz-application-landing-zone-identity-and-access'),
    dependsOn: ['management-groups', 'connectivity-hub'],
    options: ['onlineCount'],
  }),
]);

export const COMPONENT_IDS = Object.freeze(COMPONENTS.map((c) => c.id));

export const PLATFORM_IDS = Object.freeze(
  COMPONENTS.filter((c) => c.group === 'platform').map((c) => c.id)
);

export const APPLICATION_IDS = Object.freeze(
  COMPONENTS.filter((c) => c.group === 'application').map((c) => c.id)
);

const COMPONENT_BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));
const COMPONENT_BY_SHORT_ID = new Map(COMPONENTS.map((c) => [c.shortId, c]));

export function componentById(id) {
  return COMPONENT_BY_ID.get(id) ?? null;
}

export function componentByShortId(shortId) {
  return COMPONENT_BY_SHORT_ID.get(shortId) ?? null;
}

export function isComponentId(id) {
  return COMPONENT_BY_ID.has(id);
}

/** The option that carries a component's count of landing zones, or null. */
export function countOptionFor(id) {
  if (id === 'corp') return 'corpCount';
  if (id === 'online') return 'onlineCount';
  return null;
}
