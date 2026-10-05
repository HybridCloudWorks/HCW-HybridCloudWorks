/**
 * The Priority list (ADR 0034 §4, #859): the reachable providers in the
 * document's order with P1 badged, keyboard-reachable Up and Down that save
 * the whole document, a model dropdown per row from the catalogue, the
 * "will use" line the API reports, and the providers that cannot be reached
 * listed below with the reason.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PriorityList from './PriorityList.jsx';

const PROVIDERS = [
  { id: 'gemini', name: 'Gemini' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Claude' },
  { id: 'foundry', name: 'Foundry' },
];
const model = (id) => ({ id, status: 'live', hidden: false, capabilities: ['text'] });
const CATALOG = {
  providers: {
    gemini: { models: { 'gemini-3.6-flash': model('gemini-3.6-flash') } },
    foundry: { models: { 'gpt-5-mini': model('gpt-5-mini'), 'gpt-5-nano': model('gpt-5-nano') } },
  },
};
const SELECTION = {
  version: 2,
  global: {
    priority: [
      { provider: 'foundry', model: null },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
      { provider: 'anthropic', model: null },
    ],
  },
  tasks: {},
  updatedAt: 'r1',
};
const EFFECTIVE = {
  tasks: {},
  priority: [
    {
      provider: 'foundry',
      model: null,
      defaults: { draft: 'gpt-5-mini', general: 'gpt-5-nano', multimodal: 'gpt-5-mini' },
      modality: { text: 'gpt-5-nano', vision: 'gpt-5-mini' },
    },
    { provider: 'gemini', model: 'gemini-3.6-flash', defaults: {}, modality: {} },
    { provider: 'anthropic', model: null, defaults: {}, modality: {} },
  ],
  availability: {
    keyed: ['gemini', 'foundry', 'openai'],
    enabled: ['gemini', 'foundry', 'anthropic'],
    disabled: ['openai'],
  },
};

const renderList = (over = {}) => {
  const onSave = vi.fn().mockResolvedValue({});
  render(
    <PriorityList
      providers={PROVIDERS}
      catalog={CATALOG}
      selection={SELECTION}
      effective={EFFECTIVE}
      status="ready"
      saving={false}
      onSave={onSave}
      onRetry={vi.fn()}
      {...over}
    />
  );
  return onSave;
};

describe('PriorityList', () => {
  it('lists the reachable rows in order with P1 badged, and the rest below with why', () => {
    renderList();
    const rows = [...document.querySelectorAll('[data-provider]')].map((r) => r.dataset.provider);
    expect(rows).toEqual(['foundry', 'gemini']);
    expect(screen.getByText('P1 — default')).toBeInTheDocument();
    expect(screen.getByText('P2')).toBeInTheDocument();
    expect(screen.getByTestId('priority-unlisted')).toHaveTextContent('Claude (no key)');
    expect(screen.getByTestId('priority-unlisted')).toHaveTextContent('OpenAI (switched off)');
    expect(screen.getByTestId('priority-will-use-foundry')).toHaveTextContent(
      'Will use gpt-5-mini for drafts, gpt-5-nano for short answers; vision: gpt-5-mini.'
    );
  });

  it('Up and Down save the reordered document; the ends are disabled', () => {
    const onSave = renderList();
    expect(screen.getByRole('button', { name: 'Move Foundry up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Gemini down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Gemini up' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].global.priority.map((s) => s.provider)).toEqual([
      'gemini',
      'foundry',
      'anthropic',
    ]);
  });

  it('the model dropdown offers the provider default and the catalogue’s models, and saves a choice', () => {
    const onSave = renderList();
    const select = screen.getByLabelText('Model for Foundry');
    expect([...select.options].map((o) => o.value)).toEqual([
      '__default__',
      'gpt-5-mini',
      'gpt-5-nano',
    ]);
    fireEvent.change(select, { target: { value: 'gpt-5-nano' } });
    expect(onSave.mock.calls[0][0].global.priority[0]).toEqual({
      provider: 'foundry',
      model: 'gpt-5-nano',
    });
    fireEvent.change(screen.getByLabelText('Model for Gemini'), {
      target: { value: '__default__' },
    });
    expect(onSave.mock.calls[1][0].global.priority[1]).toEqual({ provider: 'gemini', model: null });
  });

  it('offers to add a reachable provider the document does not name', () => {
    const onSave = renderList({
      selection: { ...SELECTION, global: { priority: [{ provider: 'foundry', model: null }] } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Gemini to the Priority list' }));
    expect(onSave.mock.calls[0][0].global.priority).toEqual([
      { provider: 'foundry', model: null },
      { provider: 'gemini', model: null },
    ]);
  });

  it('says so when no provider can be reached, and shows loading and error states', () => {
    renderList({ effective: { ...EFFECTIVE, availability: { keyed: [], enabled: [] } } });
    expect(
      screen.getByText(/No provider is both switched on and holding a key/)
    ).toBeInTheDocument();
    render(
      <PriorityList
        providers={PROVIDERS}
        selection={null}
        effective={null}
        status="error"
        error="offline"
        saving={false}
        onSave={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('offline');
  });
});
