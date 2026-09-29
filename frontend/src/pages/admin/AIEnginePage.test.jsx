/**
 * "Where AI is used" — the per-feature NVIDIA placement (#701).
 *
 * The page renders placement from the API's resolved answer and its code-level
 * defaults, never from a list of its own. Two things matter on screen: a
 * content feature offers the choice, and a locked feature (the anonymous
 * public explain buttons) says it is not used there instead of offering a
 * control the API would refuse.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getAiFeatures = vi.fn();
const setAiPlacement = vi.fn();
const setAiFeature = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/aiEngine', () => ({
  aiEngine: {
    getAiFeatures: (...a) => getAiFeatures(...a),
    setAiPlacement: (...a) => setAiPlacement(...a),
    setAiFeature: (...a) => setAiFeature(...a),
  },
  seedAiEngineIfEmpty: vi.fn(),
  subscribeProviders: vi.fn(() => () => {}),
  subscribeMcpServers: vi.fn(() => () => {}),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));

const { FeatureSwitches, ProviderCard, describeLastTest } = await import('./AIEnginePage.jsx');

const catalogue = {
  forgeDrafting: { label: 'Forge drafting', description: 'd', route: 'r' },
  telegram: { label: 'Telegram assistant', description: 'd', route: 'r' },
  pricingExplain: { label: 'Pricing explanations', description: 'd', route: 'r' },
};

/**
 * The API's answer, shaped as it arrives. The defaults are the API's own
 * since 2026-09-29: 'order' (the backup) for content features, 'off' locked
 * for the public ones. The stored placement puts Forge drafting first, the
 * choice an administrator made while 'first' was the default, which is what
 * the owner will find on the page after the change.
 */
function answer(overrides = {}) {
  return {
    features: { forgeDrafting: true, telegram: true, pricingExplain: true },
    catalogue,
    placement: { nvidia: { forgeDrafting: 'first', telegram: 'order', pricingExplain: 'off' } },
    placementDefaults: {
      nvidia: { forgeDrafting: 'order', telegram: 'order', pricingExplain: 'off' },
    },
    ...overrides,
  };
}

beforeEach(() => {
  getAiFeatures.mockReset();
  setAiPlacement.mockReset();
  toast.mockReset();
});

describe('FeatureSwitches — NVIDIA placement', () => {
  it('offers a placement for content features and shows the resolved value', async () => {
    getAiFeatures.mockResolvedValue(answer());
    render(<FeatureSwitches />);
    const drafting = await screen.findByLabelText('NVIDIA', {
      selector: '#placement-nvidia-forgeDrafting',
    });
    expect(drafting.value).toBe('first');
    expect(screen.getByLabelText('NVIDIA', { selector: '#placement-nvidia-telegram' }).value).toBe(
      'order'
    );
  });

  it('shows a locked feature as not used, with no control', async () => {
    getAiFeatures.mockResolvedValue(answer());
    render(<FeatureSwitches />);
    await screen.findByText('Pricing explanations');
    expect(screen.getByText('NVIDIA: not used here')).toBeTruthy();
    expect(document.querySelector('#placement-nvidia-pricingExplain')).toBeNull();
  });

  it('saves a change and reconciles with what the API stored', async () => {
    getAiFeatures.mockResolvedValue(answer());
    setAiPlacement.mockResolvedValue({
      nvidia: { forgeDrafting: 'order', telegram: 'order', pricingExplain: 'off' },
    });
    render(<FeatureSwitches />);
    const drafting = await screen.findByLabelText('NVIDIA', {
      selector: '#placement-nvidia-forgeDrafting',
    });
    fireEvent.change(drafting, { target: { value: 'order' } });
    expect(setAiPlacement).toHaveBeenCalledWith('nvidia', 'forgeDrafting', 'order');
    await waitFor(() => expect(drafting.value).toBe('order'));
  });

  it('puts the value back and says so when the save fails', async () => {
    getAiFeatures.mockResolvedValue(answer());
    setAiPlacement.mockRejectedValue(new Error('nope'));
    render(<FeatureSwitches />);
    const drafting = await screen.findByLabelText('NVIDIA', {
      selector: '#placement-nvidia-forgeDrafting',
    });
    fireEvent.change(drafting, { target: { value: 'off' } });
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(drafting.value).toBe('first');
  });

  it('renders no placement at all against an API that does not send one', async () => {
    getAiFeatures.mockResolvedValue(answer({ placement: {}, placementDefaults: {} }));
    render(<FeatureSwitches />);
    await screen.findByText('Forge drafting');
    expect(screen.queryByText(/NVIDIA/)).toBeNull();
  });

  it('with nothing stored, shows the default, the backup, in the owner’s words', async () => {
    getAiFeatures.mockResolvedValue(answer({ placement: {} }));
    render(<FeatureSwitches />);
    const drafting = await screen.findByLabelText('NVIDIA', {
      selector: '#placement-nvidia-forgeDrafting',
    });
    expect(drafting.value).toBe('order');
    expect(drafting.selectedOptions[0].textContent).toBe('In order — the backup');
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
    expect(describeLastTest({ status: 'untested' }, NOW)).toBeNull();
  });

  it('shows the timeout the probe recorded, which the Test writes as lastTestError', () => {
    // The card reads the real clock, so the test date is relative to it.
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
    render(
      <ProviderCard
        provider={{ ...probed, lastTested: threeDaysAgo }}
        onToggle={vi.fn()}
        onModelChange={vi.fn()}
        onTest={vi.fn()}
      />
    );
    expect(screen.getByText('timeout after 45000 ms')).toBeTruthy();
    expect(screen.getByText('Tested 3d ago by the weekly check')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('shows the latency beside the badge when the probe connected', () => {
    render(
      <ProviderCard
        provider={{ ...probed, status: 'connected', latencyMs: 2_140, lastTestError: null }}
        onToggle={vi.fn()}
        onModelChange={vi.fn()}
        onTest={vi.fn()}
      />
    );
    expect(screen.getByText('2140ms')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('timeout after 45000 ms')).toBeNull();
  });
});
