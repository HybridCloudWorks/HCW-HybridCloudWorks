/**
 * ProviderLogo: the theme is chosen by CSS, so the markup is the same whatever
 * theme renders it. That sameness is what fixes the pre-rendered home page,
 * where the static HTML carried the light-theme GitHub mark and hydration
 * kept it on the dark theme.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROVIDER_LOGOS } from '@/lib/providerLogos';
import ProviderLogo from './ProviderLogo';

const images = (container) => [...container.querySelectorAll('img')];

describe('ProviderLogo', () => {
  it('renders both files for a provider with two, and lets .dark pick one', () => {
    const { container } = render(<ProviderLogo provider="aws" className="h-7 w-auto" alt="" />);
    const [light, dark] = images(container);
    expect(images(container)).toHaveLength(2);
    expect(light.getAttribute('src')).toBe(PROVIDER_LOGOS.aws.light);
    expect(light.className.split(' ')).toEqual(expect.arrayContaining(['h-7', 'dark:hidden']));
    expect(light.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(dark.getAttribute('src')).toBe(PROVIDER_LOGOS.aws.dark);
    expect(dark.className.split(' ')).toEqual(
      expect.arrayContaining(['h-7', 'hidden', 'dark:inline'])
    );
  });

  it('renders one image for a provider whose logo reads on both themes', () => {
    const { container } = render(<ProviderLogo provider="azure" className="h-7" />);
    expect(images(container)).toHaveLength(1);
    expect(images(container)[0].getAttribute('src')).toBe(PROVIDER_LOGOS.azure.light);
    expect(images(container)[0].className).toBe('h-7');
  });

  it('passes alt text and image attributes to both files', () => {
    const { container } = render(
      <ProviderLogo provider="github" alt="GitHub logo" loading="lazy" decoding="async" />
    );
    for (const img of images(container)) {
      expect(img.getAttribute('alt')).toBe('GitHub logo');
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(img.getAttribute('decoding')).toBe('async');
    }
  });

  it('renders nothing for a provider it has no logo for', () => {
    const { container } = render(<ProviderLogo provider="nope" />);
    expect(container.innerHTML).toBe('');
  });
});
