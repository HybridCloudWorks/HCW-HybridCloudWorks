/**
 * The policy baseline's parameters (#667): every `policy_default_values`
 * name the pinned `platform/alz` library declares, where the build gets each
 * value from, and every assignment the architecture makes, so the tree can
 * be deployed with the baseline present and not enforced when the learner
 * has not selected Policy.
 *
 * THE LISTS ARE THE LIBRARY'S. `platform/alz/alz_policy_default_values.json`
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
 *
 * `BASELINE_ASSIGNMENTS` is every `policy_assignments` entry of every
 * archetype the `alz` architecture definition attaches to a management
 * group at the same ref, keyed by the group's name. The `alz` architecture
 * carries its baseline whether or not the learner selected Policy, so when
 * Policy is off the emitter sets every one of these to `DoNotEnforce`: the
 * assignments exist, so a learner can see them in the portal, and none
 * denies or remediates anything.
 */
import { isSelected } from '../state';
import { jsonValue, key, list, obj, q } from './format';

const DCR = 'Microsoft.Insights/dataCollectionRules';

/**
 * A resource id built from a name in the management resource group, at plan
 * time. The fourth argument of `provider::azapi::resource_group_resource_id`
 * is `resource_names list of string` (azapi 2.12 function docs), one element
 * per level of the resource type, so a top-level resource is a one-element
 * list; it is the shape avm-ptn-alz's own examples/management uses.
 */
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

/**
 * The assignment to keep but not enforce when a `needs` is not in the build.
 * Which management groups carry it comes from BASELINE_ASSIGNMENTS, so an
 * assignment made by more than one archetype (Enable-DDoS-VNET is on both
 * landingzones and connectivity) is disabled everywhere it appears.
 */
const NOT_ENFORCED_WITHOUT = Object.freeze({
  dns: 'Deploy-Private-DNS-Zones',
  ddos: 'Enable-DDoS-VNET',
});

/** Every management group whose archetype makes `assignment`, in baseline order. */
export function groupsAssigning(assignment) {
  return Object.entries(BASELINE_ASSIGNMENTS)
    .filter(([, assignments]) => assignments.includes(assignment))
    .map(([group]) => group);
}

const GUARDRAILS = [
  'Enforce-ASR',
  'Enforce-Encrypt-CMK0',
  'Enforce-GR-APIM0',
  'Enforce-GR-AppServices0',
  'Enforce-GR-Automation0',
  'Enforce-GR-BotService0',
  'Enforce-GR-CogServ0',
  'Enforce-GR-Compute0',
  'Enforce-GR-ContApps0',
  'Enforce-GR-ContInst0',
  'Enforce-GR-ContReg0',
  'Enforce-GR-CosmosDb0',
  'Enforce-GR-DataExpl0',
  'Enforce-GR-DataFactory0',
  'Enforce-GR-EventGrid0',
  'Enforce-GR-EventHub0',
  'Enforce-GR-KeyVault',
  'Enforce-GR-KeyVaultSup0',
  'Enforce-GR-Kubernetes0',
  'Enforce-GR-MachLearn0',
  'Enforce-GR-MySQL0',
  'Enforce-GR-Network0',
  'Enforce-GR-OpenAI0',
  'Enforce-GR-PostgreSQL0',
  'Enforce-GR-ServiceBus0',
  'Enforce-GR-SQL0',
  'Enforce-GR-Storage0',
  'Enforce-GR-Synapse0',
  'Enforce-GR-VirtualDesk0',
  'Enforce-Subnet-Private',
];

const MONITORING = [
  'Deploy-GuestAttest',
  'Deploy-MDFC-DefSQL-AMA',
  'Deploy-VM-ChangeTrack',
  'Deploy-VM-Monitoring',
  'Deploy-vmArc-ChangeTrack',
  'Deploy-vmHybr-Monitoring',
  'Deploy-VMSS-ChangeTrack',
  'Deploy-VMSS-Monitoring',
  'Enable-AUM-CheckUpdates',
];

/**
 * Every policy assignment the `alz` architecture makes, by management group
 * name, at the pinned library ref: the group's archetype's list, verbatim
 * and in its order. Groups whose archetype assigns nothing (online, security,
 * management) are absent.
 */
export const BASELINE_ASSIGNMENTS = Object.freeze({
  alz: Object.freeze([
    'Audit-ResourceRGLocation',
    'Audit-TrustedLaunch',
    'Audit-UnusedResources',
    'Audit-ZoneResiliency',
    'Deny-Classic-Resources',
    'Deny-UnmanagedDisk',
    'Deploy-ASC-Monitoring',
    'Deploy-AzActivity-Log',
    'Deploy-Diag-LogsCat',
    'Deploy-MCSB2-Monitoring',
    'Deploy-MDEndpoints',
    'Deploy-MDEndpointsAMA',
    'Deploy-MDFC-Config-H224',
    'Deploy-MDFC-OssDb',
    'Deploy-MDFC-SqlAtp',
    'Deploy-SvcHealth-BuiltIn',
    'Enforce-ACSB',
  ]),
  platform: Object.freeze(['DenyAction-DeleteUAMIAMA', ...MONITORING, ...GUARDRAILS]),
  landingzones: Object.freeze([
    'Audit-AppGW-WAF',
    'Deny-IP-forwarding',
    'Deny-MgmtPorts-Internet',
    'Deny-Priv-Esc-AKS',
    'Deny-Privileged-AKS',
    'Deny-Storage-http',
    'Deny-Subnet-Without-Nsg',
    'Deploy-AzSqlDb-Auditing',
    'Deploy-GuestAttest',
    'Deploy-MDFC-DefSQL-AMA',
    'Deploy-SQL-TDE',
    'Deploy-SQL-Threat',
    'Deploy-VM-Backup',
    'Deploy-VM-ChangeTrack',
    'Deploy-VM-Monitoring',
    'Deploy-vmArc-ChangeTrack',
    'Deploy-vmHybr-Monitoring',
    'Deploy-VMSS-ChangeTrack',
    'Deploy-VMSS-Monitoring',
    'Enable-AUM-CheckUpdates',
    'Enable-DDoS-VNET',
    'Enforce-AKS-HTTPS',
    ...GUARDRAILS,
    'Enforce-TLS-SSL-Q225',
  ]),
  corp: Object.freeze([
    'Audit-PeDnsZones',
    'Deny-HybridNetworking',
    'Deny-Public-Endpoints',
    'Deny-Public-IP-On-NIC',
    'Deploy-Private-DNS-Zones',
  ]),
  local: Object.freeze(['Enforce-ALDO-Services']),
  sandbox: Object.freeze(['Enforce-ALZ-Sandbox']),
  connectivity: Object.freeze(['Enable-DDoS-VNET']),
  identity: Object.freeze([
    'Deny-MgmtPorts-Internet',
    'Deny-Public-IP',
    'Deny-Subnet-Without-Nsg',
    'Deploy-VM-Backup',
  ]),
  decommissioned: Object.freeze(['Enforce-ALZ-Decomm']),
});

/** Which sources this build has. */
export function policySources(state) {
  return {
    management: isSelected(state, 'management'),
    dns: isSelected(state, 'connectivity-hub') && state.options.privateDnsZones,
    ddos: false,
  };
}

/** Group → assignments to stop enforcing when Policy is selected: only those with no source. */
function missingSourceAssignments(sources) {
  const byGroup = new Map();
  for (const [needs, assignment] of Object.entries(NOT_ENFORCED_WITHOUT)) {
    if (sources[needs]) continue;
    for (const group of groupsAssigning(assignment)) {
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group).push(assignment);
    }
  }
  return byGroup;
}

/** `policy_assignments_to_modify`: every listed assignment set to DoNotEnforce, grouped. */
function notEnforced(byGroup) {
  return obj(
    [...byGroup.entries()].map(([group, assignments]) => [
      key(group),
      obj([
        [
          'policy_assignments',
          obj(assignments.map((a) => [key(a), obj([['enforcement_mode', q('DoNotEnforce')]])])),
        ],
      ]),
    ])
  );
}

const ENFORCED_NOTE = [
  '# The library declares fourteen policy default values. Every one the build has a',
  '# source for is supplied below, built from the names management.tf and',
  '# connectivity.tf use because the alz provider needs them at plan time; an',
  '# assignment whose value the build cannot supply is kept but not enforced, so',
  '# nothing is created from a library placeholder.',
];

const NOT_ENFORCED_NOTE = [
  '# Policy was not selected. The "alz" architecture carries its policy baseline',
  '# regardless, so the assignments below are created, but every one of them is set to',
  '# DoNotEnforce: the tree is deployed with the baseline present and inert, and a',
  '# reader can inspect the assignments without any of them denying or remediating.',
  '# The default values the build can supply are still passed, because the module',
  '# evaluates them whether or not an assignment is enforced.',
];

/** The module items that configure the baseline; appended to the avm-ptn-alz call. */
export function policyItems(state) {
  const enforced = isSelected(state, 'policy');
  const sources = policySources(state);
  const supplied = POLICY_DEFAULTS.filter((d) => d.needs === null || sources[d.needs]);
  const byGroup = enforced
    ? missingSourceAssignments(sources)
    : new Map(Object.entries(BASELINE_ASSIGNMENTS).map(([g, a]) => [g, [...a]]));
  const items = [
    '',
    ...(enforced ? ENFORCED_NOTE : NOT_ENFORCED_NOTE),
    ['policy_assignments_to_modify', notEnforced(byGroup)],
  ];
  if (sources.management) {
    items.push(
      '',
      '# Terraform creates the management resources before the assignments that name them.',
      [
        'policy_assignments_dependencies',
        list([
          'module.management.data_collection_rule_ids',
          'module.management.resource_id',
          'module.management.user_assigned_identity_ids',
        ]),
      ]
    );
  }
  items.push([
    'policy_default_values',
    obj(supplied.map((d) => [key(d.name), jsonValue(d.value)])),
  ]);
  return items;
}
