/**
 * IntegrationBadge: one pill per platform, from one registry, rendering
 * nothing for an id it does not know, so it can sit beside any service
 * (owner brief 2026-10-06, #918).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import IntegrationBadge, { BRANDS, brandFor } from './IntegrationBadge';
import { SERVICES } from '@/components/admin/integrations/serviceRegistry';

describe('the registry', () => {
  it('has a name, a colour and a site for every entry, and a dark colour wherever the brand is black', () => {
    for (const [id, brand] of Object.entries(BRANDS)) {
      expect(brand.name, id).toBeTruthy();
      expect(brand.color, id).toMatch(/^#[0-9A-F]{6}$/);
      expect(brand.site, id).toMatch(/^https:\/\//);
      if (brand.color === '#000000')
        expect(brand.onDark, `${id} needs a dark-mode colour`).toBeTruthy();
    }
  });

  it('knows every key-based service on the Integrations page that a card would credit', () => {
    // The education profiles and the site platform values are not third-party
    // platforms a feature is "powered by"; everything with a key is.
    const credited = SERVICES.filter(
      (s) =>
        (s.secrets ?? []).length > 0 &&
        s.group !== 'platform' &&
        s.group !== 'labs' &&
        s.group !== 'code-quality' &&
        s.group !== 'cloud' &&
        s.id !== 'linkie'
    );
    for (const service of credited) {
      expect(
        brandFor(service.id),
        `${service.id} (${service.name}) has no brand entry`
      ).not.toBeNull();
    }
  });

  it('looks an id up case-insensitively and answers null for the unknown', () => {
    expect(brandFor('Telegram')).toMatchObject({ id: 'telegram', name: 'Telegram' });
    expect(brandFor('nothing-here')).toBeNull();
    expect(brandFor(undefined)).toBeNull();
    expect(brandFor('constructor')).toBeNull();
  });
});

describe('the badge', () => {
  it('says "Powered by <Platform>" in the brand colour, with a medallion that is not read aloud', () => {
    render(<IntegrationBadge id="telegram" />);
    const pill = screen.getByText(/Powered by Telegram/);
    expect(pill.getAttribute('data-brand')).toBe('telegram');
    expect(pill.getAttribute('title')).toBe('Telegram · https://telegram.org');
    expect(pill.style.getPropertyValue('--brand')).toBe('#26A5E4');
    expect(pill.querySelector('[aria-hidden="true"]').textContent).toBe('T');
  });

  it('takes another prefix where the relationship is more exact, and renders nothing for an unknown id', () => {
    const { container } = render(
      <>
        <IntegrationBadge id="telegram" prefix="Delivered by" />
        <IntegrationBadge id="not-a-service" />
      </>
    );
    expect(screen.getByText(/Delivered by Telegram/)).toBeTruthy();
    expect(container.querySelectorAll('[data-brand]')).toHaveLength(1);
  });

  it('uses the dark-mode colour for a black brand', () => {
    render(<IntegrationBadge id="openai" />);
    const pill = screen.getByText(/Powered by OpenAI/);
    expect(pill.style.getPropertyValue('--brand')).toBe('#000000');
    expect(pill.style.getPropertyValue('--brand-dark')).toBe('#FFFFFF');
  });

  it('can be a link to the platform, opening in a new tab', () => {
    render(<IntegrationBadge id="cloudflare" link />);
    const a = screen.getByRole('link', { name: /Powered by Cloudflare/ });
    expect(a.getAttribute('href')).toBe('https://www.cloudflare.com');
    expect(a.getAttribute('rel')).toContain('noopener');
  });
});
