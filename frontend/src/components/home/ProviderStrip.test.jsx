/**
 * The home page provider strip and its frame (owner request 2026-09-28).
 *
 * Behaviour only: jsdom has no layout, so the frame's constant height and the
 * four-line fit were measured in a browser (see providerGuide.test.js). What
 * is pinned here is the part that makes the height constant — every text the
 * frame can show is rendered into it, invisibly, from the first render.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/context/ThemeContext';
import ProviderStrip, { HOVER_INTENT_MS } from './ProviderStrip';
import { PROVIDER_GUIDE, PROVIDER_GUIDE_DEFAULT } from './providerGuide';

const byProvider = Object.fromEntries(PROVIDER_GUIDE.map((entry) => [entry.provider, entry]));

function renderStrip() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <ProviderStrip />
      </MemoryRouter>
    </ThemeProvider>
  );
}

const frameText = () => screen.getByTestId('provider-guide-text');
const hubLink = (label) => screen.getByRole('link', { name: `${label} hub` });
const websiteLink = () => within(screen.getByTestId('provider-guide')).queryByRole('link');

describe('the rows', () => {
  it('shows Azure, AWS, GCP, VMware, then GitHub, FinOps, Terraform, Docker, Ansible', () => {
    renderStrip();
    const row = (n) =>
      within(screen.getByTestId(`provider-row-${n}`))
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label'));
    expect(row(1)).toEqual(['Azure hub', 'AWS hub', 'GCP hub', 'VMware hub']);
    expect(row(2)).toEqual([
      'GitHub hub',
      'FinOps hub',
      'Terraform hub',
      'Docker hub',
      'Ansible hub',
    ]);
  });

  it('links every label to its provider page', () => {
    renderStrip();
    for (const entry of PROVIDER_GUIDE) {
      expect(hubLink(entry.label)).toHaveAttribute('href', `/${entry.provider}`);
    }
  });

  it('draws the pipe before Terraform only, between the framework and service providers', () => {
    renderStrip();
    const starts = within(screen.getByTestId('provider-row-2'))
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-starts-group'));
    expect(starts).toHaveLength(1);
    expect(within(starts[0]).getByRole('link')).toHaveAttribute('aria-label', 'Terraform hub');
    expect(within(screen.getByTestId('provider-row-1')).getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('the frame', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts with the neutral line, and no website link', () => {
    renderStrip();
    expect(frameText()).toHaveTextContent(PROVIDER_GUIDE_DEFAULT);
    expect(websiteLink()).toBeNull();
  });

  it('is a polite live region, mounted from the first render', () => {
    renderStrip();
    expect(frameText()).toHaveAttribute('aria-live', 'polite');
    expect(frameText()).toHaveAttribute('aria-atomic', 'true');
  });

  it('holds every text it can show, hidden, so its height cannot change between providers', () => {
    renderStrip();
    const frame = screen.getByTestId('provider-guide');
    const copies = [...frame.querySelectorAll('p[aria-hidden="true"]')].map((p) => p.textContent);
    expect(copies).toEqual([PROVIDER_GUIDE_DEFAULT, ...PROVIDER_GUIDE.map((e) => e.description)]);
    for (const p of frame.querySelectorAll('p[aria-hidden="true"]')) {
      expect(p.className).toMatch(/\binvisible\b/);
    }
  });

  it('shows a provider once the pointer rests on it, not while it passes over', () => {
    renderStrip();
    fireEvent.mouseEnter(hubLink('AWS'));
    fireEvent.mouseLeave(hubLink('AWS'));
    act(() => vi.advanceTimersByTime(HOVER_INTENT_MS * 2));
    expect(frameText()).toHaveTextContent(PROVIDER_GUIDE_DEFAULT);

    fireEvent.mouseEnter(hubLink('Azure'));
    act(() => vi.advanceTimersByTime(HOVER_INTENT_MS));
    expect(frameText()).toHaveTextContent(byProvider.azure.description);
  });

  it('keeps the last provider shown after the pointer leaves, so it can reach the link', () => {
    renderStrip();
    fireEvent.mouseEnter(hubLink('Docker'));
    act(() => vi.advanceTimersByTime(HOVER_INTENT_MS));
    fireEvent.mouseLeave(hubLink('Docker'));
    act(() => vi.advanceTimersByTime(1000));
    expect(frameText()).toHaveTextContent(byProvider.docker.description);
  });

  it('shows a provider on keyboard focus straight away', () => {
    renderStrip();
    fireEvent.focus(hubLink('Ansible'));
    expect(frameText()).toHaveTextContent(byProvider.ansible.description);
  });

  it('links to the provider’s website in a new tab, named for a screen reader', () => {
    renderStrip();
    fireEvent.focus(hubLink('Azure'));
    const link = websiteLink();
    expect(link).toHaveAttribute('href', 'https://azure.microsoft.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName("Microsoft Azure's website (opens in a new tab)");

    fireEvent.focus(hubLink('Terraform'));
    expect(websiteLink()).toHaveAttribute('href', 'https://developer.hashicorp.com/terraform');
  });

  it('does not move or hold focus', () => {
    renderStrip();
    const docker = hubLink('Docker');
    act(() => docker.focus());
    expect(frameText()).toHaveTextContent(byProvider.docker.description);
    expect(document.activeElement).toBe(docker);
    const frame = screen.getByTestId('provider-guide');
    expect(frame.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(within(frame).getAllByRole('link')).toHaveLength(1);
  });
});

/**
 * Where a click lands. A router Link prevents the browser's default on every
 * plain click and navigates itself, so the default-prevented flag cannot tell
 * "followed" from "held"; the route that renders afterwards can.
 */
function renderStripWithRoutes() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ProviderStrip />} />
          <Route path="/:provider" element={<ProviderPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

function ProviderPage() {
  const { provider } = useParams();
  return <p data-testid="landed">{provider}</p>;
}

describe('a tap', () => {
  it('shows the provider on the first tap and follows the link on the second', () => {
    renderStripWithRoutes();
    const docker = hubLink('Docker');

    fireEvent.pointerDown(docker, { pointerType: 'touch' });
    fireEvent.click(docker);
    expect(screen.queryByTestId('landed')).toBeNull();
    expect(frameText()).toHaveTextContent(byProvider.docker.description);

    fireEvent.pointerDown(docker, { pointerType: 'touch' });
    fireEvent.click(docker);
    expect(screen.getByTestId('landed')).toHaveTextContent('docker');
  });

  it('never holds back a mouse click', () => {
    renderStripWithRoutes();
    const gcp = hubLink('GCP');
    fireEvent.pointerDown(gcp, { pointerType: 'mouse' });
    fireEvent.click(gcp);
    expect(screen.getByTestId('landed')).toHaveTextContent('gcp');
  });

  it('never holds back the keyboard: Enter on a link is a click with no pointer before it', () => {
    renderStripWithRoutes();
    fireEvent.click(hubLink('VMware'));
    expect(screen.getByTestId('landed')).toHaveTextContent('vmware');
  });
});
