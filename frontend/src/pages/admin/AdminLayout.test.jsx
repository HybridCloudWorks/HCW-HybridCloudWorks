/**
 * The sidebar is the navigation registry (config/adminNav.js, ADR 0033 §3):
 * the groups a first-time user can read, the order the work happens in, and
 * one sentence per item shown on hover. These tests pin the decisions the
 * owner made on 2026-10-03, so the next edit to the array is a visible one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/lib/api', () => ({
  postJSON: vi.fn(),
}));

import { postJSON } from '@/lib/api';
import AdminLayout, { NAV_GROUPS } from './AdminLayout';

const group = (label) => NAV_GROUPS.find((g) => g.label === label);

describe('the navigation registry', () => {
  it('has the seven groups, in the order the owner chose', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Home',
      'Pipeline',
      'Enhanced',
      'Creative',
      'Amplify',
      'Spotlight',
      'Platform',
    ]);
  });

  it('runs the Pipeline in the order the work happens, ending at Live Pages', () => {
    expect(group('Pipeline').items.map((i) => i.label)).toEqual([
      'New Content',
      'Drafts',
      'Review Queue',
      'Editor',
      'Publish',
      'Live Pages',
    ]);
  });

  it('replaces the generic Content group with Enhanced, holding Listen & Learn and Labs', () => {
    expect(group('Content')).toBeUndefined();
    const labels = group('Enhanced').items.map((i) => i.label);
    expect(labels).toContain('Listen & Learn');
    expect(labels).toContain('Labs');
    expect(labels).toContain('Frameworks');
    expect(labels).toContain('Coder Corner');
  });

  it('keeps Labs and Listen & Learn out of Platform and Spotlight', () => {
    expect(group('Platform').items.map((i) => i.label)).toEqual([
      'Platform Settings',
      'Health',
      'Integrations',
    ]);
    expect(group('Spotlight').items.map((i) => i.label)).toEqual([
      'Speaking',
      'Certifications',
      'Ambassador',
    ]);
  });

  it('names the two image pages so their relationship is in the names', () => {
    const labels = group('Creative').items.map((i) => i.label);
    expect(labels).toContain('Image Prompts');
    expect(labels).toContain('Image Gallery');
    expect(labels).not.toContain('Prompts');
  });

  it('gives every group and every item a one-sentence description', () => {
    for (const g of NAV_GROUPS) {
      expect(g.description.length, g.label).toBeGreaterThan(20);
      for (const item of g.items) {
        expect(item.description.length, item.label).toBeGreaterThan(20);
        expect(item.to, item.label).toMatch(/^\/admin/);
        expect(item.icon, item.label).toBeTypeOf('object');
      }
    }
  });

  it('declares no text tag on any menu item (#566)', () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item, item.label).not.toHaveProperty('pill');
    }
  });

  it('no longer offers the routes that were merged away', () => {
    const everyRoute = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    for (const retired of [
      '/admin/ops-health',
      '/admin/diagnostics',
      '/admin/connections',
      '/admin/api-keys',
    ]) {
      expect(everyRoute).not.toContain(retired);
    }
    expect(new Set(everyRoute).size).toBe(everyRoute.length);
  });
});

/**
 * The rendered sidebar (#566): the live badges, the brand readable, the
 * sidebar pinned, one main landmark, and the descriptions on hover.
 */
describe('the admin sidebar', () => {
  let stored;

  beforeEach(() => {
    stored = { 'contentforge-sidebar-collapsed': 'false' };
    vi.stubGlobal('localStorage', {
      getItem: (key) => (key in stored ? stored[key] : null),
      setItem: (key, value) => {
        stored[key] = String(value);
      },
    });
    postJSON.mockResolvedValue({
      stats: {
        blog: { needsReview: 2, inProgress: 1, published: 5 },
        news: { needsReview: 1 },
        framework: { inProgress: 3, published: 2 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderAdmin(path = '/admin/labs') {
    return render(
      <main id="main-content" tabIndex={-1}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="labs" element={<h1>Labs page</h1>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </main>
    );
  }

  it('renders none of the retired tags', async () => {
    renderAdmin();
    const nav = screen.getByRole('navigation', { name: 'ContentForge' });
    await screen.findByText('3');
    for (const tag of ['New', 'Podcast', 'Publer', 'Linkie', 'Resend', 'VPS']) {
      expect(within(nav).queryByText(tag)).not.toBeInTheDocument();
    }
  });

  it('keeps the live count badges for the review queue, the editor and live pages', async () => {
    renderAdmin();
    // queue = 2 + 1 needing review; editor = 1 + 3 in progress; live = 5 + 2.
    const queue = screen.getByRole('link', { name: 'Review Queue' });
    const editor = screen.getByRole('link', { name: 'Editor' });
    const live = screen.getByRole('link', { name: 'Live Pages' });
    expect(await within(queue).findByText('3')).toBeInTheDocument();
    expect(within(editor).getByText('4')).toBeInTheDocument();
    expect(within(live).getByText('7')).toBeInTheDocument();
  });

  it('keeps the badge on the collapsed icon rail', async () => {
    stored['contentforge-sidebar-collapsed'] = 'true';
    renderAdmin();
    const queue = screen.getByRole('link', { name: 'Review Queue' });
    expect(await within(queue).findByText('3')).toBeInTheDocument();
  });

  it('explains every item on hover with the registry sentence', () => {
    renderAdmin();
    const queue = screen.getByRole('link', { name: 'Review Queue' });
    expect(queue).toHaveAttribute('title', group('Pipeline').items[2].description);
    const labs = screen.getByRole('link', { name: 'Labs' });
    expect(labs.getAttribute('title')).toMatch(/learning environments/i);
  });

  it('shows both lines of the brand, with room for them', () => {
    renderAdmin();
    const title = screen.getByText('ContentForge');
    expect(screen.getByText('Influencer CMS')).toBeInTheDocument();
    expect(title.className).not.toContain('leading-none');
    expect(title.parentElement.parentElement.className).not.toMatch(/(^|\s)h-14(\s|$)/);
  });

  it('labels the newsletter page Newsletter Hub', () => {
    renderAdmin();
    const link = screen.getByRole('link', { name: 'Newsletter Hub' });
    expect(link).toHaveAttribute('href', '/admin/mailing-list');
    expect(screen.queryByText('Mailing List')).not.toBeInTheDocument();
  });

  it('pins the sidebar and scrolls the content column instead of the window', () => {
    const { container } = renderAdmin();
    const aside = container.querySelector('aside');
    expect(aside.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(aside.className).toMatch(/(^|\s)top-0(\s|$)/);
    expect(aside.className).toMatch(/(^|\s)h-dvh(\s|$)/);
    expect(screen.getByRole('navigation', { name: 'ContentForge' }).className).toContain(
      'overflow-y-auto'
    );
    const shell = aside.parentElement;
    expect(shell.className).toMatch(/(^|\s)h-dvh(\s|$)/);
    expect(shell.className).toContain('overflow-hidden');
    const content = container.querySelector('#admin-main');
    expect(content.className).toContain('overflow-y-auto');
    expect(within(content).getByText('Labs page')).toBeInTheDocument();
  });

  it('leaves exactly one main landmark on an admin route', () => {
    renderAdmin();
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main-content');
  });
});
