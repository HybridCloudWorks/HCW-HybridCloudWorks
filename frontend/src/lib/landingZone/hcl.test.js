/**
 * The Terraform the Landing Zone Builder emits (#667). The shape checks are
 * what `terraform fmt -check` would enforce, written out so CI without
 * terraform still fails on a tab or a trailing space; the snapshot is the
 * whole default build, so a change to any emitted line is reviewed as a diff
 * of the Terraform, not of the emitter.
 */
import { describe, it, expect } from 'vitest';
import {
  AVM_MODULES,
  AVM_SOURCES,
  DEFAULT_STATE,
  POLICY_DEFAULTS,
  emitFiles,
  normalizeState,
} from './index';

const ARCHIVED = 'avm-ptn-hubnetworking';
const UNPUBLISHED = 'avm-ptn-alz-application-landing-zone-identity-and-access';

/** Every module `source = "..."`; terraform.tf holds provider sources, which are not modules. */
const sourcesIn = (files) =>
  files
    .filter((f) => f.path !== 'terraform.tf')
    .flatMap((f) => [...f.content.matchAll(/^\s*source\s*=\s*"([^"]+)"/gm)].map((m) => m[1]));

const byPath = (files) => Object.fromEntries(files.map((f) => [f.path, f.content]));

const SOME_BUILDS = [
  ['default', DEFAULT_STATE],
  ['empty', normalizeState({ selected: [] })],
  ['tree only', normalizeState({ selected: ['management-groups'] })],
  ['policy without a hub', normalizeState({ selected: ['policy'] })],
  [
    'hub, no firewall, no dns',
    normalizeState({ selected: ['connectivity-hub'], options: { privateDnsZones: false } }),
  ],
  ['firewall basic', normalizeState({ selected: ['firewall'], options: { firewallSku: 'Basic' } })],
  ['identity only', normalizeState({ selected: ['identity'] })],
  [
    'five and five',
    normalizeState({ options: { corpCount: 5, onlineCount: 5, firewallSku: 'Premium' } }),
  ],
  ['nested under contoso', normalizeState({ options: { rootParentId: 'contoso' } })],
];

describe('emitFiles', () => {
  it('emits fmt-shaped files: no tabs, no trailing whitespace, one newline at EOF', () => {
    for (const [name, state] of SOME_BUILDS) {
      const files = emitFiles(state);
      expect(files.length, name).toBeGreaterThan(0);
      for (const f of files) {
        const where = `${name} ${f.path}`;
        expect(f.content, where).not.toMatch(/\t/);
        expect(f.content, where).not.toMatch(/[ ]+$/m);
        expect(f.content.endsWith('\n'), where).toBe(true);
        expect(f.content.endsWith('\n\n'), where).toBe(false);
        expect(f.content, where).not.toMatch(/\r/);
        expect(f.content, where).not.toMatch(/\n\n\n/);
        if (f.path.endsWith('.tf')) {
          for (const line of f.content.split('\n')) {
            const indent = /^ */.exec(line)[0].length;
            expect(indent % 2, `${where}: "${line}"`).toBe(0);
          }
        }
      }
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it('pins every module source, always with a version, and never the archived or unpublished module', () => {
    for (const [name, state] of SOME_BUILDS) {
      const files = emitFiles(state);
      for (const source of sourcesIn(files)) {
        expect(AVM_SOURCES, `${name}: ${source}`).toContain(source);
      }
      for (const f of files) {
        const lines = f.content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*source\s*=\s*"Azure\/avm-/.test(line)) {
            expect(lines[i + 1], `${name} ${f.path}:${i + 1}`).toMatch(
              /^\s*version = "\d+\.\d+\.\d+"$/
            );
          }
        });
      }
      const all = files.map((f) => f.content).join('\n');
      expect(all, name).not.toContain(ARCHIVED);
      expect(all, name).not.toContain('hubnetworking');
      expect(all, name).not.toContain(UNPUBLISHED);
    }
    const full = emitFiles(DEFAULT_STATE);
    expect(new Set(sourcesIn(full))).toEqual(new Set(AVM_SOURCES));
    const text = full.map((f) => f.content).join('\n');
    for (const m of Object.values(AVM_MODULES)) expect(text).toContain(`version = "${m.version}"`);
  });

  it('emits only the files whose components are selected', () => {
    const paths = (state) => emitFiles(state).map((f) => f.path);
    expect(paths(DEFAULT_STATE)).toEqual([
      'terraform.tf',
      'providers.tf',
      'alz.tf',
      'management.tf',
      'connectivity.tf',
      'identity.tf',
      'application.tf',
      'variables.tf',
      'terraform.tfvars.example',
      'README.md',
    ]);
    expect(paths({ selected: [] })).toEqual(['README.md']);
    expect(paths({ selected: ['management-groups'] })).toEqual([
      'terraform.tf',
      'providers.tf',
      'alz.tf',
      'variables.tf',
      'terraform.tfvars.example',
      'README.md',
    ]);
    expect(paths({ selected: ['firewall'] })).toEqual([
      'terraform.tf',
      'providers.tf',
      'alz.tf',
      'connectivity.tf',
      'variables.tf',
      'terraform.tfvars.example',
      'README.md',
    ]);
    const identity = paths({ selected: ['identity'] });
    expect(identity).toContain('identity.tf');
    expect(identity).toContain('connectivity.tf');
    expect(identity).not.toContain('application.tf');
    expect(paths({ options: { onlineCount: 0 } })).toContain('application.tf');
  });

  it('turns the options into the modules’ current inputs', () => {
    const full = byPath(emitFiles(DEFAULT_STATE));
    expect(full['alz.tf']).toContain('architecture_name  = "alz"');
    expect(full['alz.tf']).toContain(
      'parent_resource_id = coalesce(var.parent_management_group_id, data.azapi_client_config.current.tenant_id)'
    );
    expect(full['alz.tf']).toContain('management_group_name = "corp"');
    expect(full['alz.tf']).toContain('subscription_id       = var.online_subscription_ids[0]');
    expect(full['alz.tf']).toContain('subscription_id       = var.identity_subscription_id');
    expect(full['alz.tf']).toContain('module.alz.management_group_resource_ids["alz"]');
    expect(full['management.tf']).toContain(
      'log_analytics_workspace_name = local.log_analytics_workspace_name'
    );
    expect(full['connectivity.tf']).toContain('default_hub_address_space = var.hub_address_space');
    expect(full['connectivity.tf']).toContain('sku_tier = "Standard"');
    expect(full['connectivity.tf']).toContain('private_dns_zones                     = true');
    expect(full['variables.tf']).toContain('default     = "10.0.0.0/16"');
    expect(full['variables.tf']).toContain('default     = "10.1.0.0/16"');
    expect(full['variables.tf']).toContain('default     = "centralus"');
    expect(full['variables.tf']).toContain('default     = null');
    expect(full['providers.tf']).toContain('ref  = "2026.08.1"');
    expect(full['providers.tf']).toContain('alias           = "corp_1"');
    expect(full['providers.tf']).toMatch(/provider "azapi" \{\n  alias           = "online_1"/);
    expect(full['terraform.tf']).toContain('required_version = ">= 1.12, < 2.0"');
    for (const provider of ['alz', 'azapi', 'azurerm', 'random']) {
      expect(full['terraform.tf']).toMatch(new RegExp(`^    ${provider} = \\{$`, 'm'));
    }
    expect(full['README.md']).toContain('never been applied by HybridCloudWorks');
    expect(full['README.md']).toContain('HCP Terraform');
    expect(full['README.md']).toContain('tenant');
    expect(full['README.md']).toContain('service principal');
    expect(full['README.md']).toContain('spoke virtual network');
    expect(full['terraform.tfvars.example']).not.toContain('parent_management_group_id');

    const custom = byPath(
      emitFiles({
        options: {
          hubCidr: '10.42.0.0/16',
          spokeCidr: '10.43.0.0/16',
          firewallSku: 'Premium',
          privateDnsZones: false,
          location: 'westeurope',
          corpCount: 2,
          onlineCount: 0,
          rootParentId: 'contoso',
        },
      })
    );
    expect(custom['connectivity.tf']).toContain('sku_tier = "Premium"');
    expect(custom['connectivity.tf']).toContain('sku = "Premium"');
    expect(custom['connectivity.tf']).toContain('private_dns_zones                     = false');
    expect(custom['variables.tf']).toContain('default     = "10.42.0.0/16"');
    expect(custom['variables.tf']).toContain('default     = "10.43.0.0/16"');
    expect(custom['variables.tf']).toContain('default     = "westeurope"');
    expect(custom['variables.tf']).toContain('default     = "contoso"');
    expect(custom['variables.tf']).toContain('length(var.corp_subscription_ids) == 2');
    expect(custom['variables.tf']).not.toContain('online_subscription_ids');
    expect(custom['application.tf']).toContain('module "spoke_corp_2"');
    expect(custom['application.tf']).not.toContain('online_1');
    expect(custom['application.tf']).not.toContain('spoke_online');
    expect(custom['terraform.tfvars.example']).toMatch(/parent_management_group_id\s+= "contoso"/);
    expect(custom['terraform.tfvars.example']).toContain(
      'corp_subscription_ids        = ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"]'
    );

    const noFirewall = byPath(emitFiles({ selected: ['connectivity-hub'] }));
    expect(noFirewall['connectivity.tf']).toContain(
      'firewall                              = false'
    );
    expect(noFirewall['connectivity.tf']).not.toContain('sku_tier');
    expect(noFirewall['alz.tf']).not.toContain('policy_default_values');
  });

  it('builds a spoke per landing zone: a /24, a two-way hub peering, and a firewall route only where private', () => {
    const full = byPath(emitFiles(DEFAULT_STATE));
    const app = full['application.tf'];
    expect(app).toContain('corp_1   = cidrsubnet(var.spoke_address_space, 8, 0)');
    expect(app).toContain('online_1 = cidrsubnet(var.spoke_address_space, 8, 128)');
    expect(app).toContain(
      '# For 10.1.0.0/16 that is corp_1 = 10.1.0.0/24, online_1 = 10.1.128.0/24.'
    );
    expect(app).toContain('resource "azurerm_resource_group" "spoke_corp_1"');
    expect(app).toContain('resource "azurerm_route_table" "spoke_corp_1"');
    expect(app).not.toContain('resource "azurerm_route_table" "spoke_online_1"');
    expect(app).toContain(
      'next_hop_in_ip_address = module.connectivity.firewall_private_ip_addresses["primary"]'
    );
    expect(app).toContain('bgp_route_propagation_enabled = false');
    expect(app).toContain('module "spoke_corp_1"');
    expect(app).toContain('module "spoke_online_1"');
    expect(app).toContain('parent_id        = azurerm_resource_group.spoke_corp_1.id');
    expect(app).toContain('address_space    = [local.spoke_address_spaces.corp_1]');
    expect(app).toContain(
      'remote_virtual_network_resource_id = module.connectivity.virtual_network_resource_ids["primary"]'
    );
    expect(app).toContain('create_reverse_peering             = true');
    expect(app).toContain('reverse_name                       = "peer-hub-to-online-1"');
    expect(app).toMatch(/providers = \{\n    azapi = azapi\.corp_1\n  \}/);
    expect(app).not.toContain('resource_group_name = "');

    const identity = full['identity.tf'];
    expect(identity).toContain(
      'identity_address_space = cidrsubnet(var.spoke_address_space, 8, 127)'
    );
    expect(identity).toContain('(10.1.127.0/24 for 10.1.0.0/16)');
    expect(identity).toContain('resource "azurerm_route_table" "spoke_identity"');
    expect(identity).toContain('module "spoke_identity"');

    const noFirewall = byPath(emitFiles({ selected: ['identity', 'corp'] }));
    expect(noFirewall['identity.tf']).not.toContain('azurerm_route_table');
    expect(noFirewall['application.tf']).not.toContain('azurerm_route_table');
    expect(noFirewall['application.tf']).not.toContain('route_table');

    const five = byPath(
      emitFiles({ options: { corpCount: 5, onlineCount: 5, spokeCidr: '10.8.0.0/20' } })
    );
    expect(five['application.tf']).toContain(
      'corp_5   = cidrsubnet(var.spoke_address_space, 4, 4)'
    );
    expect(five['application.tf']).toContain(
      'online_5 = cidrsubnet(var.spoke_address_space, 4, 12)'
    );
    expect(five['identity.tf']).toContain('cidrsubnet(var.spoke_address_space, 4, 7)');
    expect(five['variables.tf']).toContain('length(var.online_subscription_ids) == 5');
  });

  it('supplies every policy default the pinned library declares, or stops enforcing its assignment', () => {
    const names = POLICY_DEFAULTS.map((d) => d.name);
    expect(names).toEqual([
      'private_dns_zone_subscription_id',
      'private_dns_zone_resource_group_name',
      'private_dns_zone_region',
      'ama_user_assigned_managed_identity_id',
      'ama_user_assigned_managed_identity_name',
      'ama_vm_insights_data_collection_rule_id',
      'ama_mdfc_sql_data_collection_rule_id',
      'ama_change_tracking_data_collection_rule_id',
      'ddos_protection_plan_id',
      'log_analytics_workspace_id',
      'resource_group_location',
      'resource_group_name_service_health_alerts',
      'resource_group_name_mdfc',
      'email_security_contact',
    ]);

    const full = byPath(emitFiles(DEFAULT_STATE))['alz.tf'];
    for (const name of names.filter((n) => n !== 'ddos_protection_plan_id')) {
      expect(full, name).toMatch(new RegExp(`^    ${name}\\s+= jsonencode\\(\\{ value = `, 'm'));
    }
    expect(full).not.toMatch(/^\s*ddos_protection_plan_id\s+=/m);
    expect(full).toContain('Enable-DDoS-VNET');
    expect(full).not.toContain('Deploy-Private-DNS-Zones');
    expect(full).toMatch(
      /private_dns_zone_resource_group_name\s+= jsonencode\(\{ value = azurerm_resource_group\.connectivity\.name \}\)/
    );
    expect(full).toContain('email_security_contact');
    expect(full).toContain(
      '"Microsoft.OperationalInsights/workspaces", [local.log_analytics_workspace_name]'
    );
    expect(full).toContain('module.management.resource_id');
    expect(full).not.toContain('replace_me');
    expect(full).not.toContain('00000000-0000-0000-0000-000000000000');

    const noDns = byPath(emitFiles({ options: { privateDnsZones: false } }))['alz.tf'];
    expect(noDns).toContain('Deploy-Private-DNS-Zones');
    expect(noDns).not.toContain('private_dns_zone_subscription_id');
    expect(noDns).toMatch(
      /corp = \{\n      policy_assignments = \{\n        Deploy-Private-DNS-Zones = \{/
    );

    const policyNoHub = byPath(emitFiles({ selected: ['policy'] }));
    expect(policyNoHub['alz.tf']).toContain('Deploy-Private-DNS-Zones');
    expect(policyNoHub['alz.tf']).toContain('policy_default_values');
    expect(policyNoHub['management.tf']).toContain('module "management"');
    expect(policyNoHub['variables.tf']).toContain('variable "security_contact_email"');
    expect(policyNoHub['terraform.tfvars.example']).toContain(
      'security_contact_email     = "security@example.com"'
    );
    expect(byPath(emitFiles({ selected: ['management-groups'] }))['variables.tf']).not.toContain(
      'security_contact_email'
    );
  });

  it('matches the committed snapshot of the default build', () => {
    const files = emitFiles(DEFAULT_STATE);
    expect(files.map((f) => f.path)).toMatchSnapshot('paths');
    for (const f of files) expect(f.content).toMatchSnapshot(f.path);
  });

  it('lists every selected component in the README', () => {
    const readme = byPath(emitFiles(DEFAULT_STATE))['README.md'];
    for (const label of [
      'Management groups',
      'Policy baseline',
      'Management',
      'Connectivity hub',
      'Azure Firewall',
      'Identity',
      'Corp landing zone (1)',
      'Online landing zone (1)',
    ]) {
      expect(readme).toContain(`**${label}**`);
    }
    expect(readme).toContain('`Azure/avm-res-network-virtualnetwork/azurerm` 0.22.2');
  });
});
