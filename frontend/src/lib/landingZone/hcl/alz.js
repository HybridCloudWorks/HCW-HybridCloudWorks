/**
 * `alz.tf` (#667): the "alz" architecture from avm-ptn-alz, the subscription
 * placements, and, when the policy component is selected, the baseline's
 * parameters from policy.js.
 */
import { isSelected } from '../state';
import { block, file, moduleSource, obj, q } from './format';
import { policyItems } from './policy';
import { placements } from './subscriptions';

const HEADER = [
  '# Management groups: the "alz" architecture, a root named "alz" with Platform and',
  '# Landing zones beneath it. It is created under the tenant root group, or under the',
  '# management group named in var.parent_management_group_id. The policy baseline is',
  '# part of the same architecture, so selecting it adds parameters to this call rather',
  '# than a module.',
];

function placementItems(state) {
  const placed = placements(state);
  if (!placed.length) return [];
  return [
    '',
    '# Each subscription is moved under the management group whose policies it should',
    '# inherit. The keys are labels; the names are the groups the alz architecture creates.',
    [
      'subscription_placement',
      obj(
        placed.map((sub) => [
          sub.key,
          obj([
            ['subscription_id', sub.variable],
            ['management_group_name', q(sub.mg)],
          ]),
        ])
      ),
    ],
  ];
}

export function alzTf(state) {
  return file('alz.tf', [
    ...HEADER,
    'data "azapi_client_config" "current" {}',
    '',
    ...block('module "alz"', [
      ...moduleSource('avm-ptn-alz'),
      '',
      ['architecture_name', q('alz')],
      ['location', 'var.location'],
      [
        'parent_resource_id',
        'coalesce(var.parent_management_group_id, data.azapi_client_config.current.tenant_id)',
      ],
      ['enable_telemetry', 'var.enable_telemetry'],
      ...placementItems(state),
      ...(isSelected(state, 'policy') ? policyItems(state) : []),
    ]),
    '',
    ...block('output "root_management_group_resource_id"', [
      ['description', q('The resource id of the "alz" management group at the top of the tree.')],
      ['value', 'module.alz.management_group_resource_ids["alz"]'],
    ]),
  ]);
}
