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

const { FeatureSwitches } = await import('./AIEnginePage.jsx');

const catalogue = {
  forgeDrafting: { label: 'Forge drafting', description: 'd', route: 'r' },
  telegram: { label: 'Telegram assistant', description: 'd', route: 'r' },
  pricingExplain: { label: 'Pricing explanations', description: 'd', route: 'r' },
};

function answer(overrides = {}) {
  return {
    features: { forgeDrafting: true, telegram: true, pricingExplain: true },
    catalogue,
    placement: { nvidia: { forgeDrafting: 'first', telegram: 'order', pricingExplain: 'off' } },
    placementDefaults: {
      nvidia: { forgeDrafting: 'first', telegram: 'order', pricingExplain: 'off' },
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
});
