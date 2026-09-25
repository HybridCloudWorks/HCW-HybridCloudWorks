/**
 * "Explain this component" (#670, Phase 4 of #657). What must hold: the body
 * is exactly what the server's validator allows — checked for every
 * component against a copy of that validator's allowlist, so the client can
 * never send a value the server refuses; nothing is requested until the
 * click; a success shows the paragraphs under the generated-by label with
 * the model and time; a cached answer says so; 429 and both 503 sentences
 * read differently and none offers a retry; any other failure does; the
 * button is disabled while a request is in flight; and an answer goes away
 * when the focus or the build it explained changes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LANDING_ZONE_EXPLAIN_KIND, LzExplainButton, explanationRequest } from './LzExplainButton';
import {
  COMPONENTS,
  COMPONENT_IDS,
  DEFAULT_STATE,
  componentById,
  decodeLz,
} from '@/lib/landingZone';

vi.mock('@/lib/functionsBase', () => ({
  requireFunctionsBase: () => 'https://api.test/api',
}));

/**
 * The server's rules, copied from
 * functions/src/lib/cloud-tools/explain/kinds/landingZone.js. A copy on
 * purpose: the frontend cannot import from functions/, and this test is the
 * place the two are held together. If the server changes a rule, this block
 * changes with it.
 */
const SERVER = Object.freeze({
  kind: 'landing-zone',
  bodyKeys: ['kind', 'componentId', 'selected', 'options', 'teaches'],
  componentIds: [
    'management-groups',
    'policy',
    'management',
    'connectivity-hub',
    'firewall',
    'identity',
    'corp',
    'online',
  ],
  maxSelected: 12,
  maxTeachesChars: 1200,
  optionKeys: [
    'hubCidr',
    'spokeCidr',
    'firewallSku',
    'privateDnsZones',
    'location',
    'corpCount',
    'onlineCount',
    'rootParentId',
  ],
  firewallSkus: ['Basic', 'Standard', 'Premium'],
  maxCount: 20,
  maxCidrChars: 18,
  cidr: /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}\/[0-9]{1,2}$/,
  location: /^[a-z][a-z0-9]{2,31}$/,
  managementGroupId: /^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/,
  maxBodyBytes: 8 * 1024,
});

/** Every check the server's `body()` makes, as assertions. */
function expectServerAccepts(body) {
  expect(Object.keys(body).sort()).toEqual([...SERVER.bodyKeys].sort());
  expect(body.kind).toBe(SERVER.kind);
  expect(SERVER.componentIds).toContain(body.componentId);

  expect(Array.isArray(body.selected)).toBe(true);
  expect(body.selected.length).toBeLessThanOrEqual(SERVER.maxSelected);
  expect(new Set(body.selected).size).toBe(body.selected.length);
  for (const id of body.selected) expect(SERVER.componentIds).toContain(id);

  const o = body.options;
  expect(o && typeof o === 'object' && !Array.isArray(o)).toBe(true);
  for (const key of Object.keys(o)) expect(SERVER.optionKeys).toContain(key);
  for (const key of ['hubCidr', 'spokeCidr']) {
    expect(typeof o[key]).toBe('string');
    expect(o[key].length).toBeLessThanOrEqual(SERVER.maxCidrChars);
    expect(o[key]).toMatch(SERVER.cidr);
  }
  expect(SERVER.firewallSkus).toContain(o.firewallSku);
  expect(typeof o.privateDnsZones).toBe('boolean');
  expect(o.location).toMatch(SERVER.location);
  for (const key of ['corpCount', 'onlineCount']) {
    expect(Number.isInteger(o[key])).toBe(true);
    expect(o[key]).toBeGreaterThanOrEqual(0);
    expect(o[key]).toBeLessThanOrEqual(SERVER.maxCount);
  }
  expect(typeof o.rootParentId).toBe('string');
  if (o.rootParentId !== '') expect(o.rootParentId).toMatch(SERVER.managementGroupId);

  expect(typeof body.teaches).toBe('string');
  expect(body.teaches.trim().length).toBeGreaterThan(0);
  expect(body.teaches.length).toBeLessThanOrEqual(SERVER.maxTeachesChars);

  expect(JSON.stringify(body).length).toBeLessThan(SERVER.maxBodyBytes);
}

const fetchMock = vi.fn();
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const EXPLANATION = {
  success: true,
  explanation: {
    text: 'The firewall is where every corp spoke sends its traffic.\n\nWithout it, corp spokes would route straight out.',
    model: 'claude-sonnet-4-5',
    generatedAt: '2026-09-25T10:30:00.000Z',
    cached: false,
  },
};

const button = () => screen.getByTestId('lz-explain-button');
const BUILD = decodeLz({ lz: 'mg,hub,fw', corp: '2', online: '0', 'fw.sku': 'Premium' });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(EXPLANATION));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('explanationRequest', () => {
  it('pins the catalogue to the server’s copy of it', () => {
    expect([...COMPONENT_IDS]).toEqual(SERVER.componentIds);
    expect(LANDING_ZONE_EXPLAIN_KIND).toBe(SERVER.kind);
    expect(COMPONENTS.length).toBeLessThanOrEqual(SERVER.maxSelected);
    for (const c of COMPONENTS) {
      expect(c.teaches.length, c.id).toBeLessThanOrEqual(SERVER.maxTeachesChars);
    }
  });

  it('builds a body the server accepts for every component of the default build', () => {
    for (const componentId of COMPONENT_IDS) {
      const body = explanationRequest({ state: DEFAULT_STATE, componentId });
      expectServerAccepts(body);
      expect(body.componentId).toBe(componentId);
      expect(body.teaches).toBe(componentById(componentId).teaches);
      expect(body.selected).toEqual([...DEFAULT_STATE.selected]);
      expect(Object.keys(body.options).sort()).toEqual([...SERVER.optionKeys].sort());
    }
  });

  it('carries a non-default build’s selection and knobs, and a component outside the build', () => {
    const state = decodeLz({
      lz: 'mg,hub,fw',
      corp: '3',
      online: '0',
      'fw.sku': 'Premium',
      'hub.cidr': '10.5.0.0/16',
      root: 'contoso',
      loc: 'westeurope',
      dns: '0',
    });
    const body = explanationRequest({ state, componentId: 'policy' });
    expectServerAccepts(body);
    expect(body).toEqual({
      kind: 'landing-zone',
      componentId: 'policy',
      selected: ['management-groups', 'connectivity-hub', 'firewall', 'corp'],
      options: {
        location: 'westeurope',
        rootParentId: 'contoso',
        hubCidr: '10.5.0.0/16',
        spokeCidr: '10.1.0.0/16',
        privateDnsZones: false,
        firewallSku: 'Premium',
        corpCount: 3,
        onlineCount: 0,
      },
      teaches: componentById('policy').teaches,
    });
  });

  it('sends an empty selection for an empty build, and normalises a raw state first', () => {
    const empty = explanationRequest({
      state: decodeLz({ lz: '', corp: '0', online: '0' }),
      componentId: 'firewall',
    });
    expectServerAccepts(empty);
    expect(empty.selected).toEqual([]);

    // A firewall with no hub cannot be sent: the dependency rule runs here too.
    const raw = explanationRequest({
      state: { selected: ['firewall'], options: { corpCount: 0, onlineCount: 0 } },
      componentId: 'firewall',
    });
    expectServerAccepts(raw);
    expect(raw.selected).toEqual(['management-groups', 'connectivity-hub', 'firewall']);
  });

  it('falls back to the management groups for an id it does not know, as the panel does', () => {
    const body = explanationRequest({ state: DEFAULT_STATE, componentId: 'nope' });
    expectServerAccepts(body);
    expect(body.componentId).toBe('management-groups');
  });
});

describe('LzExplainButton', () => {
  it('requests nothing until clicked, then posts the body and shows the labelled answer', async () => {
    render(<LzExplainButton state={BUILD} componentId="firewall" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain('Explain this component');

    fireEvent.click(button());
    expect(button().textContent).toContain('Explaining…');
    expect(button().disabled).toBe(true);

    const panel = await screen.findByTestId('lz-explanation');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe('https://api.test/api/public/cloud-tools/explain');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(init.body);
    expect(sent).toEqual(explanationRequest({ state: BUILD, componentId: 'firewall' }));
    expectServerAccepts(sent);
    expect(sent.selected).toEqual(['management-groups', 'connectivity-hub', 'firewall', 'corp']);
    expect(sent.options.firewallSku).toBe('Premium');

    expect(panel.textContent).toContain('Generated by AI about this build');
    const paragraphs = Array.from(panel.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs[1]).toBe('The firewall is where every corp spoke sends its traffic.');
    expect(paragraphs[2]).toBe('Without it, corp spokes would route straight out.');
    expect(paragraphs[3]).toMatch(/^claude-sonnet-4-5 · .*2026/);
    expect(paragraphs[3]).not.toContain('cached');
    expect(panel.dataset.cached).toBeUndefined();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain('Explain this component');
  });

  it('notes a cached answer in words', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...EXPLANATION,
        explanation: { ...EXPLANATION.explanation, cached: true },
      })
    );
    render(<LzExplainButton state={BUILD} componentId="firewall" />);
    fireEvent.click(button());
    const panel = await screen.findByTestId('lz-explanation');
    expect(panel.dataset.cached).toBe('true');
    expect(panel.textContent).toContain(
      'cached: the same component in the same build was explained recently'
    );
  });

  it('says to try again in a while on 429, with no retry button', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Too many requests' }, 429));
    render(<LzExplainButton state={BUILD} componentId="firewall" />);
    fireEvent.click(button());
    const alert = await screen.findByRole('alert');
    expect(alert.dataset.status).toBe('429');
    expect(alert.textContent).toContain('Try again in a while');
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it.each(['Explanations are not available', 'Explanations are paused for today'])(
    'shows the server’s own sentence on 503: %s',
    async (sentence) => {
      fetchMock.mockResolvedValue(jsonResponse({ error: sentence }, 503));
      render(<LzExplainButton state={BUILD} componentId="firewall" />);
      fireEvent.click(button());
      const alert = await screen.findByRole('alert');
      expect(alert.dataset.status).toBe('503');
      expect(alert.textContent).toBe(sentence);
      expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    }
  );

  it('names the field on 400, and offers Retry on any other failure', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: 'options.location must be an Azure region id' }, 400)
      )
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(EXPLANATION));
    render(<LzExplainButton state={BUILD} componentId="firewall" />);
    fireEvent.click(button());
    let alert = await screen.findByRole('alert');
    expect(alert.dataset.status).toBe('400');
    expect(alert.textContent).toContain(
      'The explanation could not be generated: options.location must be an Azure region id'
    );

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The explanation could not be generated: network down');

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByTestId('lz-explanation');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('drops an answer when the focus or the build changes, and never re-asks on its own', async () => {
    const { rerender } = render(<LzExplainButton state={BUILD} componentId="firewall" />);
    fireEvent.click(button());
    await screen.findByTestId('lz-explanation');

    rerender(<LzExplainButton state={BUILD} componentId="connectivity-hub" />);
    await waitFor(() => expect(screen.queryByTestId('lz-explanation')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Back to the same component in the same build: the answer for it is still held.
    rerender(<LzExplainButton state={BUILD} componentId="firewall" />);
    expect(screen.getByTestId('lz-explanation')).toBeTruthy();

    rerender(<LzExplainButton state={DEFAULT_STATE} componentId="firewall" />);
    await waitFor(() => expect(screen.queryByTestId('lz-explanation')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
