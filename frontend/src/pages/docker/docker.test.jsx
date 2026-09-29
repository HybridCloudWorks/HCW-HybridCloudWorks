/**
 * Docker's pages (owner request 2026-09-28). A page whose content is still to
 * be written is a placeholder: it says what it will cover and that it is
 * coming, reads nothing from the API, and points at something a visitor can
 * use now. The sandbox recipe is real content, on its own page (#774).
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderContext from '@/context/ProviderContext';
import { SANDBOX_COMMANDS } from '@/components/labs/SandboxSection';
import DockerLandingPage, { FOCUS_AREAS } from './LandingPage';
import DockerBlogPage from './BlogPage';
import DockerCodePage, { LAB_IMAGE_SOURCE_URL } from './CodePage';
import DockerEducationPage from './EducationPage';
import DockerRssPage from './RssPage';
import DockerSandboxesPage, {
  CHECKED_ON,
  RECIPE_HEADING_ID,
  SANDBOXES_DOCS_URL,
  SANDBOXES_PATH,
} from './SandboxesPage';
import DockerToolsPage from './ToolsPage';

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

  it('has the three focus areas, in order: two coming soon, the sandbox one available now', () => {
    renderPage(<DockerLandingPage />);
    expect(FOCUS_AREAS.map((area) => area.title)).toEqual([
      'Building images',
      'The Docker Desktop app',
      'Running an agent in a sandbox',
    ]);
    for (const area of FOCUS_AREAS) {
      expect(screen.getByRole('heading', { level: 2, name: area.title })).toBeInTheDocument();
    }
    const status = (id) => within(screen.getByTestId(id));
    expect(status('building-images').getByText('Coming soon')).toBeInTheDocument();
    expect(status('docker-desktop').getByText('Coming soon')).toBeInTheDocument();
    expect(status('agent-sandbox').getByText('Available now')).toBeInTheDocument();
    expect(status('agent-sandbox').queryByText('Coming soon')).toBeNull();
  });

  it('uses the site’s own lab image as the worked example for building images', () => {
    renderPage(<DockerLandingPage />);
    const area = screen.getByTestId('building-images');
    expect(area).toHaveTextContent(/hcw-lab/);
    expect(area).toHaveTextContent(/multi-stage builds/i);
    expect(area).toHaveTextContent(/provenance attestations/i);
  });

  it('points the sandbox area at the Docker hub’s own sandboxes page', () => {
    renderPage(<DockerLandingPage />);
    const link = within(screen.getByTestId('agent-sandbox')).getByRole('link', {
      name: /run an agent in a sandbox/i,
    });
    expect(link).toHaveAttribute('href', '/docker/sandboxes');
    expect(SANDBOXES_PATH).toBe('/docker/sandboxes');
  });

  it('reads nothing from the content API', () => {
    renderPage(<DockerLandingPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Latest Published Content/i)).toBeNull();
  });
});

describe('the Docker sandboxes page', () => {
  it('names itself in its heading and title, and holds the whole recipe under its old heading', () => {
    renderPage(<DockerSandboxesPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Run an agent in a sandbox' })
    ).toBeInTheDocument();
    expect(document.title).toBe('Run an agent in a sandbox | Hybrid Cloud Works');

    const heading = screen.getByRole('heading', {
      level: 2,
      name: 'Run an agent against your landing zone',
    });
    // The id the section had on the labs page, so a copied fragment still means it.
    expect(heading).toHaveAttribute('id', RECIPE_HEADING_ID);
    expect(RECIPE_HEADING_ID).toBe('agent-heading');

    const recipe = screen.getByTestId('sandbox-section');
    expect(within(recipe).getAllByTestId('sandbox-step')).toHaveLength(3);
    const lines = [...recipe.querySelectorAll('pre code')];
    expect(lines.map((line) => line.dataset.shell)).toEqual(['PowerShell', 'bash']);
    expect(lines.map((line) => line.textContent)).toEqual(
      SANDBOX_COMMANDS.map((entry) => entry.command)
    );
    expect(within(recipe).getByTestId('sandbox-first-prompt')).toBeInTheDocument();
    expect(within(recipe).getByTestId('sandbox-cost')).toBeInTheDocument();
  });

  it('says when the commands were last checked, as a machine-readable date', () => {
    renderPage(<DockerSandboxesPage />);
    const checked = screen.getByTestId('sandboxes-checked');
    expect(checked).toHaveTextContent(`last checked on ${CHECKED_ON.label}`);
    expect(checked.querySelector('time')).toHaveAttribute('datetime', CHECKED_ON.iso);
    // A real calendar date, and the label says the same day.
    const day = new Date(`${CHECKED_ON.iso}T00:00:00Z`);
    expect(
      day.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    ).toBe(CHECKED_ON.label);
  });

  it('links to Docker’s documentation in a new tab, the labs, and the hub; and reads nothing', () => {
    renderPage(<DockerSandboxesPage />);
    const nav = screen.getByRole('navigation', { name: 'More on Docker' });
    const docs = within(nav).getByRole('link', { name: /docker sandboxes documentation/i });
    expect(docs).toHaveAttribute('href', SANDBOXES_DOCS_URL);
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
    expect(docs).toHaveAccessibleName(/opens in a new tab/);
    expect(within(nav).getByRole('link', { name: /see the browser labs/i })).toHaveAttribute(
      'href',
      '/education/labs'
    );
    expect(within(nav).getByRole('link', { name: /back to the docker hub/i })).toHaveAttribute(
      'href',
      '/docker'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is not a placeholder', () => {
    renderPage(<DockerSandboxesPage />);
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});

describe('where the recipe used to be', () => {
  it('keeps the labs page’s `agent` slot, whose heading id is agent-heading, pointing here', () => {
    // Read as text: the labs page has its own rendered test. What matters here
    // is that an old `/education/labs#agent-heading` link still lands on a
    // heading, and that the heading's section sends the visitor on.
    const src = (...parts) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');
    const labs = src('pages', 'shared', 'LabsLearnPage.jsx');
    expect(labs).toMatch(/<LabsSlot\s+id="agent"/);
    expect(labs).toContain("routes.sandboxes('docker')");
    expect(labs).not.toContain('<SandboxSection');
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

  it('sends the tools page to the sandboxes page, in the same tab', () => {
    renderPage(<DockerToolsPage />);
    const link = screen.getByRole('link', { name: /run an agent in a sandbox/i });
    expect(link).toHaveAttribute('href', SANDBOXES_PATH);
    expect(link).not.toHaveAttribute('target');
  });
});
