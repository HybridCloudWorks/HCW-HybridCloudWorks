/**
 * `variables.tf` and `terraform.tfvars.example` (#667), from one table: each
 * variable says when it is emitted, its type, its default (the option's
 * value, so the tfvars can be empty for a default build), its description,
 * a validation when a wrong value would fail late, and the example value
 * the tfvars stub carries. Two files from one list, so they cannot disagree.
 */
import { isSelected } from '../state';
import { block, body, file, joinBlocks, q } from './format';

const EXAMPLE_GUID = '00000000-0000-0000-0000-000000000000';

const GUID = (ref) => `can(regex("^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$", ${ref}))`;

const has = (id) => (state) => isSelected(state, id);
const anySpoke = (state) => ['identity', 'corp', 'online'].some((id) => isSelected(state, id));
const guids = (n) => `[${Array.from({ length: n }, () => q(EXAMPLE_GUID)).join(', ')}]`;

const subscriptionId = (name, when, description) => ({
  name,
  when,
  type: 'string',
  description,
  validation: { condition: GUID(`var.${name}`), error: 'A subscription id is a GUID.' },
  example: () => q(EXAMPLE_GUID),
});

const subscriptionIds = (name, countId, description) => ({
  name,
  when: (state) => state.options[countId] > 0,
  type: 'list(string)',
  description,
  validation: (options) => ({
    condition: `length(var.${name}) == ${options[countId]} && alltrue([for id in var.${name} : ${GUID('id')}])`,
    error: `Exactly ${options[countId]} subscription id${options[countId] === 1 ? '' : 's'}, each a GUID.`,
  }),
  example: (options) => guids(options[countId]),
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
      'The management group to create the "alz" root under; null for the tenant root group.',
    example: (o) => (o.rootParentId ? q(o.rootParentId) : null),
  },
  {
    name: 'hub_address_space',
    when: has('connectivity-hub'),
    type: 'string',
    default: (o) => q(o.hubCidr),
    description: 'The IPv4 address space of the hub virtual network.',
    example: (o) => q(o.hubCidr),
  },
  {
    name: 'spoke_address_space',
    when: anySpoke,
    type: 'string',
    default: (o) => q(o.spokeCidr),
    description:
      'The IPv4 range every spoke is carved from, one /24 each; must not overlap the hub.',
    example: (o) => q(o.spokeCidr),
  },
  {
    name: 'security_contact_email',
    when: has('policy'),
    type: 'string',
    description:
      'The address Microsoft Defender for Cloud notifies; the Deploy-MDFC-Config-H224 assignment requires one.',
    validation: {
      condition: 'can(regex("^[^@ ]+@[^@ ]+[.][^@ ]+$", var.security_contact_email))',
      error: 'An email address.',
    },
    example: () => q('security@example.com'),
  },
  subscriptionId('management_subscription_id', has('management'), 'The management subscription.'),
  subscriptionId(
    'connectivity_subscription_id',
    has('connectivity-hub'),
    'The connectivity subscription.'
  ),
  subscriptionId('identity_subscription_id', has('identity'), 'The identity subscription.'),
  subscriptionIds(
    'corp_subscription_ids',
    'corpCount',
    'The corp landing zone subscriptions, one per landing zone.'
  ),
  subscriptionIds(
    'online_subscription_ids',
    'onlineCount',
    'The online landing zone subscriptions, one per landing zone.'
  ),
];

function validationBlock(spec, options) {
  if (!spec.validation) return [];
  const v = typeof spec.validation === 'function' ? spec.validation(options) : spec.validation;
  return [
    '',
    ...block('validation', [
      ['condition', v.condition],
      ['error_message', q(v.error)],
    ]),
  ];
}

function variableBlock(spec, options) {
  const items = [['type', spec.type]];
  if (spec.default) items.push(['default', spec.default(options)]);
  items.push(['description', q(spec.description)]);
  return block(`variable "${spec.name}"`, [...items, ...validationBlock(spec, options)]);
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
