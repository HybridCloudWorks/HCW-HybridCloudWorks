/**
 * `variables.tf` and `terraform.tfvars.example` (#667), from one table: each
 * variable says when it is emitted, its type, its default (the option's
 * value, so the tfvars can be empty for a default build), its description,
 * the validations a wrong value should fail early on, and the example value
 * the tfvars stub carries. Two files from one list, so they cannot disagree.
 *
 * THE RANGE VARIABLES CARRY THE SAME RULES AS THE JS VALIDATORS, for a
 * reader who edits the downloaded tfvars. Each has a shape check (a dotted
 * quad, a prefix within the bounds cidr.js exports, and `cidrhost` able to
 * parse it, which is what rejects an octet above 255) and the spoke range
 * has the cross-range check as well: since Terraform 1.9 a `validation` may
 * read another variable, so it compares the two directly. Two prefixes
 * overlap exactly when the one with the shorter prefix, applied as a mask to
 * the other's first address, gives its own network; `cidrsubnet(x, 0, 0)`
 * is the mask, `cidrhost(x, 0)` the first address, `split("/", x)[1]` the
 * prefix length. Terraform evaluates each validation on its own, so the
 * cross-range one is wrapped in a conditional that is true unless both
 * strings parse; the shape checks are what reports a bad string.
 */
import { HUB_PREFIX_RANGE, SPOKE_PREFIX_RANGE } from '../cidr';
import { isSelected } from '../state';
import { block, body, file, joinBlocks, q } from './format';

/**
 * Placeholder subscription ids for the tfvars example, distinct from each
 * other so a copied example fails on authentication, not on the rule in
 * subscriptions.tf that every placed id be distinct: platform roles 1..3,
 * corp landing zones 11.., online 21...
 */
const exampleGuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const EXAMPLE_GUIDS = { management: 1, connectivity: 2, identity: 3, corp: 10, online: 20 };

const GUID = (ref) => `can(regex("^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$", ${ref}))`;

const has = (id) => (state) => isSelected(state, id);
const anySpoke = (state) => ['identity', 'corp', 'online'].some((id) => isSelected(state, id));
const guids = (group, n) =>
  `[${Array.from({ length: n }, (_, i) => q(exampleGuid(EXAMPLE_GUIDS[group] + i + 1))).join(', ')}]`;

const HUB = 'var.hub_address_space';
const SPOKE = 'var.spoke_address_space';

/** `(8|9|…|24)`: the prefix lengths a range may have, as a regex alternation. */
const prefixAlternation = ([min, max]) =>
  `(${Array.from({ length: max - min + 1 }, (_, i) => String(min + i)).join('|')})`;

/** A dotted quad with a prefix in range, and one `cidrhost` can parse. */
const cidrShape = (ref, range) => ({
  condition: `can(regex("^([0-9]{1,3}[.]){3}[0-9]{1,3}/${prefixAlternation(range)}$", ${ref})) && can(cidrhost(${ref}, 0))`,
  error: `An IPv4 CIDR with a prefix from /${range[0]} to /${range[1]}.`,
});

const parses = (ref) => `can(cidrhost(${ref}, 0))`;
const prefixOf = (ref) => `split("/", ${ref})[1]`;
const networkOf = (ref) => `cidrsubnet(${ref}, 0, 0)`;
/** `other`'s first address masked to `ref`'s prefix length, as a network. */
const maskedBy = (other, ref) =>
  `cidrsubnet("\${cidrhost(${other}, 0)}/\${${prefixOf(ref)}}", 0, 0)`;

/**
 * The multi-line condition: true when the hub and spoke ranges are apart,
 * and true, leaving the verdict to the shape checks, when either does not
 * parse.
 */
const RANGES_APART = [
  '(',
  `${parses(HUB)} && ${parses(SPOKE)}`,
  '? (',
  `  tonumber(${prefixOf(HUB)}) <= tonumber(${prefixOf(SPOKE)})`,
  `  ? ${maskedBy(SPOKE, HUB)} != ${networkOf(HUB)}`,
  `  : ${maskedBy(HUB, SPOKE)} != ${networkOf(SPOKE)}`,
  ')',
  ': true',
  ')',
];

const subscriptionId = (role, when, description) => ({
  name: `${role}_subscription_id`,
  when,
  type: 'string',
  description,
  validations: [
    { condition: GUID(`var.${role}_subscription_id`), error: 'A subscription id is a GUID.' },
  ],
  example: () => q(exampleGuid(EXAMPLE_GUIDS[role])),
});

const subscriptionIds = (group, countId, description) => ({
  name: `${group}_subscription_ids`,
  when: (state) => state.options[countId] > 0,
  type: 'list(string)',
  description,
  validations: (options) => [
    {
      condition: `length(var.${group}_subscription_ids) == ${options[countId]} && alltrue([for id in var.${group}_subscription_ids : ${GUID('id')}])`,
      error: `Exactly ${options[countId]} subscription id${options[countId] === 1 ? '' : 's'}, each a GUID.`,
    },
  ],
  example: (options) => guids(group, options[countId]),
});

/** Every variable the emitter can declare, in file order. */
const VARIABLES = [
  {
    name: 'location',
    when: () => true,
    type: 'string',
    default: (o) => q(o.location),
    description: 'The Azure region for every regional resource.',
    example: (o) => q(o.location),
  },
  {
    name: 'enable_telemetry',
    when: () => true,
    type: 'bool',
    default: () => 'true',
    description: 'Whether the Azure Verified Modules send their usage telemetry to Microsoft.',
  },
  {
    name: 'parent_management_group_id',
    when: has('management-groups'),
    type: 'string',
    default: (o) => (o.rootParentId ? q(o.rootParentId) : 'null'),
    description:
      'The NAME of the management group to create the "alz" root under (a bare id such as contoso, never a resource id), or null for the tenant root group.',
    validations: [
      {
        condition:
          'var.parent_management_group_id == null ? true : (length(var.parent_management_group_id) > 0 && !strcontains(var.parent_management_group_id, "/"))',
        error:
          'A management group name, non-empty and without the /providers/Microsoft.Management/managementGroups/ prefix; null for the tenant root group.',
      },
    ],
    example: (o) => (o.rootParentId ? q(o.rootParentId) : null),
  },
  {
    name: 'hub_address_space',
    when: has('connectivity-hub'),
    type: 'string',
    default: (o) => q(o.hubCidr),
    description: 'The IPv4 address space of the hub virtual network.',
    validations: [cidrShape(HUB, HUB_PREFIX_RANGE)],
    example: (o) => q(o.hubCidr),
  },
  {
    name: 'spoke_address_space',
    when: anySpoke,
    type: 'string',
    default: (o) => q(o.spokeCidr),
    description:
      'The IPv4 range every spoke is carved from, one /24 each; must not overlap the hub.',
    validations: [
      cidrShape(SPOKE, SPOKE_PREFIX_RANGE),
      {
        condition: RANGES_APART,
        error: 'The spoke range must not overlap the hub address space.',
      },
    ],
    example: (o) => q(o.spokeCidr),
  },
  {
    name: 'security_contact_email',
    when: has('management-groups'),
    type: 'string',
    description:
      'The address Microsoft Defender for Cloud notifies; the Deploy-MDFC-Config-H224 assignment, part of the alz baseline whether enforced or not, requires one.',
    validations: [
      {
        condition: 'can(regex("^[^@ ]+@[^@ ]+[.][^@ ]+$", var.security_contact_email))',
        error: 'An email address.',
      },
    ],
    example: () => q('security@example.com'),
  },
  subscriptionId('management', has('management'), 'The management subscription.'),
  subscriptionId('connectivity', has('connectivity-hub'), 'The connectivity subscription.'),
  subscriptionId('identity', has('identity'), 'The identity subscription.'),
  subscriptionIds(
    'corp',
    'corpCount',
    'The corp landing zone subscriptions, one per landing zone.'
  ),
  subscriptionIds(
    'online',
    'onlineCount',
    'The online landing zone subscriptions, one per landing zone.'
  ),
];

function validationBlocks(spec, options) {
  if (!spec.validations) return [];
  const list =
    typeof spec.validations === 'function' ? spec.validations(options) : spec.validations;
  return list.flatMap((v) => [
    '',
    ...block('validation', [
      ['condition', v.condition],
      ['error_message', q(v.error)],
    ]),
  ]);
}

function variableBlock(spec, options) {
  const items = [['type', spec.type]];
  if (spec.default) items.push(['default', spec.default(options)]);
  items.push(['description', q(spec.description)]);
  return block(`variable "${spec.name}"`, [...items, ...validationBlocks(spec, options)]);
}

const declared = (state) => VARIABLES.filter((spec) => spec.when(state));

export function variablesTf(state) {
  return file(
    'variables.tf',
    joinBlocks(declared(state).map((spec) => variableBlock(spec, state.options)))
  );
}

export function tfvarsExample(state) {
  const items = [
    '# Copy to terraform.tfvars and replace every all-zero GUID with a real subscription id.',
  ];
  for (const spec of declared(state)) {
    const example = spec.example ? spec.example(state.options) : null;
    if (example !== null) items.push([spec.name, example]);
  }
  return file('terraform.tfvars.example', body(items));
}
