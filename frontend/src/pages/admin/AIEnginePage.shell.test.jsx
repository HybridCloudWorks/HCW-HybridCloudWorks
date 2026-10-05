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
const fetchModelCatalog = vi.fn();
const setModelHidden = vi.fn();
const refreshModelCatalog = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    getAiRouting: (...a) => getAiRouting(...a),
    getAiFeatures: (...a) => getAiFeatures(...a),
    setProviderModel: (...a) => setProviderModel(...a),
    setEnabled: (...a) => setEnabled(...a),
    fetchModelCatalog: (...a) => fetchModelCatalog(...a),
    setModelHidden: (...a) => setModelHidden(...a),
    refreshModelCatalog: (...a) => refreshModelCatalog(...a),
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

// Stored documents from before #857 still carry a `models` array; the page
// ignores it once the catalogue has answered.
const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Gemini',
    enabled: true,
    order: 1,
    models: ['typed-into-the-seed'],
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

const model = (id, over = {}) => ({
  id,
  status: 'live',
  hidden: false,
  unpriced: false,
  capabilities: ['text'],
  ...over,
});

/** The catalogue as the API answers it (ADR 0034 slice 2, #857). */
const CATALOG = {
  id: 'ai-model-catalog',
  providers: {
    gemini: {
      refresh: { lastOk: null, lastAttempt: null, lastError: null },
      stale: true,
      seeded: true,
      models: { 'gemini-3.6-flash': model('gemini-3.6-flash', { status: 'unknown' }) },
    },
    openai: {
      refresh: {
        lastOk: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        lastAttempt: null,
        lastError: null,
      },
      stale: false,
      models: {
        'gpt-5-mini': model('gpt-5-mini'),
        'gpt-5-nano': model('gpt-5-nano', { hidden: true }),
        'gpt-4o': model('gpt-4o', { status: 'retired' }),
        'o3-mini': model('o3-mini', { unpriced: true }),
        'gpt-4o-mini-tts': model('gpt-4o-mini-tts', { capabilities: [] }),
      },
    },
  },
};

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
  fetchModelCatalog.mockReset().mockResolvedValue(CATALOG);
  setModelHidden.mockReset().mockResolvedValue({ id: 'gpt-5-mini', hidden: true });
  refreshModelCatalog.mockReset().mockResolvedValue({
    updatedAt: new Date().toISOString(),
    providers: {
      gemini: { listed: 4, added: 1, retired: 0, error: null },
      openai: { listed: 0, added: 0, retired: 0, error: 'HTTP 401: Incorrect API key' },
    },
  });
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

  it('the cards list the catalogue’s models, not the stored array', async () => {
    // Radix Select cannot open under jsdom (scrollIntoView), so the list is
    // read through the Models disclosure, which renders the same catalogue.
    renderPage();
    const disclosure = await screen.findByRole('button', { name: 'Models for Gemini' });
    await waitFor(() => expect(fetchModelCatalog).toHaveBeenCalled());
    fireEvent.click(disclosure);
    expect(screen.getByText('gemini-3.6-flash')).toBeInTheDocument();
    expect(screen.queryByText('typed-into-the-seed')).toBeNull();
    // A pin the catalogue still lists reads as itself on the select.
    expect(screen.getByRole('combobox', { name: 'Model for OpenAI' })).toHaveTextContent(
      'gpt-5-mini'
    );
  });

  it('the Models disclosure shows every model with its badges, says when the list was refreshed, and hides on click', async () => {
    renderPage();
    const disclosure = await screen.findByRole('button', { name: 'Models for OpenAI' });
    expect(disclosure).toHaveTextContent('Models (5)');
    expect(disclosure).toHaveTextContent('List refreshed 2d ago');
    expect(screen.getByRole('button', { name: 'Models for Gemini' })).toHaveTextContent(
      'List not refreshed yet'
    );
    fireEvent.click(disclosure);
    expect(screen.getByText('retired')).toBeInTheDocument();
    expect(screen.getByText('unpriced')).toBeInTheDocument();
    expect(screen.getByText('hidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide gpt-5-mini for OpenAI' }));
    await waitFor(() => expect(setModelHidden).toHaveBeenCalledWith('openai', 'gpt-5-mini', true));
    // Re-read after the write, so the cards show what the API holds.
    await waitFor(() => expect(fetchModelCatalog).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Show gpt-5-nano for OpenAI' })).toBeInTheDocument();
  });

  it('Refresh model lists runs the refresh, says what happened, and re-reads the catalogue', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: /Refresh model lists/ });
    await waitFor(() => expect(fetchModelCatalog).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await waitFor(() => expect(refreshModelCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Model lists refreshed, with errors',
          description:
            '1 provider listed · 1 new · 0 retired · failed: openai (HTTP 401: Incorrect API key)',
          variant: 'destructive',
        })
      )
    );
    await waitFor(() => expect(fetchModelCatalog).toHaveBeenCalledTimes(2));
  });

  it('a catalogue that cannot be read leaves the cards on their stored lists, with no model list to show', async () => {
    fetchModelCatalog.mockRejectedValueOnce(new Error('503'));
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage();
    // Gemini has no pin, so its select renders only because the stored
    // array still fills `models`: the page did not empty it.
    expect(await screen.findByRole('combobox', { name: 'Model for Gemini' })).toBeInTheDocument();
    await waitFor(() => expect(fetchModelCatalog).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Models for Gemini' })).toBeNull();
    silenced.mockRestore();
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
