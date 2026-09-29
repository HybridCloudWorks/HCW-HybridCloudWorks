/**
 * The "Catalogue checked against …" line keeps AA contrast (2026-09-29).
 *
 * `text-foreground/50` measured 3.28:1 on the `/education` tiles in light
 * mode. The line now takes the theme's secondary-text token, which index.css
 * keeps above 4.5:1 in both themes; the browser check is `/education` in
 * e2e/contrast.spec.js. This pins the class so a faded foreground cannot
 * come back without a test saying why it went.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CatalogueFreshness, { FRESHNESS_TEXT_CLASS } from './CatalogueFreshness';

describe('CatalogueFreshness', () => {
  it('uses the muted text token, and no faded or fixed-grey text colour', () => {
    render(
      <CatalogueFreshness
        asOf="2026-09-29"
        source={{ label: 'Docker', url: 'https://docs.docker.com' }}
        className="mt-1"
      />
    );
    const line = screen.getByText(/Catalogue checked against/);
    expect(line.className).toBe(`${FRESHNESS_TEXT_CLASS} mt-1`);
    expect(FRESHNESS_TEXT_CLASS).toContain('text-muted-foreground');
    // An opacity modifier on a text colour is what failed; so would a fixed grey.
    expect(line.className).not.toMatch(/\btext-[\w-]+\/\d+/);
    expect(line.className).not.toMatch(/\btext-(?:slate|gray|zinc|neutral)-\d/);
  });

  it('still says what was checked, against whom, and when', () => {
    render(<CatalogueFreshness asOf="2026-09-29" source={{ label: 'Docker' }} />);
    const line = screen.getByText(/Catalogue checked against/);
    expect(line).toHaveTextContent('Catalogue checked against Docker on Sep 29, 2026.');
    expect(line.querySelector('time')).toHaveAttribute('dateTime', '2026-09-29');
  });

  it('renders nothing without a date', () => {
    const { container } = render(<CatalogueFreshness asOf="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
