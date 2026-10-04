/**
 * The AI Engine page shell after ADR 0033: tabs from tabs.js under `?tab=`,
 * the Routing tab in place of the Site Services placeholder, a failed seed
 * said with a retry, and a provider card that can go back to Auto.
 *
 * Separate from AIEnginePage.test.jsx because that file replaces
 * react-router wholesale for its component-level tests; this one needs a
 * real router for the tabs.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const seedAiEngineIfEmpty = vi.fn();
const subscribeProviders = vi.fn();
const subscribeMcpServers = vi.fn();
const getAiRouting = vi.fn();
const getAiFeatures = vi.fn();
const setProviderModel = vi.fn();
const setEnabled = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    getAiRouting: (...a) => getAiRouting(...a),
    getAiFeatures: (...a) => getAiFeatures(...a),
    setProviderModel: (...a) => setProviderModel(...a),
    setEnabled: (...a) => setEnabled(...a),
    setAiRoute: vi.fn(),
    setProviderOrder: vi.fn(),
    testProvider: vi.fn(),
  },
  seedAiEngineIfEmpty: (...a) => seedAiEngineIfEmpty(...a),
  subscribeProviders: (...a) => subscribeProviders(...a),
  subscribeMcpServers: (...a) => subscribeMcpServers(...a),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const { default: AIEnginePage } = await import('./AIEnginePage.jsx');

const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Gemini',
    enabled: true,
    order: 1,
    models: ['gemini-3.6-flash'],
    defaultModel: null,
    status: 'connected',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    enabled: true,
    order: 2,
    models: ['gpt-5-mini'],
    defaultModel: 'gpt-5-mini',
    status: 'untested',
  },
];

function renderPage(entry = '/admin/ai-engine') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/ai-engine" element={<AIEnginePage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  seedAiEngineIfEmpty.mockReset().mockResolvedValue(undefined);
  subscribeProviders.mockReset().mockImplementation((cb) => {
    cb(PROVIDERS);
    return () => {};
  });
  subscribeMcpServers.mockReset().mockImplementation((cb) => {
    cb([]);
    return () => {};
  });
  getAiRouting.mockReset().mockResolvedValue({
    routes: {},
    catalogue: { forgeDrafting: { label: 'Forge drafting', description: 'd', route: 'r' } },
    providers: ['gemini', 'openai'],
    maxFallbacks: 3,
  });
  getAiFeatures
    .mockReset()
    .mockResolvedValue({ features: {}, catalogue: {}, placement: {}, placementDefaults: {} });
  setProviderModel.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

describe('AIEnginePage shell', () => {
  it('shows the five tabs with Routing where Site Services was, and no Site Services at all', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Routing' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'AI Services',
      'Routing',
      'MCP Servers',
      'Playground',
      'Usage & Cost',
    ]);
    expect(screen.queryByText(/Site Services/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /AI Engine/ })).toBeInTheDocument();
  });

  it('the old Site Services address lands on Routing, which reads the routing table', async () => {
    renderPage('/admin/ai-engine?tab=siteservices');
    expect(await screen.findByRole('tab', { selected: true })).toHaveTextContent('Routing');
    expect(await screen.findByText('Forge drafting')).toBeInTheDocument();
    expect(getAiRouting).toHaveBeenCalled();
  });

  it('a failed seed is said, with a retry that seeds again', async () => {
    seedAiEngineIfEmpty
      .mockRejectedValueOnce(new Error('403 from the API'))
      .mockResolvedValueOnce(undefined);
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('403 from the API');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(seedAiEngineIfEmpty).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Order of preference')).toBeInTheDocument();
  });

  it('a provider with no pinned model reads Auto, and a pinned one reads its model', async () => {
    renderPage();
    const gemini = await screen.findByRole('combobox', { name: 'Model for Gemini' });
    expect(gemini).toHaveTextContent('Auto (per task)');
    expect(screen.getByRole('combobox', { name: 'Model for OpenAI' })).toHaveTextContent(
      'gpt-5-mini'
    );
  });

  it('a rejected provider toggle is reported instead of left as an unhandled promise', async () => {
    setEnabled.mockRejectedValueOnce(new Error('nope'));
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'Enable Gemini' });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not change the provider' })
      )
    );
  });
});
