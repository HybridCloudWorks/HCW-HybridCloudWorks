/**
 * The build as Terraform (#667): `emitFiles(state)` returns the files a
 * learner downloads, one module call per selected component, mirroring the
 * examples the Azure Verified Modules ship rather than a hand-drawn
 * approximation of them. The input names are the modules' current ones,
 * read from each module's variables.tf on the pin date in avmVersions.js.
 *
 * FORMAT. The output is what `terraform fmt` would write: two-space
 * indentation, `=` aligned across a run of single-line attributes and left
 * alone where a multi-line value or a comment breaks the run, no trailing
 * whitespace, one newline at the end. `body()` below is that rule, so a
 * change here cannot drift from it by accident; hcl.test.js checks the shape
 * and, where terraform is installed, `terraform fmt -check` is the referee.
 *
 * WHAT IS EMITTED. Only files whose components are selected: alz.tf for the
 * management groups (and, inside it, the policy configuration when policy
 * is selected), management.tf, connectivity.tf (the firewall and DNS as
 * blocks of the hub's object), application.tf for identity and the corp and
 * online landing zones, and always terraform.tf, providers.tf, variables.tf,
 * an example tfvars and a README. An empty build is a README saying so.
 * Every emission says it was generated for learning and never applied here.
 */
import {
  ALZ_LIBRARY_REFERENCE,
  AVM_MODULES,
  AVM_VERIFIED_ON,
  PROVIDER_PINS,
  TERRAFORM_REQUIRED_VERSION,
} from './avmVersions';
import { componentById, countOptionFor } from './components';
import { isSelected, normalizeState } from './state';

const INDENT = '  ';

/** A quoted HCL string. Values here are ours, so only the quote and backslash need care. */
const q = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const isAttr = (item) => Array.isArray(item) && typeof item[1] === 'string';
const isNested = (item) => Array.isArray(item) && Array.isArray(item[1]);

/**
 * The lines of a block body, `=` aligned the way terraform fmt aligns them:
 * across each run of consecutive single-line attributes, and not across a
 * multi-line attribute, a comment or a blank line.
 *
 * `items`: `[key, value]` for a single-line attribute, `[key, lines]` for a
 * multi-line one (`key = {` … `}` when `lines` starts with `{`, otherwise
 * the lines are the value's own, e.g. a list), or a string emitted as is.
 */
function body(items) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const width = Math.max(...run.map(([key]) => key.length));
    for (const [key, value] of run) out.push(`${key.padEnd(width)} = ${value}`);
    run = [];
  };
  for (const item of items) {
    if (isAttr(item)) {
      run.push(item);
      continue;
    }
    flush();
    if (isNested(item)) {
      const [key, lines] = item;
      out.push(`${key} = ${lines[0]}`);
      for (const line of lines.slice(1, -1)) out.push(line === '' ? '' : INDENT + line);
      out.push(lines[lines.length - 1]);
    } else {
      out.push(item);
    }
  }
  flush();
  return out;
}

/** `header {` … `}` with the body indented one level. */
function block(header, items) {
  return [`${header} {`, ...body(items).map((l) => (l === '' ? '' : INDENT + l)), '}'];
}

/** A `{ … }` object value for a nested attribute. */
const obj = (items) => ['{', ...body(items), '}'];

/** A `[ … ]` list value, one element per line, trailing commas as fmt keeps them. */
const list = (elements) => ['[', ...elements.map((e) => `${e},`), ']'];

const file = (path, lines) => ({ path, content: `${lines.join('\n')}\n` });

const moduleHeader = (name) => {
  const pinned = AVM_MODULES[name];
  if (pinned.version)
    return [
      ['source', q(pinned.source)],
      ['version', q(pinned.version)],
    ];
  return [
    ['source', q(pinned.source)],
    `# Not on the Terraform Registry on ${pinned.verifiedOn}; pin a version here once one is published.`,
  ];
};

const providersFor = (alias, withAzapi) =>
  obj(
    withAzapi
      ? [
          ['azurerm', `azurerm.${alias}`],
          ['azapi', `azapi.${alias}`],
        ]
      : [['azurerm', `azurerm.${alias}`]]
  );

/** The subscriptions a build places, in order, as `{ key, variable, managementGroup }`. */
function subscriptions(state) {
  const out = [];
  if (isSelected(state, 'management')) {
    out.push({ key: 'management', variable: 'var.subscription_id_management', mg: 'management' });
  }
  if (isSelected(state, 'connectivity-hub')) {
    out.push({
      key: 'connectivity',
      variable: 'var.subscription_id_connectivity',
      mg: 'connectivity',
    });
  }
  if (isSelected(state, 'identity')) {
    out.push({ key: 'identity', variable: 'var.subscription_id_identity', mg: 'identity' });
  }
  for (const [id, countId] of [
    ['corp', 'corpCount'],
    ['online', 'onlineCount'],
  ]) {
    for (let i = 1; i <= state.options[countId]; i += 1) {
      out.push({ key: `${id}_${i}`, variable: `var.subscription_ids_${id}[${i - 1}]`, mg: id });
    }
  }
  return out;
}

function terraformTf() {
  return file('terraform.tf', [
    '# Generated by the HybridCloudWorks Landing Zone Builder for learning. Never applied here.',
    ...block('terraform', [
      ['required_version', q(TERRAFORM_REQUIRED_VERSION)],
      '',
      ...block(
        'required_providers',
        PROVIDER_PINS.map((p) => [
          p.name,
          obj([
            ['source', q(p.source)],
            ['version', q(p.version)],
          ]),
        ])
      ),
    ]),
  ]);
}

function providersTf(state) {
  const lines = [
    '# The default providers take the tenant, subscription and credentials from the',
    '# ARM_TENANT_ID, ARM_SUBSCRIPTION_ID, ARM_CLIENT_ID and ARM_CLIENT_SECRET variables',
    '# of the HCP Terraform workspace. The aliases below point each module at the',
    '# subscription it deploys into, which is how a landing zone keeps management,',
    '# connectivity, identity and every application apart.',
    ...block('provider "azurerm"', ['features {}']),
    '',
    'provider "azapi" {}',
  ];
  if (isSelected(state, 'management-groups')) {
    lines.push(
      '',
      '# The alz provider reads the "alz" architecture (the management group tree and',
      '# the policy baseline) from this release of the Azure Landing Zones library.',
      ...block('provider "alz"', [
        [
          'library_references',
          [
            '[{',
            ...body([
              ['path', q(ALZ_LIBRARY_REFERENCE.path)],
              ['ref', q(ALZ_LIBRARY_REFERENCE.ref)],
            ]),
            '}]',
          ],
        ],
      ])
    );
  }
  for (const sub of subscriptions(state)) {
    const withAzapi = sub.key === 'management' || sub.key === 'connectivity';
    lines.push(
      '',
      ...block('provider "azurerm"', [
        ['alias', q(sub.key)],
        ['subscription_id', sub.variable],
        'features {}',
      ])
    );
    if (withAzapi) {
      lines.push(
        '',
        ...block('provider "azapi"', [
          ['alias', q(sub.key)],
          ['subscription_id', sub.variable],
        ])
      );
    }
  }
  return file('providers.tf', lines);
}

const MANAGEMENT_LOCALS = [
  ['management_resource_group_name', q('rg-alz-management-${var.location}')],
  ['log_analytics_workspace_name', q('law-alz-${var.location}')],
  ['automation_account_name', q('aa-alz-${var.location}')],
  ['ama_user_assigned_identity_name', q('uami-ama')],
];

function managementTf() {
  return file('management.tf', [
    '# Management: the Log Analytics workspace every subscription reports to, the data',
    '# collection rules for the monitoring agent, the identity the agent runs as, and an',
    '# Automation account. The names are locals because alz.tf builds policy parameters',
    '# from them.',
    ...block('locals', MANAGEMENT_LOCALS),
    '',
    ...block('module "management"', [
      ...moduleHeader('avm-ptn-alz-management'),
      '',
      ['automation_account_name', 'local.automation_account_name'],
      ['location', 'var.location'],
      ['log_analytics_workspace_name', 'local.log_analytics_workspace_name'],
      ['resource_group_name', 'local.management_resource_group_name'],
      ['enable_telemetry', 'var.enable_telemetry'],
      '',
      ['providers', providersFor('management', true)],
    ]),
  ]);
}

/** `provider::azapi::resource_group_resource_id(...)` for a resource in the management resource group. */
const managementResourceId = (type, name) =>
  `jsonencode({ value = provider::azapi::resource_group_resource_id(var.subscription_id_management, local.management_resource_group_name, ${q(type)}, [${name}]) })`;

function policyItems(state) {
  const items = [
    '',
    '# The DDoS policy would try to attach a protection plan the hub does not create;',
    '# it is assigned but not enforced.',
    [
      'policy_assignments_to_modify',
      obj([
        [
          'connectivity',
          obj([
            [
              'policy_assignments',
              obj([['Enable-DDoS-VNET', obj([['enforcement_mode', q('DoNotEnforce')]])]]),
            ],
          ]),
        ],
      ]),
    ],
  ];
  if (isSelected(state, 'management')) {
    items.push(
      '',
      '# The monitoring policies take the workspace, the data collection rules and the',
      '# agent identity as parameters. The ids are built from the names management.tf',
      '# uses, because the alz provider needs them at plan time, and the dependencies',
      '# list makes Terraform create the resources before the assignments.',
      [
        'policy_assignments_dependencies',
        list([
          'module.management.data_collection_rule_ids',
          'module.management.resource_id',
          'module.management.user_assigned_identity_ids',
        ]),
      ],
      [
        'policy_default_values',
        obj([
          [
            'ama_change_tracking_data_collection_rule_id',
            managementResourceId(
              'Microsoft.Insights/dataCollectionRules',
              q('dcr-change-tracking')
            ),
          ],
          [
            'ama_mdfc_sql_data_collection_rule_id',
            managementResourceId('Microsoft.Insights/dataCollectionRules', q('dcr-defender-sql')),
          ],
          [
            'ama_vm_insights_data_collection_rule_id',
            managementResourceId('Microsoft.Insights/dataCollectionRules', q('dcr-vm-insights')),
          ],
          [
            'ama_user_assigned_managed_identity_id',
            managementResourceId(
              'Microsoft.ManagedIdentity/userAssignedIdentities',
              'local.ama_user_assigned_identity_name'
            ),
          ],
          [
            'ama_user_assigned_managed_identity_name',
            'jsonencode({ value = local.ama_user_assigned_identity_name })',
          ],
          [
            'log_analytics_workspace_id',
            managementResourceId(
              'Microsoft.OperationalInsights/workspaces',
              'local.log_analytics_workspace_name'
            ),
          ],
        ]),
      ]
    );
  }
  return items;
}

function alzTf(state) {
  const placed = subscriptions(state);
  const items = [
    ...moduleHeader('avm-ptn-alz'),
    '',
    ['architecture_name', q('alz')],
    ['location', 'var.location'],
    ['parent_resource_id', 'data.azapi_client_config.current.tenant_id'],
    ['enable_telemetry', 'var.enable_telemetry'],
  ];
  if (placed.length) {
    items.push(
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
      ]
    );
  }
  if (isSelected(state, 'policy')) items.push(...policyItems(state));

  return file('alz.tf', [
    '# Management groups: the "alz" architecture, a root with Platform and Landing zones',
    '# beneath it, created under the tenant root group. The policy baseline is part of the',
    '# same architecture, so selecting it adds parameters to this call rather than a module.',
    'data "azapi_client_config" "current" {}',
    '',
    ...block('locals', [
      '# The architecture names its root "alz". A different id needs a copy of the',
      '# architecture definition in a custom library referenced from providers.tf.',
      ['root_management_group_id', 'var.root_management_group_id'],
    ]),
    '',
    ...block('module "alz"', items),
    '',
    ...block('output "root_management_group_resource_id"', [
      ['description', q('The resource id of the management group at the top of the tree.')],
      ['value', 'module.alz.management_group_resource_ids[local.root_management_group_id]'],
    ]),
  ]);
}

function connectivityTf(state) {
  const firewall = isSelected(state, 'firewall');
  const dns = state.options.privateDnsZones;
  const sku = state.options.firewallSku;
  const hub = [
    ['location', 'var.location'],
    ['default_hub_address_space', 'var.hub_address_space'],
    ['default_parent_id', 'azurerm_resource_group.connectivity.id'],
    [
      'enabled_resources',
      obj([
        ['firewall', String(firewall)],
        ['firewall_policy', String(firewall)],
        ['bastion', 'true'],
        ['private_dns_zones', String(dns)],
        ['private_dns_resolver', String(dns)],
        ['dns_resolver_policy', String(dns)],
        ['virtual_network_gateway_express_route', 'false'],
        ['virtual_network_gateway_vpn', 'false'],
      ]),
    ],
  ];
  if (firewall) {
    hub.push(
      ['firewall', obj([['sku_tier', q(sku)]])],
      ['firewall_policy', obj([['sku', q(sku)]])]
    );
  }
  const notes = [
    '# Connectivity: one hub virtual network with a Bastion host, the gateway subnet for a',
    '# future ExpressRoute or VPN (the gateways themselves are off), route tables, and',
  ];
  notes.push(
    firewall
      ? `# an Azure Firewall (${sku}) with its policy that every spoke routes through.`
      : '# no firewall: spokes egress directly until the firewall component is added.'
  );
  notes.push(
    dns
      ? '# The private DNS zones for Private Link are created and linked to the hub.'
      : '# Private DNS zones are off; private endpoints in spokes will not resolve by name.'
  );
  return file('connectivity.tf', [
    ...notes,
    ...block('resource "azurerm_resource_group" "connectivity"', [
      ['provider', 'azurerm.connectivity'],
      '',
      ['location', 'var.location'],
      ['name', q('rg-alz-connectivity-${var.location}')],
    ]),
    '',
    ...block('module "connectivity"', [
      ...moduleHeader('avm-ptn-alz-connectivity-hub-and-spoke-vnet'),
      '',
      ['enable_telemetry', 'var.enable_telemetry'],
      '',
      '# A DDoS protection plan is a fixed monthly charge; the learning build leaves it out.',
      [
        'hub_and_spoke_networks_settings',
        obj([['enabled_resources', obj([['ddos_protection_plan', 'false']])]]),
      ],
      '',
      ['hub_virtual_networks', obj([['primary', obj(hub)]])],
      '',
      ['providers', providersFor('connectivity', true)],
    ]),
  ]);
}

function landingZoneModule(label, alias, name) {
  return block(`module "${label}"`, [
    ...moduleHeader('avm-ptn-alz-application-landing-zone-identity-and-access'),
    '',
    ['location', 'var.location'],
    ['name', q(name)],
    ['resource_group_name', q(`rg-alz-${name}-\${var.location}`)],
    ['enable_telemetry', 'var.enable_telemetry'],
    '',
    ['providers', providersFor(alias, false)],
  ]);
}

function applicationTf(state) {
  const lines = [
    '# Application landing zones: one module call per subscription, each through the',
    '# provider alias for that subscription. The subscription is placed under its',
    '# management group in alz.tf; this file creates what lives inside it.',
  ];
  if (isSelected(state, 'identity')) {
    lines.push(...landingZoneModule('identity', 'identity', 'identity'));
  }
  for (const [id, countId] of [
    ['corp', 'corpCount'],
    ['online', 'onlineCount'],
  ]) {
    for (let i = 1; i <= state.options[countId]; i += 1) {
      if (lines.length > 3) lines.push('');
      lines.push(...landingZoneModule(`${id}_${i}`, `${id}_${i}`, `${id}-${i}`));
    }
  }
  return file('application.tf', lines);
}

const GUID_CONDITION = (ref) =>
  `can(regex("^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$", ${ref}))`;

function subscriptionVariable(name, description) {
  return block(`variable "${name}"`, [
    ['type', 'string'],
    ['description', q(description)],
    '',
    ...block('validation', [
      ['condition', GUID_CONDITION(`var.${name}`)],
      ['error_message', q('A subscription id is a GUID.')],
    ]),
  ]);
}

function subscriptionListVariable(name, count, description) {
  return block(`variable "${name}"`, [
    ['type', 'list(string)'],
    ['description', q(description)],
    '',
    ...block('validation', [
      [
        'condition',
        `length(var.${name}) == ${count} && alltrue([for id in var.${name} : ${GUID_CONDITION('id')}])`,
      ],
      [
        'error_message',
        q(`Exactly ${count} subscription id${count === 1 ? '' : 's'}, each a GUID.`),
      ],
    ]),
  ]);
}

function variablesTf(state) {
  const { options } = state;
  const blocks = [
    block('variable "location"', [
      ['type', 'string'],
      ['default', q(options.location)],
      ['description', q('The Azure region for every regional resource.')],
    ]),
    block('variable "enable_telemetry"', [
      ['type', 'bool'],
      ['default', 'true'],
      [
        'description',
        q('Whether the Azure Verified Modules send their usage telemetry to Microsoft.'),
      ],
    ]),
  ];
  if (isSelected(state, 'management-groups')) {
    blocks.push(
      block('variable "root_management_group_id"', [
        ['type', 'string'],
        ['default', q(options.rootParentId)],
        ['description', q('The id of the management group at the top of the landing zone tree.')],
      ])
    );
  }
  if (isSelected(state, 'connectivity-hub')) {
    blocks.push(
      block('variable "hub_address_space"', [
        ['type', 'string'],
        ['default', q(options.hubCidr)],
        ['description', q('The IPv4 address space of the hub virtual network.')],
      ])
    );
  }
  if (isSelected(state, 'management')) {
    blocks.push(subscriptionVariable('subscription_id_management', 'The management subscription.'));
  }
  if (isSelected(state, 'connectivity-hub')) {
    blocks.push(
      subscriptionVariable('subscription_id_connectivity', 'The connectivity subscription.')
    );
  }
  if (isSelected(state, 'identity')) {
    blocks.push(subscriptionVariable('subscription_id_identity', 'The identity subscription.'));
  }
  if (options.corpCount > 0) {
    blocks.push(
      subscriptionListVariable(
        'subscription_ids_corp',
        options.corpCount,
        'The corp landing zone subscriptions, one per landing zone.'
      )
    );
  }
  if (options.onlineCount > 0) {
    blocks.push(
      subscriptionListVariable(
        'subscription_ids_online',
        options.onlineCount,
        'The online landing zone subscriptions, one per landing zone.'
      )
    );
  }
  return file(
    'variables.tf',
    blocks.flatMap((b, i) => (i === 0 ? b : ['', ...b]))
  );
}

const EXAMPLE_GUID = '00000000-0000-0000-0000-000000000000';

function tfvarsExample(state) {
  const { options } = state;
  const items = [
    '# Copy to terraform.tfvars and replace every all-zero GUID with a real subscription id.',
    ['location', q(options.location)],
  ];
  if (isSelected(state, 'management-groups'))
    items.push(['root_management_group_id', q(options.rootParentId)]);
  if (isSelected(state, 'connectivity-hub')) items.push(['hub_address_space', q(options.hubCidr)]);
  if (isSelected(state, 'management')) items.push(['subscription_id_management', q(EXAMPLE_GUID)]);
  if (isSelected(state, 'connectivity-hub'))
    items.push(['subscription_id_connectivity', q(EXAMPLE_GUID)]);
  if (isSelected(state, 'identity')) items.push(['subscription_id_identity', q(EXAMPLE_GUID)]);
  const guids = (n) => `[${Array.from({ length: n }, () => q(EXAMPLE_GUID)).join(', ')}]`;
  if (options.corpCount > 0) items.push(['subscription_ids_corp', guids(options.corpCount)]);
  if (options.onlineCount > 0) items.push(['subscription_ids_online', guids(options.onlineCount)]);
  return file('terraform.tfvars.example', body(items));
}

function readmeMd(state, emitted) {
  const selected = state.selected.map((id) => componentById(id));
  const lines = [
    '# Azure landing zone, generated for learning',
    '',
    'These files were generated by the HybridCloudWorks Landing Zone Builder from a',
    'selection of components, to show what each part of an Azure landing zone becomes in',
    'Terraform. They mirror HashiCorp’s validated pattern "Build an Azure landing zone',
    'with Terraform" and call the current Azure Verified Modules for it. **They were',
    'generated for learning and have never been applied by HybridCloudWorks.** Read them,',
    'compare them with the pattern, and if you run them, do it in a tenant you own, after',
    'a `terraform plan` you have read.',
    '',
    '## What is in this build',
    '',
  ];
  if (!selected.length) {
    lines.push('Nothing yet. Select a component to see the Terraform it becomes.');
    return file('README.md', lines);
  }
  for (const c of selected) {
    const countId = countOptionFor(c.id);
    const count = countId ? ` (${state.options[countId]})` : '';
    let module = '';
    if (c.avm) module = ` — \`${c.avm.source}\`${c.avm.version ? ` ${c.avm.version}` : ''}`;
    lines.push(`- **${c.label}${count}**: ${c.summary}${module}`);
  }
  lines.push(
    '',
    '## Files',
    '',
    ...emitted.map((f) => `- \`${f.path}\``),
    '',
    '## Prerequisites, from the validated pattern',
    '',
    '- An HCP Terraform organisation with a workspace connected to the repository these',
    '  files are committed to, holding the state and running the plans.',
    '- An Azure tenant in which the deploying identity has been granted Owner at the tenant',
    '  root scope (`/`), which is what creating management groups and assigning policy at',
    '  the root requires; a Global Administrator elevates access to grant it.',
    '- A service principal (or a workload identity federation credential) for the workspace,',
    '  with its tenant, client and subscription set as the workspace’s `ARM_TENANT_ID`,',
    '  `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET` and `ARM_SUBSCRIPTION_ID` variables.',
    '- One subscription per platform role and per application landing zone, whose ids go',
    '  into `terraform.tfvars` (see `terraform.tfvars.example`).',
    `- Terraform ${TERRAFORM_REQUIRED_VERSION}.`,
    '',
    '## Module versions',
    '',
    `Pinned to the versions the Terraform Registry listed on ${AVM_VERIFIED_ON}:`,
    ''
  );
  for (const m of Object.values(AVM_MODULES)) {
    lines.push(`- \`${m.source}\` ${m.version ?? `— not yet on the registry on ${m.verifiedOn}`}`);
  }
  lines.push(
    '',
    '## Running it',
    '',
    'From a checkout with `terraform.tfvars` filled in:',
    '',
    '```',
    'terraform init',
    'terraform plan',
    '```',
    '',
    'A landing zone creates resources that cost money every hour they exist: Azure',
    'Firewall, Bastion, the Log Analytics workspace and the DDoS plan if you enable one.',
    'Read the plan, and destroy what you built when the lesson is over.'
  );
  return file('README.md', lines);
}

/**
 * The Terraform files for a build.
 *
 * @param {{ selected?: string[], options?: object }} state
 * @returns {Array<{ path: string, content: string }>}
 */
export function emitFiles(state) {
  const normalized = normalizeState(state);
  if (!normalized.selected.length) return [readmeMd(normalized, [])];

  const files = [terraformTf(), providersTf(normalized)];
  if (isSelected(normalized, 'management-groups')) files.push(alzTf(normalized));
  if (isSelected(normalized, 'management')) files.push(managementTf());
  if (isSelected(normalized, 'connectivity-hub')) files.push(connectivityTf(normalized));
  if (
    isSelected(normalized, 'identity') ||
    isSelected(normalized, 'corp') ||
    isSelected(normalized, 'online')
  ) {
    files.push(applicationTf(normalized));
  }
  files.push(variablesTf(normalized), tfvarsExample(normalized));
  files.push(readmeMd(normalized, files));
  return files;
}
