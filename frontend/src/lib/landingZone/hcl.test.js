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
  COMPONENT_IDS,
  DEFAULT_STATE,
  emitFiles,
  normalizeState,
} from './index';

const ARCHIVED = 'avm-ptn-hubnetworking';

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

  it('pins every module source to avmVersions.js and never emits the archived module', () => {
    for (const [name, state] of SOME_BUILDS) {
      const files = emitFiles(state);
      const sources = sourcesIn(files);
      for (const source of sources) expect(AVM_SOURCES, `${name}: ${source}`).toContain(source);
      const all = files.map((f) => f.content).join('\n');
      expect(all, name).not.toContain(ARCHIVED);
      expect(all, name).not.toContain('hubnetworking');
    }
    const full = emitFiles(DEFAULT_STATE);
    expect(new Set(sourcesIn(full))).toEqual(new Set(AVM_SOURCES));
    const text = full.map((f) => f.content).join('\n');
    for (const m of Object.values(AVM_MODULES)) {
      if (m.version) expect(text).toContain(`version = "${m.version}"`);
      else expect(text).toContain(`Not on the Terraform Registry on ${m.verifiedOn}`);
    }
  });

  it('emits only the files whose components are selected', () => {
    const paths = (state) => emitFiles(state).map((f) => f.path);
    expect(paths(DEFAULT_STATE)).toEqual([
      'terraform.tf',
      'providers.tf',
      'alz.tf',
      'management.tf',
      'connectivity.tf',
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
    expect(paths({ selected: ['identity'] })).toContain('application.tf');
    expect(paths({ selected: ['identity'] })).not.toContain('connectivity.tf');
  });

  it('turns the options into the modules’ current inputs', () => {
    const full = byPath(emitFiles(DEFAULT_STATE));
    expect(full['alz.tf']).toContain('architecture_name  = "alz"');
    expect(full['alz.tf']).toContain(
      'parent_resource_id = data.azapi_client_config.current.tenant_id'
    );
    expect(full['alz.tf']).toContain('management_group_name = "corp"');
    expect(full['alz.tf']).toContain('subscription_id       = var.subscription_ids_online[0]');
    expect(full['alz.tf']).toContain('policy_default_values');
    expect(full['alz.tf']).toContain(
      '"Microsoft.OperationalInsights/workspaces", [local.log_analytics_workspace_name]'
    );
    expect(full['alz.tf']).toContain('module.management.resource_id');
    expect(full['management.tf']).toContain(
      'log_analytics_workspace_name = local.log_analytics_workspace_name'
    );
    expect(full['connectivity.tf']).toContain('default_hub_address_space = var.hub_address_space');
    expect(full['connectivity.tf']).toContain('sku_tier = "Standard"');
    expect(full['connectivity.tf']).toContain('private_dns_zones                     = true');
    expect(full['variables.tf']).toContain('default     = "10.0.0.0/16"');
    expect(full['variables.tf']).toContain('default     = "centralus"');
    expect(full['providers.tf']).toContain('ref  = "2026.08.1"');
    expect(full['providers.tf']).toContain('alias           = "corp_1"');
    expect(full['application.tf']).toContain('module "corp_1"');
    expect(full['application.tf']).toContain('module "online_1"');
    expect(full['application.tf']).toContain('module "identity"');
    expect(full['terraform.tf']).toContain('required_version = ">= 1.12, < 2.0"');
    for (const provider of ['alz', 'azapi', 'azurerm', 'random']) {
      expect(full['terraform.tf']).toMatch(new RegExp(`^    ${provider} = \\{$`, 'm'));
    }
    expect(full['README.md']).toContain('never been applied by HybridCloudWorks');
    expect(full['README.md']).toContain('HCP Terraform');
    expect(full['README.md']).toContain('tenant');
    expect(full['README.md']).toContain('service principal');

    const custom = byPath(
      emitFiles({
        options: {
          hubCidr: '10.42.0.0/16',
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
    expect(custom['variables.tf']).toContain('default     = "westeurope"');
    expect(custom['variables.tf']).toContain('default     = "contoso"');
    expect(custom['variables.tf']).toContain('length(var.subscription_ids_corp) == 2');
    expect(custom['variables.tf']).not.toContain('subscription_ids_online');
    expect(custom['application.tf']).toContain('module "corp_2"');
    expect(custom['application.tf']).not.toContain('online');
    expect(custom['terraform.tfvars.example']).toContain(
      'subscription_ids_corp        = ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"]'
    );

    const noFirewall = byPath(emitFiles({ selected: ['connectivity-hub'] }));
    expect(noFirewall['connectivity.tf']).toContain(
      'firewall                              = false'
    );
    expect(noFirewall['connectivity.tf']).not.toContain('sku_tier');
    expect(noFirewall['alz.tf']).not.toContain('policy_default_values');

    const policyNoManagement = byPath(emitFiles({ selected: ['management-groups', 'policy'] }));
    expect(policyNoManagement['alz.tf']).toContain('policy_default_values');
    expect(policyNoManagement['management.tf']).toContain('module "management"');
  });

  it('matches the committed snapshot of the default build', () => {
    const files = emitFiles(DEFAULT_STATE);
    expect(files.map((f) => f.path)).toMatchSnapshot('paths');
    for (const f of files) expect(f.content).toMatchSnapshot(f.path);
  });

  it('every component appears in the default README', () => {
    const readme = byPath(emitFiles(DEFAULT_STATE))['README.md'];
    for (const id of COMPONENT_IDS) {
      const label = { corp: 'Corp landing zone', online: 'Online landing zone' }[id];
      if (label) expect(readme).toContain(label);
    }
    expect(readme).toContain('Management groups');
    expect(readme).toContain('Azure Firewall');
  });
});
