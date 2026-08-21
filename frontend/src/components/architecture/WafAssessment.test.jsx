import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WafAssessment from './WafAssessment';

// chart.js needs a real canvas; the radar's own behaviour is not under test.
// The mock records what it was asked to draw, which is the part that matters.
vi.mock('@/components/widgets/FrameworkRadar', () => ({
  default: ({ data, max }) => (
    <div data-testid="radar" data-max={max} data-labels={data.labels.join('|')} />
  ),
}));

const AZURE_WAF = {
  provider: 'azure',
  overall: 88,
  pillars: [
    { id: 'security', score: 92, commentary: 'Zero-trust segmentation throughout.' },
    { id: 'reliability', score: 84, commentary: 'Zone-redundant hubs.' },
  ],
};

describe('WafAssessment', () => {
  it('renders the radar on a 0-100 scale with vendor pillar labels, plus overall and commentary', () => {
    render(<WafAssessment waf={AZURE_WAF} />);

    const radar = screen.getByTestId('radar');
    expect(radar.dataset.max).toBe('100');
    // Vendor order: Azure lists Reliability before Security.
    expect(radar.dataset.labels).toBe('Reliability|Security');

    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText(/Zero-trust segmentation/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Azure Well-Architected Framework/ })).toHaveAttribute(
      'href',
      expect.stringContaining('learn.microsoft.com')
    );
  });

  it('drops a pillar the provider does not define instead of drawing an invented axis', () => {
    render(
      <WafAssessment
        waf={{
          ...AZURE_WAF,
          // Azure has no Sustainability pillar; a model asked for azure scores
          // can still return one.
          pillars: [...AZURE_WAF.pillars, { id: 'sustainability', score: 70 }],
        }}
      />
    );
    expect(screen.getByTestId('radar').dataset.labels).toBe('Reliability|Security');
  });

  it('says when a human adjusted the AI scores', () => {
    render(<WafAssessment waf={{ ...AZURE_WAF, overriddenBy: 'saul' }} />);
    expect(screen.getByText(/reviewed and adjusted by a human/)).toBeInTheDocument();
  });

  it('renders nothing without a valid provider or any valid pillar', () => {
    const { container } = render(<WafAssessment waf={null} />);
    expect(container).toBeEmptyDOMElement();

    // VMware has no radar-compatible framework — by decision, not omission.
    const vmware = render(
      <WafAssessment
        waf={{ provider: 'vmware', overall: 50, pillars: [{ id: 'plan', score: 1 }] }}
      />
    );
    expect(vmware.container).toBeEmptyDOMElement();

    const strayOnly = render(
      <WafAssessment
        waf={{ provider: 'azure', overall: 50, pillars: [{ id: 'nope', score: 1 }] }}
      />
    );
    expect(strayOnly.container).toBeEmptyDOMElement();
  });
});
