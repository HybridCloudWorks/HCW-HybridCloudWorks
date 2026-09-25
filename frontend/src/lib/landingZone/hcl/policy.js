/**
 * The policy baseline's parameters (#667): every `policy_default_values`
 * name the pinned `platform/alz` library declares, and where the build gets
 * each value from.
 *
 * THE LIST IS THE LIBRARY'S. `platform/alz/alz_policy_default_values.json`
 * at the ref in avmVersions.js declares fourteen default names, in this
 * order; a value left unsupplied leaves the assignment on the library's
 * placeholder (`security_contact@replace_me`, an all-zeros subscription),
 * which either fails at plan time or, worse, is accepted and misbehaves at
 * remediation. So every name is here, each with the expression that
 * supplies it from management.tf, connectivity.tf or a variable, and the
 * one the build never creates a source for (`ddos_protection_plan_id`)
 * names the assignment to stop enforcing instead. A `needs` of `dns` is
 * supplied only when the hub is selected with private DNS zones on;
 * otherwise `Deploy-Private-DNS-Zones` is likewise kept but not enforced.
 */
import { isSelected } from '../state';
import { jsonValue, list, obj, q } from './format';

const DCR = 'Microsoft.Insights/dataCollectionRules';

/** A resource id built from a name in the management resource group, at plan time. */
const managementResourceId = (type, nameExpr) =>
  `provider::azapi::resource_group_resource_id(var.management_subscription_id, local.management_resource_group_name, ${q(type)}, [${nameExpr}])`;

const entry = (name, needs, value) => Object.freeze({ name, needs, value });

/** The fourteen names, in the library's order. `needs` is what must be in the build. */
export const POLICY_DEFAULTS = Object.freeze([
  entry('private_dns_zone_subscription_id', 'dns', 'var.connectivity_subscription_id'),
  entry('private_dns_zone_resource_group_name', 'dns', 'azurerm_resource_group.connectivity.name'),
  entry('private_dns_zone_region', 'dns', 'var.location'),
  entry(
    'ama_user_assigned_managed_identity_id',
    'management',
    managementResourceId(
      'Microsoft.ManagedIdentity/userAssignedIdentities',
      'local.ama_user_assigned_identity_name'
    )
  ),
  entry(
    'ama_user_assigned_managed_identity_name',
    'management',
    'local.ama_user_assigned_identity_name'
  ),
  entry(
    'ama_vm_insights_data_collection_rule_id',
    'management',
    managementResourceId(DCR, q('dcr-vm-insights'))
  ),
  entry(
    'ama_mdfc_sql_data_collection_rule_id',
    'management',
    managementResourceId(DCR, q('dcr-defender-sql'))
  ),
  entry(
    'ama_change_tracking_data_collection_rule_id',
    'management',
    managementResourceId(DCR, q('dcr-change-tracking'))
  ),
  entry('ddos_protection_plan_id', 'ddos', null),
  entry(
    'log_analytics_workspace_id',
    'management',
    managementResourceId(
      'Microsoft.OperationalInsights/workspaces',
      'local.log_analytics_workspace_name'
    )
  ),
  entry('resource_group_location', null, 'var.location'),
  entry(
    'resource_group_name_service_health_alerts',
    null,
    q('rg-alz-service-health-${var.location}')
  ),
  entry('resource_group_name_mdfc', null, q('rg-alz-mdfc-export-${var.location}')),
  entry('email_security_contact', null, 'var.security_contact_email'),
]);

/** The assignment to keep but not enforce when a `needs` is not in the build, by management group. */
const NOT_ENFORCED_WITHOUT = Object.freeze({
  dns: Object.freeze({ managementGroup: 'corp', assignment: 'Deploy-Private-DNS-Zones' }),
  ddos: Object.freeze({ managementGroup: 'connectivity', assignment: 'Enable-DDoS-VNET' }),
});

/** Which sources this build has. Policy depends on management, so that one is always true. */
export function policySources(state) {
  return {
    management: isSelected(state, 'management'),
    dns: isSelected(state, 'connectivity-hub') && state.options.privateDnsZones,
    ddos: false,
  };
}

/** `policy_assignments_to_modify`, grouped by management group. */
function notEnforced(sources) {
  const byGroup = new Map();
  for (const [needs, target] of Object.entries(NOT_ENFORCED_WITHOUT)) {
    if (sources[needs]) continue;
    if (!byGroup.has(target.managementGroup)) byGroup.set(target.managementGroup, []);
    byGroup.get(target.managementGroup).push(target.assignment);
  }
  return obj(
    [...byGroup.entries()].map(([group, assignments]) => [
      group,
      obj([
        [
          'policy_assignments',
          obj(assignments.map((a) => [a, obj([['enforcement_mode', q('DoNotEnforce')]])])),
        ],
      ]),
    ])
  );
}

/** The module items that configure the baseline; appended to the avm-ptn-alz call. */
export function policyItems(state) {
  const sources = policySources(state);
  const supplied = POLICY_DEFAULTS.filter((d) => d.needs === null || sources[d.needs]);
  return [
    '',
    '# The library declares fourteen policy default values. Every one the build has a',
    '# source for is supplied below, built from the names management.tf and',
    '# connectivity.tf use because the alz provider needs them at plan time; an',
    '# assignment whose value the build cannot supply is kept but not enforced, so',
    '# nothing is created from a library placeholder.',
    ['policy_assignments_to_modify', notEnforced(sources)],
    '',
    '# Terraform creates the management resources before the assignments that name them.',
    [
      'policy_assignments_dependencies',
      list([
        'module.management.data_collection_rule_ids',
        'module.management.resource_id',
        'module.management.user_assigned_identity_ids',
      ]),
    ],
    ['policy_default_values', obj(supplied.map((d) => [d.name, jsonValue(d.value)]))],
  ];
}
