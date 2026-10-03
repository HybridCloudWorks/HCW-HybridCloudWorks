/**
 * Routing by task (ADR 0033 §4): the tab renders what the API holds, saves a
 * change the moment it is made, and puts it back when the save fails.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getAiRouting = vi.fn();
const setAiRoute = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    getAiRouting: (...a) => getAiRouting(...a),
    setAiRoute: (...a) => setAiRoute(...a),
  },
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const {
  default: RoutingTab,
  updateRoute,
  describeRoute,
  DEFAULT_ORDER_VALUE,
  AUTO_MODEL_VALUE,
} = await import('./RoutingTab.jsx');

const PROVIDERS = [
  { id: 'gemini', name: 'Gemini', enabled: true, order: 1, models: ['gemini-3.6-flash'] },
  { id: 'openai', name: 'OpenAI', enabled: true, order: 2, models: ['gpt-5-mini', 'gpt-5-nano'] },
  { id: 'anthropic', name: 'Claude', enabled: false, order: 3, models: ['claude-opus-4-6'] },
];

const answer = (routes = {}) => ({
  routes,
  catalogue: {
    forgeDrafting: {
      label: 'Forge drafting',
      description: 'Writes the draft.',
      route: 'Forge jobs.',
    },
    telegram: { label: 'Telegram assistant', description: 'Replies.', route: 'The bot.' },
  },
  providers: ['gemini', 'openai', 'anthropic', 'nvidia'],
  maxFallbacks: 3,
});

beforeEach(() => {
  getAiRouting.mockReset();
  setAiRoute.mockReset();
  toast.mockReset();
});

describe('updateRoute', () => {
  it('clears the route when the primary goes back to the default order', () => {
    expect(
      updateRoute(
        { provider: 'openai', model: 'x', fallbacks: [] },
        { type: 'primary', provider: DEFAULT_ORDER_VALUE }
      )
    ).toBeNull();
  });

  it('switching the primary drops its model and removes it from the fallbacks', () => {
    const next = updateRoute(
      { provider: 'openai', model: 'gpt-5-mini', fallbacks: [{ provider: 'gemini', model: null }] },
      { type: 'primary', provider: 'gemini' }
    );
    expect(next).toEqual({ provider: 'gemini', model: null, fallbacks: [] });
  });

  it('Auto clears a model; fallbacks add, change and remove by index', () => {
    let route = updateRoute(null, { type: 'primary', provider: 'openai' });
    route = updateRoute(route, { type: 'model', model: 'gpt-5-mini' });
    route = updateRoute(route, { type: 'addFallback', provider: 'gemini' });
    route = updateRoute(route, { type: 'fallbackModel', index: 0, model: 'gemini-3.6-flash' });
    expect(route).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
      fallbacks: [{ provider: 'gemini', model: 'gemini-3.6-flash' }],
    });
    route = updateRoute(route, { type: 'model', model: AUTO_MODEL_VALUE });
    expect(route.model).toBeNull();
    route = updateRoute(route, { type: 'fallbackProvider', index: 0, provider: 'anthropic' });
    expect(route.fallbacks).toEqual([{ provider: 'anthropic', model: null }]);
    route = updateRoute(route, { type: 'removeFallback', index: 0 });
    expect(route.fallbacks).toEqual([]);
  });
});

describe('describeRoute', () => {
  it('says the default order for a routeless task and the chain for a routed one', () => {
    expect(describeRoute(null, { providers: PROVIDERS, order: ['gemini', 'openai'] })).toBe(
      'Default order: Gemini first, then the rest in order.'
    );
    expect(
      describeRoute(
        { provider: 'openai', model: 'gpt-5-mini', fallbacks: [{ provider: 'gemini' }] },
        { providers: PROVIDERS }
      )
    ).toBe('OpenAI → Gemini (gpt-5-mini), then the rest of the default order.');
  });
});

describe('RoutingTab', () => {
  it('shows every task read-only in Simple mode, with its route or the default order', async () => {
    getAiRouting.mockResolvedValue(
      answer({ telegram: { provider: 'openai', model: 'gpt-5-nano', fallbacks: [] } })
    );
    render(<RoutingTab providers={PROVIDERS} />);
    expect(await screen.findByText('Forge drafting')).toBeTruthy();
    expect(screen.getByTestId('route-summary-forgeDrafting').textContent).toMatch(
      /Default order: Gemini first/
    );
    expect(screen.getByTestId('route-summary-telegram').textContent).toMatch(
      /OpenAI \(gpt-5-nano\)/
    );
    expect(
      screen.getByText(
        '1 of 2 tasks have their own route; the rest follow the order of preference.'
      )
    ).toBeTruthy();
    expect(document.querySelector('#route-telegram-primary')).toBeNull();
  });

  it('in Advanced mode, choosing a primary saves the route and reconciles with the API', async () => {
    getAiRouting.mockResolvedValue(answer());
    setAiRoute.mockResolvedValue({
      forgeDrafting: { provider: 'openai', model: null, fallbacks: [] },
    });
    render(<RoutingTab providers={PROVIDERS} />);
    await screen.findByText('Forge drafting');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const primary = screen.getByLabelText('Primary', { selector: '#route-forgeDrafting-primary' });
    expect(primary.value).toBe(DEFAULT_ORDER_VALUE);
    fireEvent.change(primary, { target: { value: 'openai' } });
    expect(setAiRoute).toHaveBeenCalledWith('forgeDrafting', {
      provider: 'openai',
      model: null,
      fallbacks: [],
    });
    await waitFor(() => expect(primary.value).toBe('openai'));
    // The model select appears for a routed task, offering Auto and the card's models.
    const model = screen.getByLabelText('Model', { selector: '#route-forgeDrafting-model' });
    expect([...model.options].map((o) => o.value)).toEqual([
      AUTO_MODEL_VALUE,
      'gpt-5-mini',
      'gpt-5-nano',
    ]);
  });

  it('Use default order clears the route with null', async () => {
    getAiRouting.mockResolvedValue(
      answer({ telegram: { provider: 'openai', model: null, fallbacks: [] } })
    );
    setAiRoute.mockResolvedValue({});
    render(<RoutingTab providers={PROVIDERS} />);
    await screen.findByText('Telegram assistant');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const primary = screen.getByLabelText('Primary', { selector: '#route-telegram-primary' });
    fireEvent.change(primary, { target: { value: DEFAULT_ORDER_VALUE } });
    expect(setAiRoute).toHaveBeenCalledWith('telegram', null);
    await waitFor(() =>
      expect(screen.getByTestId('route-summary-telegram').textContent).toMatch(/Default order/)
    );
  });

  it('puts the previous route back and says so when the save fails', async () => {
    getAiRouting.mockResolvedValue(answer());
    setAiRoute.mockRejectedValue(new Error('nope'));
    render(<RoutingTab providers={PROVIDERS} />);
    await screen.findByText('Forge drafting');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const primary = screen.getByLabelText('Primary', { selector: '#route-forgeDrafting-primary' });
    fireEvent.change(primary, { target: { value: 'anthropic' } });
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(primary.value).toBe(DEFAULT_ORDER_VALUE);
  });

  it('shows an error state with a retry when the table cannot be read', async () => {
    getAiRouting.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(answer());
    render(<RoutingTab providers={PROVIDERS} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('Forge drafting')).toBeTruthy();
  });
});
