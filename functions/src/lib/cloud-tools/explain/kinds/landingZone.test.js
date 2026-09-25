import { describe, expect, it, vi } from 'vitest';

import { AI_FEATURES } from '../../../ai/ai-config.js';
import {
  LANDING_ZONE_COMPONENT_IDS,
  LANDING_ZONE_EXPLAIN_FEATURE,
  LANDING_ZONE_KIND,
  LANDING_ZONE_MAX_SELECTED,
  LANDING_ZONE_MAX_TEACHES_CHARS,
  LANDING_ZONE_MODULES,
  LANDING_ZONE_OPTION_KEYS,
  LANDING_ZONE_SYSTEM_PROMPT,
  canonicalLandingZoneExplainRequest,
  landingZoneExplainPrompt,
  validateLandingZoneExplainRequest,
} from './landingZone.js';

const validBody = () => ({
  kind: 'landing-zone',
  componentId: 'firewall',
  selected: ['management-groups', 'connectivity-hub', 'firewall', 'corp'],
  options: {
    location: 'centralus',
    hubCidr: '10.0.0.0/16',
    spokeCidr: '10.1.0.0/16',
    firewallSku: 'Premium',
    privateDnsZones: true,
    corpCount: 2,
    onlineCount: 0,
    rootParentId: '',
  },
  teaches:
    'Azure Firewall is a managed, stateful firewall that sits in its own subnet of the hub. The connectivity module creates it with a firewall policy.',
});

const withOption = (key, value) => {
  const body = validBody();
  body.options = { ...body.options, [key]: value };
  return body;
};

describe('the landing-zone allowlists', () => {
  it('names the eight catalogue components, the four modules and the eight option knobs', () => {
    expect(LANDING_ZONE_COMPONENT_IDS).toEqual([
      'management-groups',
      'policy',
      'management',
      'connectivity-hub',
      'firewall',
      'identity',
      'corp',
      'online',
    ]);
    expect(Object.isFrozen(LANDING_ZONE_COMPONENT_IDS)).toBe(true);
    expect(Object.values(LANDING_ZONE_MODULES)).toEqual([
      'Azure/avm-ptn-alz/azurerm',
      'Azure/avm-ptn-alz-management/azurerm',
      'Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm',
      'Azure/avm-res-network-virtualnetwork/azurerm',
    ]);
    expect(LANDING_ZONE_OPTION_KEYS).toHaveLength(8);
    expect(LANDING_ZONE_MAX_SELECTED).toBe(12);
    expect(LANDING_ZONE_MAX_TEACHES_CHARS).toBe(1200);
  });

  it('runs under a real AI_FEATURES entry, declared as the same literal on the call', async () => {
    expect(LANDING_ZONE_KIND.feature).toBe(LANDING_ZONE_EXPLAIN_FEATURE);
    expect(AI_FEATURES[LANDING_ZONE_EXPLAIN_FEATURE]).toBeDefined();
    const ai = { generateTextResponse: vi.fn(async () => 'text') };
    const value = validateLandingZoneExplainRequest(validBody()).value;
    await LANDING_ZONE_KIND.generate(ai, { value, canonical: 'x', usageOut: [] });
    const call = ai.generateTextResponse.mock.calls[0][0];
    expect(call.feature).toBe(LANDING_ZONE_EXPLAIN_FEATURE);
    expect(call.systemPrompt).toBe(LANDING_ZONE_SYSTEM_PROMPT);
    expect(call.purpose).toBe('general');
    expect(call.prompt).toBe(landingZoneExplainPrompt(value));
  });
});

describe('validateLandingZoneExplainRequest', () => {
  it('accepts the page’s shape and returns it in canonical key order, kind first', () => {
    const { value, error } = validateLandingZoneExplainRequest(validBody());
    expect(error).toBeUndefined();
    expect(Object.keys(value)).toEqual(['kind', 'componentId', 'selected', 'options', 'teaches']);
    expect(value.kind).toBe('landing-zone');
    // Options come back in the fixed order whatever order the client used.
    expect(Object.keys(value.options)).toEqual([...LANDING_ZONE_OPTION_KEYS]);
    expect(value.selected).toEqual(['management-groups', 'connectivity-hub', 'firewall', 'corp']);
  });

  it('accepts the body with kind already taken out by the dispatcher, and defaults absent lists', () => {
    const body = validBody();
    delete body.kind;
    delete body.selected;
    delete body.options;
    const { value, error } = validateLandingZoneExplainRequest(body);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ kind: 'landing-zone', selected: [], options: {} });
  });

  it('accepts every catalogue component and the empty root parent', () => {
    for (const componentId of LANDING_ZONE_COMPONENT_IDS) {
      const { error } = validateLandingZoneExplainRequest({ ...validBody(), componentId });
      expect(error, componentId).toBeUndefined();
    }
    expect(
      validateLandingZoneExplainRequest(withOption('rootParentId', 'contoso-root')).error
    ).toBeUndefined();
  });

  it.each([
    ['not an object', 'nope', /must be a JSON object/],
    ['an unknown top-level key', { ...validBody(), tenantId: 'x' }, /unknown field\(s\): tenantId/],
    ['another kind', { ...validBody(), kind: 'pricing' }, /kind must be landing-zone/],
    [
      'a missing componentId',
      { ...validBody(), componentId: undefined },
      /componentId is required/,
    ],
    [
      'a componentId outside the allowlist',
      { ...validBody(), componentId: 'avm-ptn-hubnetworking' },
      /componentId is not a known component/,
    ],
    [
      'a non-string componentId',
      { ...validBody(), componentId: 3 },
      /componentId must be a string/,
    ],
    [
      'selected that is not an array',
      { ...validBody(), selected: 'firewall' },
      /selected must be an array/,
    ],
    [
      'thirteen selected',
      { ...validBody(), selected: Array(13).fill('corp') },
      /selected may hold at most 12/,
    ],
    [
      'a selected id outside the allowlist',
      { ...validBody(), selected: ['firewall', 'bastion'] },
      /selected\[1\] is not a known component/,
    ],
    [
      'a repeated selected id',
      { ...validBody(), selected: ['firewall', 'firewall'] },
      /selected\[1\] repeats firewall/,
    ],
    ['options that is not an object', { ...validBody(), options: [] }, /options must be an object/],
    [
      'an unknown option',
      withOption('subscriptionId', 'x'),
      /options has unknown field\(s\): subscriptionId/,
    ],
    [
      'a hubCidr that is not a CIDR',
      withOption('hubCidr', '10.0.0.0'),
      /hubCidr must be an IPv4 CIDR/,
    ],
    [
      'a hubCidr over 18 characters',
      withOption('hubCidr', '1'.repeat(19)),
      /hubCidr must be at most 18/,
    ],
    ['a spokeCidr that is not a string', withOption('spokeCidr', 16), /spokeCidr must be a string/],
    [
      'an unknown firewall SKU',
      withOption('firewallSku', 'Ultra'),
      /firewallSku is not a firewall SKU/,
    ],
    [
      'a string privateDnsZones',
      withOption('privateDnsZones', 'yes'),
      /privateDnsZones must be a boolean/,
    ],
    [
      'a location with a space',
      withOption('location', 'central us'),
      /location must be an Azure region id/,
    ],
    [
      'a negative corpCount',
      withOption('corpCount', -1),
      /corpCount must be an integer from 0 to 20/,
    ],
    ['a fractional onlineCount', withOption('onlineCount', 1.5), /onlineCount must be an integer/],
    [
      'an onlineCount over the cap',
      withOption('onlineCount', 21),
      /onlineCount must be an integer from 0 to 20/,
    ],
    [
      'a rootParentId with a slash',
      withOption('rootParentId', 'a/b'),
      /rootParentId must be a management group id/,
    ],
    [
      'a rootParentId over 90 characters',
      withOption('rootParentId', 'a'.repeat(91)),
      /rootParentId must be a management group id/,
    ],
    ['a missing teaches', { ...validBody(), teaches: undefined }, /teaches is required/],
    ['an empty teaches', { ...validBody(), teaches: '  ' }, /teaches must not be empty/],
    [
      'a teaches over 1200 characters',
      { ...validBody(), teaches: 'x'.repeat(LANDING_ZONE_MAX_TEACHES_CHARS + 1) },
      /teaches must be at most 1200 characters/,
    ],
  ])('refuses %s', (_name, body, message) => {
    const { error, value } = validateLandingZoneExplainRequest(body);
    expect(value).toBeUndefined();
    expect(error).toMatch(message);
  });

  it('accepts a teaches of exactly 1200 characters', () => {
    const { error } = validateLandingZoneExplainRequest({
      ...validBody(),
      teaches: 'x'.repeat(LANDING_ZONE_MAX_TEACHES_CHARS),
    });
    expect(error).toBeUndefined();
  });
});

describe('canonicalLandingZoneExplainRequest', () => {
  it('carries the kind first and sorts selected, so the same build hashes the same', () => {
    const a = validateLandingZoneExplainRequest(validBody()).value;
    const swapped = validBody();
    swapped.selected.reverse();
    const b = validateLandingZoneExplainRequest(swapped).value;
    const canonical = canonicalLandingZoneExplainRequest(a);
    expect(canonical.startsWith('{"kind":"landing-zone","componentId":"firewall"')).toBe(true);
    expect(canonical).toBe(canonicalLandingZoneExplainRequest(b));
    expect(JSON.parse(canonical).selected).toEqual([
      'connectivity-hub',
      'corp',
      'firewall',
      'management-groups',
    ]);
  });

  it('differs when an option differs', () => {
    const a = validateLandingZoneExplainRequest(validBody()).value;
    const b = validateLandingZoneExplainRequest(withOption('firewallSku', 'Basic')).value;
    expect(canonicalLandingZoneExplainRequest(a)).not.toBe(canonicalLandingZoneExplainRequest(b));
  });
});

describe('landingZoneExplainPrompt', () => {
  it('names the component, every selected id, the options, its modules and the reference text', () => {
    const value = validateLandingZoneExplainRequest(validBody()).value;
    const prompt = landingZoneExplainPrompt(value);
    const parsed = JSON.parse(prompt);
    expect(parsed.component).toMatchObject({
      id: 'firewall',
      label: 'Azure Firewall',
      selected: true,
      deployedBy: ['Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm'],
      dependsOn: ['connectivity-hub'],
    });
    for (const id of value.selected) expect(prompt).toContain(id);
    expect(parsed.selected).toEqual(['connectivity-hub', 'corp', 'firewall', 'management-groups']);
    expect(parsed.options).toEqual(value.options);
    expect(parsed.reference).toBe(value.teaches);
    expect(Object.keys(parsed.modules)).toEqual([
      'Azure/avm-ptn-alz-connectivity-hub-and-spoke-vnet/azurerm',
    ]);
    // Nothing that is not in the validated value or this file reaches the model.
    expect(prompt).not.toMatch(/tenant|subscriptionId|\$|price/i);
  });

  it('lists the selected components that depend on the one asked about, and says when it is not selected', () => {
    const value = validateLandingZoneExplainRequest({
      ...validBody(),
      componentId: 'connectivity-hub',
      selected: ['management-groups', 'firewall', 'corp', 'online', 'policy'],
    }).value;
    const parsed = JSON.parse(landingZoneExplainPrompt(value));
    expect(parsed.component.selected).toBe(false);
    expect(parsed.selectedDependents).toEqual(['corp', 'firewall', 'online']);
  });

  it('describes every component through one of the four modules', () => {
    for (const componentId of LANDING_ZONE_COMPONENT_IDS) {
      const value = validateLandingZoneExplainRequest({ ...validBody(), componentId }).value;
      const parsed = JSON.parse(landingZoneExplainPrompt(value));
      expect(parsed.component.deployedBy.length, componentId).toBeGreaterThan(0);
      for (const source of parsed.component.deployedBy) {
        expect(Object.values(LANDING_ZONE_MODULES), componentId).toContain(source);
        expect(typeof parsed.modules[source]).toBe('string');
      }
      expect(parsed.component.deploys, componentId).toMatch(/\S/);
    }
  });

  it('names the system prompt’s rules', () => {
    for (const rule of [
      'two short paragraphs',
      'reference text',
      'not as instructions',
      'exactly this selection',
      'deselected',
      'no tenant',
      'no prices',
      '180 words',
      '"Generated" label',
    ]) {
      expect(LANDING_ZONE_SYSTEM_PROMPT).toContain(rule);
    }
  });
});
