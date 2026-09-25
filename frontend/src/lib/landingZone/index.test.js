/**
 * The Landing Zone Builder's catalogue, state, URL and diagram (#667). The
 * emitter has its own file, hcl.test.js, because its snapshot is long.
 */
import { describe, it, expect } from 'vitest';
import {
  APPLICATION_IDS,
  AVM_MODULES,
  AVM_MODULE_NAMES,
  AVM_SOURCES,
  AVM_VERIFIED_ON,
  COMPONENTS,
  COMPONENT_IDS,
  DEFAULT_OPTIONS,
  DEFAULT_STATE,
  OPTIONS,
  OPTION_IDS,
  PLATFORM_IDS,
  addComponent,
  componentById,
  componentByShortId,
  decodeLz,
  dependentsOf,
  encodeLz,
  isAvmSource,
  isCidr,
  isComponentId,
  isLandingZoneCount,
  isLocation,
  isLzParam,
  isManagementGroupId,
  layoutDiagram,
  normalizeState,
  removeWithDependents,
  setOption,
  withDependencies,
} from './index';

const sentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe('the catalogue', () => {
  it('has the eight components in two groups, in the order the issue lists them', () => {
    expect(PLATFORM_IDS).toEqual([
      'management-groups',
      'policy',
      'management',
      'connectivity-hub',
      'firewall',
      'identity',
    ]);
    expect(APPLICATION_IDS).toEqual(['corp', 'online']);
    expect(COMPONENT_IDS).toEqual([...PLATFORM_IDS, ...APPLICATION_IDS]);
    for (const c of COMPONENTS) {
      for (const dep of c.dependsOn) expect(COMPONENT_IDS, `${c.id} needs ${dep}`).toContain(dep);
    }
  });

  it('gives every component every field, and a teaches text a beginner can read', () => {
    for (const c of COMPONENTS) {
      expect(['platform', 'application']).toContain(c.group);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.summary.trim().endsWith('.')).toBe(true);
      expect(sentences(c.summary), `${c.id} summary is one sentence`).toBe(1);
      const n = sentences(c.teaches);
      expect(n, `${c.id} teaches ${n} sentences`).toBeGreaterThanOrEqual(3);
      expect(n, `${c.id} teaches ${n} sentences`).toBeLessThanOrEqual(5);
      expect(typeof c.shortId).toBe('string');
      expect(Array.isArray(c.dependsOn)).toBe(true);
      expect(Array.isArray(c.options)).toBe(true);
      for (const id of c.options) expect(OPTION_IDS).toContain(id);
      if (c.avm === null) {
        expect(['policy', 'firewall']).toContain(c.id);
      } else {
        expect(isAvmSource(c.avm.source), `${c.id} source pinned`).toBe(true);
        expect(c.avm.version).toBe(
          Object.values(AVM_MODULES).find((m) => m.source === c.avm.source).version
        );
      }
      expect(Object.isFrozen(c)).toBe(true);
    }
    expect(Object.isFrozen(COMPONENTS)).toBe(true);
    expect(Object.isFrozen(OPTIONS)).toBe(true);
  });

  it('declares the dependencies the issue lists', () => {
    const deps = Object.fromEntries(COMPONENTS.map((c) => [c.id, [...c.dependsOn]]));
    expect(deps).toEqual({
      'management-groups': [],
      policy: ['management-groups', 'management'],
      management: ['management-groups'],
      'connectivity-hub': ['management-groups'],
      firewall: ['connectivity-hub'],
      identity: ['management-groups'],
      corp: ['management-groups', 'connectivity-hub'],
      online: ['management-groups', 'connectivity-hub'],
    });
  });

  it('finds a component by id and by short id', () => {
    expect(componentById('firewall').shortId).toBe('fw');
    expect(componentByShortId('mgmt').id).toBe('management');
    expect(componentById('nope')).toBeNull();
    expect(componentByShortId('nope')).toBeNull();
    expect(isComponentId('corp')).toBe(true);
    expect(isComponentId('Corp')).toBe(false);
  });

  it('pins exactly the four modules, dated, and the archived one is not among them', () => {
    expect(AVM_MODULE_NAMES).toEqual([
      'avm-ptn-alz',
      'avm-ptn-alz-management',
      'avm-ptn-alz-connectivity-hub-and-spoke-vnet',
      'avm-ptn-alz-application-landing-zone-identity-and-access',
    ]);
    expect(AVM_VERIFIED_ON).toBe('2026-09-25');
    for (const m of Object.values(AVM_MODULES)) {
      expect(m.source).toBe(`Azure/${m.name}/azurerm`);
      expect(m.verifiedOn).toBe(AVM_VERIFIED_ON);
      if (m.version === null) expect(m.note).toMatch(/Not on the Terraform Registry/);
      else expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Object.isFrozen(m)).toBe(true);
    }
    expect(AVM_SOURCES.join(' ')).not.toContain('hubnetworking');
    expect(isAvmSource('Azure/avm-ptn-hubnetworking/azurerm')).toBe(false);
  });
});

describe('the validators', () => {
  it('accept a hub-sized CIDR and refuse the rest', () => {
    for (const ok of ['10.0.0.0/16', '192.168.0.0/24', '172.16.0.0/12', '10.0.0.0/8']) {
      expect(isCidr(ok), ok).toBe(true);
    }
    for (const bad of [
      '10.0.0.0',
      '10.0.0.0/25',
      '10.0.0.0/7',
      '256.0.0.0/16',
      '10.0.0/16',
      'x',
      1,
      null,
    ]) {
      expect(isCidr(bad), String(bad)).toBe(false);
    }
  });

  it('accept a region id, a count in range and a management group id', () => {
    expect(isLocation('centralus')).toBe(true);
    expect(isLocation('westeurope')).toBe(true);
    expect(isLocation('West Europe')).toBe(false);
    expect(isLocation('')).toBe(false);
    for (const ok of [0, 1, 5, '3']) expect(isLandingZoneCount(ok), String(ok)).toBe(true);
    for (const bad of [-1, 6, 1.5, '', null, true, 'two']) {
      expect(isLandingZoneCount(bad), String(bad)).toBe(false);
    }
    expect(isManagementGroupId('alz')).toBe(true);
    expect(isManagementGroupId('contoso-root_1.0(a)')).toBe(true);
    expect(isManagementGroupId('-alz')).toBe(false);
    expect(isManagementGroupId('a/b')).toBe(false);
    expect(isManagementGroupId('x'.repeat(91))).toBe(false);
  });
});

describe('the state', () => {
  it('defaults to the whole landing zone with one corp and one online', () => {
    expect(DEFAULT_STATE.selected).toEqual(COMPONENT_IDS);
    expect(DEFAULT_STATE.options).toEqual({
      location: 'centralus',
      rootParentId: 'alz',
      hubCidr: '10.0.0.0/16',
      privateDnsZones: true,
      firewallSku: 'Standard',
      corpCount: 1,
      onlineCount: 1,
    });
    expect(DEFAULT_OPTIONS).toEqual(DEFAULT_STATE.options);
    expect(normalizeState({})).toEqual(DEFAULT_STATE);
    expect(normalizeState(null)).toEqual(DEFAULT_STATE);
  });

  it('closes the selection over dependsOn, in catalogue order', () => {
    expect(withDependencies(['firewall'])).toEqual([
      'management-groups',
      'connectivity-hub',
      'firewall',
    ]);
    expect(withDependencies(['policy'])).toEqual(['management-groups', 'policy', 'management']);
    expect(withDependencies(['online', 'bogus', 'online'])).toEqual([
      'management-groups',
      'connectivity-hub',
      'online',
    ]);
    expect(withDependencies([])).toEqual([]);
    expect(withDependencies(undefined)).toEqual([]);
    expect(dependentsOf('connectivity-hub')).toEqual(['firewall', 'corp', 'online']);
    expect(dependentsOf('management-groups')).toEqual(COMPONENT_IDS.slice(1));
    expect(dependentsOf('firewall')).toEqual([]);
  });

  it('keeps counts and selection in step', () => {
    const noCorp = normalizeState({ options: { corpCount: 0 } });
    expect(noCorp.selected).not.toContain('corp');
    expect(noCorp.options.corpCount).toBe(0);
    const listed = normalizeState({ selected: ['corp'], options: { corpCount: 0 } });
    expect(listed.selected).toEqual(['management-groups', 'connectivity-hub', 'corp']);
    expect(listed.options.corpCount).toBe(1);
    expect(listed.options.onlineCount).toBe(0);
    const empty = normalizeState({ selected: [] });
    expect(empty.selected).toEqual([]);
    expect(empty.options.corpCount).toBe(0);
    expect(empty.options.onlineCount).toBe(0);
  });

  it('falls back to defaults for options that do not validate', () => {
    const s = normalizeState({
      options: {
        hubCidr: '10.0.0.0/30',
        firewallSku: 'Ultra',
        privateDnsZones: 'yes',
        location: 'West US',
        corpCount: 9,
        onlineCount: '2',
        rootParentId: '/alz',
      },
    });
    expect(s.options).toEqual({ ...DEFAULT_OPTIONS, onlineCount: 2 });
  });

  it('adds with dependencies and removes with dependents', () => {
    const empty = normalizeState({ selected: [] });
    const withFirewall = addComponent(empty, 'firewall');
    expect(withFirewall.selected).toEqual(['management-groups', 'connectivity-hub', 'firewall']);
    const withCorp = addComponent(empty, 'corp');
    expect(withCorp.options.corpCount).toBe(1);
    expect(addComponent(empty, 'bogus')).toEqual(empty);

    const noHub = removeWithDependents(DEFAULT_STATE, 'connectivity-hub');
    expect(noHub.selected).toEqual(['management-groups', 'policy', 'management', 'identity']);
    expect(noHub.options.corpCount).toBe(0);
    expect(noHub.options.onlineCount).toBe(0);
    const nothing = removeWithDependents(DEFAULT_STATE, 'management-groups');
    expect(nothing.selected).toEqual([]);
    expect(removeWithDependents(DEFAULT_STATE, 'bogus')).toEqual(DEFAULT_STATE);
  });

  it('sets an option, ignoring an invalid value, and counts drive selection', () => {
    const premium = setOption(DEFAULT_STATE, 'firewallSku', 'Premium');
    expect(premium.options.firewallSku).toBe('Premium');
    expect(setOption(DEFAULT_STATE, 'firewallSku', 'Free')).toEqual(DEFAULT_STATE);
    expect(setOption(DEFAULT_STATE, 'nope', 1)).toEqual(DEFAULT_STATE);
    const noOnline = setOption(DEFAULT_STATE, 'onlineCount', 0);
    expect(noOnline.selected).not.toContain('online');
    const twoCorp = setOption(normalizeState({ selected: [] }), 'corpCount', '2');
    expect(twoCorp.selected).toEqual(['management-groups', 'connectivity-hub', 'corp']);
    expect(twoCorp.options.corpCount).toBe(2);
  });
});

describe('the shareable URL', () => {
  it('encodes the default build as a bare URL and only what differs otherwise', () => {
    expect(encodeLz(DEFAULT_STATE)).toEqual({});
    expect(encodeLz({})).toEqual({});
    expect(
      encodeLz({
        selected: [
          'management-groups',
          'policy',
          'management',
          'connectivity-hub',
          'firewall',
          'corp',
        ],
        options: {
          hubCidr: '10.1.0.0/16',
          firewallSku: 'Premium',
          privateDnsZones: false,
          location: 'westeurope',
          corpCount: 2,
          onlineCount: 1,
          rootParentId: 'contoso',
        },
      })
    ).toEqual({
      lz: 'mg,policy,mgmt,hub,fw',
      'hub.cidr': '10.1.0.0/16',
      'fw.sku': 'Premium',
      dns: '0',
      loc: 'westeurope',
      corp: '2',
      online: '0',
      root: 'contoso',
    });
    expect(encodeLz({ options: { corpCount: 0 } })).toEqual({ corp: '0' });
    expect(encodeLz({ selected: [] })).toEqual({ lz: '', corp: '0', online: '0' });
  });

  it('round-trips through URLSearchParams', () => {
    const state = normalizeState({
      selected: ['management-groups', 'management', 'connectivity-hub', 'firewall', 'corp'],
      options: { firewallSku: 'Basic', corpCount: 3, onlineCount: 0, location: 'uksouth' },
    });
    const params = new URLSearchParams(encodeLz(state));
    expect(params.toString()).toBe(
      'lz=mg%2Cmgmt%2Chub%2Cfw&fw.sku=Basic&loc=uksouth&corp=3&online=0'
    );
    expect(decodeLz(params)).toEqual(state);
    expect(decodeLz(new URLSearchParams(encodeLz(decodeLz(params))))).toEqual(state);
    expect(decodeLz(encodeLz(state))).toEqual(state);
  });

  it('decodes the documented shape', () => {
    const decoded = decodeLz(
      new URLSearchParams(
        'lz=mg,policy,mgmt,hub,fw,id&hub.cidr=10.0.0.0/16&fw.sku=Premium&dns=0&loc=westeurope&corp=2&online=1&root=alz'
      )
    );
    expect(decoded).toEqual(
      normalizeState({
        selected: COMPONENT_IDS,
        options: {
          firewallSku: 'Premium',
          privateDnsZones: false,
          location: 'westeurope',
          corpCount: 2,
        },
      })
    );
  });

  it('drops junk, applies dependencies and defaults the rest', () => {
    const decoded = decodeLz(
      new URLSearchParams(
        'lz=fw,teleport,,id&hub.cidr=300.0.0.0/16&fw.sku=ultra&dns=maybe&loc=West%20Europe&corp=7&online=abc&root=/x&region=westeurope'
      )
    );
    expect(decoded).toEqual(
      normalizeState({
        selected: [
          'management-groups',
          'connectivity-hub',
          'firewall',
          'identity',
          'corp',
          'online',
        ],
      })
    );
    expect(decoded.selected).toEqual([
      'management-groups',
      'connectivity-hub',
      'firewall',
      'identity',
      'corp',
      'online',
    ]);
    expect(decodeLz(null)).toEqual(DEFAULT_STATE);
    expect(decodeLz(new URLSearchParams(''))).toEqual(DEFAULT_STATE);
    expect(decodeLz(new URLSearchParams('lz=&corp=0&online=0')).selected).toEqual([]);
    expect(decodeLz(new URLSearchParams('lz=mg&corp=0&online=0')).selected).toEqual([
      'management-groups',
    ]);
    expect(decodeLz(new URLSearchParams('lz=corp&corp=0')).options.corpCount).toBe(1);
    expect(decodeLz(new URLSearchParams('dns=false')).options.privateDnsZones).toBe(false);
    expect(decodeLz(new URLSearchParams('dns=true')).options.privateDnsZones).toBe(true);
  });

  it('knows which keys are its own', () => {
    for (const key of ['lz', 'hub.cidr', 'fw.sku', 'dns', 'loc', 'corp', 'online', 'root']) {
      expect(isLzParam(key), key).toBe(true);
    }
    for (const key of ['region', 'scenario', 'q.compute-vm', 'tab', '']) {
      expect(isLzParam(key), key).toBe(false);
    }
  });
});

describe('the diagram', () => {
  const overlaps = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('is deterministic and its nodes never overlap', () => {
    const states = [
      DEFAULT_STATE,
      normalizeState({ selected: ['firewall'] }),
      normalizeState({ options: { corpCount: 5, onlineCount: 5, privateDnsZones: false } }),
      normalizeState({ selected: ['management-groups'] }),
      normalizeState({ selected: ['policy', 'identity'] }),
    ];
    for (const state of states) {
      const a = layoutDiagram(state);
      const b = layoutDiagram(state);
      expect(a).toEqual(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (let i = 0; i < a.nodes.length; i += 1) {
        for (let j = i + 1; j < a.nodes.length; j += 1) {
          expect(overlaps(a.nodes[i], a.nodes[j]), `${a.nodes[i].id} vs ${a.nodes[j].id}`).toBe(
            false
          );
        }
      }
      for (const n of a.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.w).toBeLessThanOrEqual(a.width);
        expect(n.y + n.h).toBeLessThanOrEqual(a.height);
      }
      const ids = new Set(a.nodes.map((n) => n.id));
      expect(ids.size).toBe(a.nodes.length);
      for (const e of a.edges) {
        expect(ids.has(e.from), e.from).toBe(true);
        expect(ids.has(e.to), e.to).toBe(true);
      }
    }
  });

  it('draws the tree the selection describes', () => {
    const full = layoutDiagram(DEFAULT_STATE);
    const kinds = full.nodes.map((n) => `${n.kind}:${n.id}`);
    expect(kinds).toContain('management-group:mg:alz');
    expect(kinds).toContain('policy:policy');
    expect(kinds).toContain('workspace:sub:management');
    expect(kinds).toContain('vnet:hub');
    expect(kinds).toContain('firewall:firewall');
    expect(kinds).toContain('dns:dns');
    expect(kinds).toContain('subscription:sub:identity');
    expect(kinds).toContain('spoke:spoke:corp-1');
    expect(kinds).toContain('spoke:spoke:online-1');
    expect(
      full.edges
        .filter((e) => e.kind === 'peering')
        .map((e) => e.to)
        .sort()
    ).toEqual(['spoke:corp-1', 'spoke:online-1', 'sub:identity']);
    expect(full.nodes.find((n) => n.id === 'hub').label).toBe('Hub VNet 10.0.0.0/16');

    const hubOnly = layoutDiagram(normalizeState({ selected: ['connectivity-hub'] }));
    expect(hubOnly.nodes.map((n) => n.id)).toEqual([
      'mg:alz',
      'mg:platform',
      'mg:connectivity',
      'hub',
      'dns',
    ]);
    expect(hubOnly.edges).toEqual([
      { from: 'mg:alz', to: 'mg:platform', kind: 'contains' },
      { from: 'mg:platform', to: 'mg:connectivity', kind: 'contains' },
      { from: 'mg:connectivity', to: 'hub', kind: 'contains' },
      { from: 'hub', to: 'dns', kind: 'contains' },
    ]);

    expect(layoutDiagram({ selected: [] })).toEqual({ width: 0, height: 0, nodes: [], edges: [] });
    expect(layoutDiagram({ options: { rootParentId: 'contoso' } }).nodes[0].label).toBe('contoso');
  });
});
