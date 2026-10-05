/**
 * "Where AI is used" — the feature switches, and the provider card.
 *
 * The switches render from the API's catalogue, never from a list of their
 * own. The per-feature placement selects that sat under each switch (#701)
 * left with ADR 0034 slice 4 (#859): which provider serves a task is the
 * Tasks tab's question, and this card offers nothing but the switch.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getAiFeatures = vi.fn();
const setAiFeature = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    getAiFeatures: (...a) => getAiFeatures(...a),
    setAiFeature: (...a) => setAiFeature(...a),
  },
  seedAiEngineIfEmpty: vi.fn(),
  subscribeProviders: vi.fn(() => () => {}),
  subscribeMcpServers: vi.fn(() => () => {}),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const { FeatureSwitches, ProviderCard, describeLastTest, orderByPriority } =
  await import('./AIEnginePage.jsx');

const catalogue = {
  forgeDrafting: { label: 'Forge drafting', description: 'd', route: 'r' },
  telegram: { label: 'Telegram assistant', description: 'd', route: 'r' },
  pricingExplain: { label: 'Pricing explanations', description: 'd', route: 'r' },
};

beforeEach(() => {
  getAiFeatures.mockReset();
  setAiFeature.mockReset();
  toast.mockReset();
});

describe('FeatureSwitches', () => {
  it('renders one switch per catalogue entry and nothing that places a provider', async () => {
    getAiFeatures.mockResolvedValue({
      features: { forgeDrafting: true, telegram: false, pricingExplain: true },
      catalogue,
    });
    render(<FeatureSwitches />);
    expect(await screen.findByText('Forge drafting')).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(
      screen.getByRole('switch', { name: 'Telegram assistant' }).getAttribute('aria-checked')
    ).toBe('false');
    expect(screen.getByText('1 of 3 switched off.')).toBeTruthy();
    expect(document.querySelector('select')).toBeNull();
    expect(screen.queryByText(/not used here/)).toBeNull();
  });

  it('saves a switch and reconciles with what the API stored', async () => {
    getAiFeatures.mockResolvedValue({
      features: { forgeDrafting: true, telegram: true, pricingExplain: true },
      catalogue,
    });
    setAiFeature.mockResolvedValue({ forgeDrafting: false, telegram: true, pricingExplain: true });
    render(<FeatureSwitches />);
    const drafting = await screen.findByRole('switch', { name: 'Forge drafting' });
    fireEvent.click(drafting);
    expect(setAiFeature).toHaveBeenCalledWith('forgeDrafting', false);
    await waitFor(() => expect(drafting.getAttribute('aria-checked')).toBe('false'));
  });

  it('puts the switch back and says so when the save fails', async () => {
    getAiFeatures.mockResolvedValue({
      features: { forgeDrafting: true, telegram: true, pricingExplain: true },
      catalogue,
    });
    setAiFeature.mockRejectedValue(new Error('nope'));
    render(<FeatureSwitches />);
    const drafting = await screen.findByRole('switch', { name: 'Forge drafting' });
    fireEvent.click(drafting);
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(drafting.getAttribute('aria-checked')).toBe('true');
  });
});

describe('orderByPriority — the cards follow the Priority list', () => {
  it('lists the named providers in list order, then the rest in their own order', () => {
    const cards = [
      { id: 'gemini', order: 1 },
      { id: 'openai', order: 2 },
      { id: 'foundry', order: 5 },
      { id: 'nvidia', order: 4 },
    ];
    const selection = { global: { priority: [{ provider: 'foundry' }, { provider: 'gemini' }] } };
    expect(orderByPriority(cards, selection).map((c) => c.id)).toEqual([
      'foundry',
      'gemini',
      'openai',
      'nvidia',
    ]);
    expect(orderByPriority(cards, null).map((c) => c.id)).toEqual([
      'gemini',
      'openai',
      'nvidia',
      'foundry',
    ]);
  });
});

describe('ProviderCard — a Test result, from the button or the weekly probe (#701)', () => {
  const NOW = Date.parse('2026-10-08T12:00:00.000Z');
  const probed = {
    id: 'nvidia',
    name: 'NVIDIA API',
    description: 'd',
    enabled: true,
    status: 'error',
    latencyMs: 45_012,
    lastTested: '2026-10-05T06:15:47.000Z',
    lastTestError: 'timeout after 45000 ms',
    lastTestedBy: 'probe',
  };

  it('says when it was tested and that the weekly check did it', () => {
    expect(describeLastTest(probed, NOW)).toBe('Tested 3d ago by the weekly check');
    expect(describeLastTest({ ...probed, lastTestedBy: 'admin' }, NOW)).toBe('Tested 3d ago');
    // A document written before the field existed is a click.
    expect(describeLastTest({ lastTested: '2026-10-08T11:55:00.000Z' }, NOW)).toBe('Tested 5m ago');
    expect(describeLastTest({ lastTested: '2026-10-08T11:59:30.000Z' }, NOW)).toBe(
      'Tested just now'
    );
    expect(describeLastTest({ lastTested: '2026-10-08T07:00:00.000Z' }, NOW)).toBe('Tested 5h ago');
    // Older than a month is a date, not "45d ago".
    expect(describeLastTest({ lastTested: '2026-08-24T12:00:00.000Z' }, NOW)).toBe(
      `Tested ${new Date('2026-08-24T12:00:00.000Z').toLocaleDateString()}`
    );
    expect(describeLastTest({ status: 'untested' }, NOW)).toBeNull();
  });

  it('shows the timeout the probe recorded, which the Test writes as lastTestError', () => {
    // The card reads the real clock, so the test date is relative to it.
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
    render(
      <ProviderCard
        provider={{ ...probed, lastTested: threeDaysAgo }}
        onToggle={vi.fn()}
        onTest={vi.fn()}
      />
    );
    expect(screen.getByText('timeout after 45000 ms')).toBeTruthy();
    expect(screen.getByText('Tested 3d ago by the weekly check')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('shows the latency beside the badge when the probe connected, and no model pin', () => {
    render(
      <ProviderCard
        provider={{
          ...probed,
          status: 'connected',
          latencyMs: 2_140,
          lastTestError: null,
          models: ['z-ai/glm-5.3'],
          defaultModel: 'z-ai/glm-5.3',
        }}
        onToggle={vi.fn()}
        onTest={vi.fn()}
      />
    );
    expect(screen.getByText('2140ms')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('timeout after 45000 ms')).toBeNull();
    // The pin left with ADR 0034 slice 4: the Priority list names the model.
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
