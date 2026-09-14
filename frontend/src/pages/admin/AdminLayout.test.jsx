/**
 * The Platform group's order and membership.
 *
 * The owner asked for this order explicitly — Platform Settings first, Labs
 * last, with the two merged pages between them — so it is asserted rather than
 * left to whoever next appends an item to the array. Appending is what the
 * array invites, and an appended item lands after Labs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/lib/api', () => ({
  postJSON: vi.fn(),
}));

import { postJSON } from '@/lib/api';
import AdminLayout, { NAV_GROUPS } from './AdminLayout';

const platform = () => NAV_GROUPS.find((group) => group.label === 'Platform');

describe('the Platform nav group', () => {
  it('runs settings, health, integrations, labs — in that order', () => {
    expect(platform().items.map((item) => item.label)).toEqual([
      'Platform Settings',
      'Health',
      'Integrations',
      'Labs',
    ]);
  });

  it('points each item at the route that still exists', () => {
    expect(platform().items.map((item) => item.to)).toEqual([
      '/admin/platform',
      '/admin/health',
      '/admin/integrations',
      '/admin/labs',
    ]);
  });

  it('no longer offers the four routes that were merged away', () => {
    // These still resolve — App.jsx redirects them — but a nav entry pointing
    // at a redirect is a second name for one page, which is the thing the
    // merge removed.
    const everyRoute = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    for (const retired of [
      '/admin/ops-health',
      '/admin/diagnostics',
      '/admin/connections',
      '/admin/api-keys',
    ]) {
      expect(everyRoute).not.toContain(retired);
    }
  });
});

/**
 * The rendered sidebar (#566): no product tags, the live badges kept, the
 * brand readable, the sidebar pinned, and one main landmark.
 */
describe('the admin sidebar', () => {
  /** The saved collapsed/expanded choice the layout reads on mount. */
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
        blog: { needsReview: 2, inProgress: 1 },
        news: { needsReview: 1 },
        framework: { inProgress: 3 },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Mount the layout the way App.jsx does: every route, admin included, sits
   * inside App's `<main id="main-content">`.
   */
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

  it('declares no text tag on any menu item', () => {
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(item, item.label).not.toHaveProperty('pill');
    }
  });

  it('renders none of the retired tags', async () => {
    renderAdmin();
    const nav = screen.getByRole('navigation');
    await screen.findByText('3');
    for (const tag of ['New', 'Podcast', 'Publer', 'Linkie', 'Resend', 'VPS']) {
      expect(within(nav).queryByText(tag)).not.toBeInTheDocument();
    }
  });

  it('keeps the live count badges for the review queue and the editor', async () => {
    renderAdmin();
    // queue = 2 + 1 needing review; editor = 1 + 3 in progress.
    const queue = screen.getByRole('link', { name: 'Review Queue' });
    const editor = screen.getByRole('link', { name: 'Editor' });
    expect(await within(queue).findByText('3')).toBeInTheDocument();
    expect(within(editor).getByText('4')).toBeInTheDocument();
  });

  it('keeps the badge on the collapsed icon rail', async () => {
    stored['contentforge-sidebar-collapsed'] = 'true';
    renderAdmin();
    const queue = screen.getByRole('link', { name: 'Review Queue' });
    expect(await within(queue).findByText('3')).toBeInTheDocument();
  });

  it('shows both lines of the brand, with room for them', () => {
    renderAdmin();
    const title = screen.getByText('ContentForge');
    expect(screen.getByText('Influencer CMS')).toBeInTheDocument();
    // `leading-none` in a fixed `h-14` is what cut the title off at zoom.
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
    // The nav list scrolls on its own when the menu outgrows the screen.
    expect(screen.getByRole('navigation').className).toContain('overflow-y-auto');

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
    // The one that ScrollToTop focuses and the skip link targets.
    expect(mains[0]).toHaveAttribute('id', 'main-content');
  });
});
