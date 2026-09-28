/**
 * Docker's pages are placeholders (owner request 2026-09-28): each says what
 * it will cover and that it is coming, reads nothing from the API, and points
 * at something a visitor can use now.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderContext from '@/context/ProviderContext';
import DockerLandingPage, { FOCUS_AREAS } from './LandingPage';
import DockerBlogPage from './BlogPage';
import DockerCodePage, { LAB_IMAGE_SOURCE_URL } from './CodePage';
import DockerEducationPage from './EducationPage';
import DockerRssPage from './RssPage';
import DockerToolsPage from './ToolsPage';
import { LABS_AGENT_SECTION_PATH } from './DockerPlaceholderPage';

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }) => <>{children}</>,
}));

function renderPage(page) {
  return render(
    <MemoryRouter>
      <ProviderContext.Provider value="docker">{page}</ProviderContext.Provider>
    </MemoryRouter>
  );
}

let fetchSpy;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('a Docker placeholder page called the network');
  });
});
afterEach(() => fetchSpy.mockRestore());

describe('the Docker landing page', () => {
  it('names Docker in its heading and its title, without calling itself "Docker Hub"', () => {
    renderPage(<DockerLandingPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Container intelligence with Docker' })
    ).toBeInTheDocument();
    // "Docker Hub" is the name of Docker's own image registry.
    expect(document.title).toBe('Docker Containers Hub | Hybrid Cloud Works');
  });

  it('has the three focus areas, in order, each marked coming soon', () => {
    renderPage(<DockerLandingPage />);
    expect(FOCUS_AREAS.map((area) => area.title)).toEqual([
      'Building images',
      'The Docker Desktop app',
      'Running an agent in a sandbox',
    ]);
    for (const area of FOCUS_AREAS) {
      expect(screen.getByRole('heading', { level: 2, name: area.title })).toBeInTheDocument();
      expect(within(screen.getByTestId(area.id)).getByText('Coming soon')).toBeInTheDocument();
    }
  });

  it('uses the site’s own lab image as the worked example for building images', () => {
    renderPage(<DockerLandingPage />);
    const area = screen.getByTestId('building-images');
    expect(area).toHaveTextContent(/hcw-lab/);
    expect(area).toHaveTextContent(/multi-stage builds/i);
    expect(area).toHaveTextContent(/provenance attestations/i);
  });

  it('points the sandbox area at the labs page section that holds the recipe today', () => {
    renderPage(<DockerLandingPage />);
    const link = within(screen.getByTestId('agent-sandbox')).getByRole('link', {
      name: /run an agent against your landing zone/i,
    });
    expect(link).toHaveAttribute('href', '/education/labs#agent-heading');
    expect(LABS_AGENT_SECTION_PATH).toBe('/education/labs#agent-heading');
  });

  it('reads nothing from the content API', () => {
    renderPage(<DockerLandingPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Latest Published Content/i)).toBeNull();
  });
});

describe('the section the sandbox link lands on', () => {
  it('still exists on the labs page as the `agent` slot, whose heading id is agent-heading', () => {
    // Read, not rendered or edited: another change owns that page. If the slot
    // is renamed, LABS_AGENT_SECTION_PATH has to follow it.
    const src = (...parts) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');
    expect(src('pages', 'shared', 'LabsLearnPage.jsx')).toMatch(/<LabsSlot\s+id="agent"/);
    expect(src('components', 'labs', 'LabsSlot.jsx')).toContain('id={`${id}-heading`}');
  });
});

describe.each([
  ['blog', DockerBlogPage, 'Docker Blog'],
  ['code', DockerCodePage, 'Docker Code'],
  ['education', DockerEducationPage, 'Docker Learning'],
  ['news', DockerRssPage, 'Docker News'],
  ['tools', DockerToolsPage, 'Docker Tools'],
])('the Docker %s page', (section, Page, title) => {
  it('is an honest placeholder: its heading, "Coming soon", and what it will cover', () => {
    renderPage(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(document.title).toBe(`${title} | Hybrid Cloud Works`);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    const plans = screen.getByRole('heading', { level: 2, name: 'What this page will cover' });
    expect(within(plans.closest('section')).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('links back to the Docker hub, and reads nothing from the API', () => {
    renderPage(<Page />);
    const nav = screen.getByRole('navigation', { name: 'Docker pages you can use now' });
    expect(within(nav).getByRole('link', { name: /back to the docker hub/i })).toHaveAttribute(
      'href',
      '/docker'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('links out of the placeholders', () => {
  it('opens other sites in a new tab and says so', () => {
    renderPage(<DockerCodePage />);
    const link = screen.getByRole('link', { name: /lab image’s dockerfile/i });
    expect(link).toHaveAttribute('href', LAB_IMAGE_SOURCE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAccessibleName(/opens in a new tab/);
  });

  it('sends the tools page to the sandbox recipe with a document link, so the browser scrolls to it', () => {
    renderPage(<DockerToolsPage />);
    const link = screen.getByRole('link', { name: /run an agent against your landing zone/i });
    expect(link).toHaveAttribute('href', LABS_AGENT_SECTION_PATH);
    expect(link).not.toHaveAttribute('target');
  });
});
