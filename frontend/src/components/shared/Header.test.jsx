/**
 * The header's Learn menu (#681): the two cross-provider Learn pages are
 * reachable from every hub, and the Tools menu still is. Until this menu
 * existed nothing in the header linked to `/education` at all.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import Header, { LEARN_MENU_ITEMS } from './Header';

function renderAt(pathname) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Header />
    </MemoryRouter>
  );
}

describe('Header Learn menu', () => {
  it('names the index and the labs page', () => {
    expect(LEARN_MENU_ITEMS.map((item) => item.path)).toEqual(['/education', '/education/labs']);
  });

  it.each(['/', '/azure', '/terraform/tools', '/education/labs'])(
    'opens from %s and links both Learn pages',
    (pathname) => {
      renderAt(pathname);
      const button = screen.getByRole('button', { name: /toggle learn menu/i });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('menu', { name: 'Learn' })).not.toBeInTheDocument();

      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('menu', { name: 'Learn' });
      expect(within(menu).getByRole('menuitem', { name: 'Learn any cloud' })).toHaveAttribute(
        'href',
        '/education'
      );
      expect(within(menu).getByRole('menuitem', { name: 'Browser labs' })).toHaveAttribute(
        'href',
        '/education/labs'
      );
    }
  );

  it('closes on Escape and returns focus to its button', () => {
    renderAt('/');
    const button = screen.getByRole('button', { name: /toggle learn menu/i });
    fireEvent.click(button);
    expect(screen.getByRole('menu', { name: 'Learn' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Learn' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('closes on a click outside', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /toggle learn menu/i }));
    expect(screen.getByRole('menu', { name: 'Learn' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Learn' })).not.toBeInTheDocument();
  });

  it('keeps the Tools menu working beside it', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /toggle tools menu/i }));
    const menu = screen.getByRole('menu', { name: 'Tools' });
    expect(within(menu).getByRole('menuitem', { name: 'Pricing Comparison' })).toHaveAttribute(
      'href',
      '/tools/comparison'
    );
    // Opening one menu does not open the other.
    expect(screen.queryByRole('menu', { name: 'Learn' })).not.toBeInTheDocument();
  });

  it('lists the Learn pages in the mobile menu too', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /toggle menu/i }));
    const mobile = screen.getByRole('navigation', { name: 'Mobile' });
    expect(within(mobile).getByRole('link', { name: 'Browser labs' })).toHaveAttribute(
      'href',
      '/education/labs'
    );
    expect(within(mobile).getByRole('link', { name: 'Learn any cloud' })).toHaveAttribute(
      'href',
      '/education'
    );
  });
});

describe('Header provider links (Docker, 2026-09-28)', () => {
  const primaryLabels = () =>
    within(screen.getByRole('navigation', { name: 'Primary' }))
      .getAllByRole('link')
      .map((link) => link.textContent.trim());

  it('puts Docker between Terraform and Ansible on the all-providers list', () => {
    renderAt('/');
    expect(primaryLabels()).toEqual([
      'Azure',
      'AWS',
      'Google Cloud',
      'VMware',
      'GitHub',
      'FinOps',
      'Terraform',
      'Docker',
      'Ansible',
    ]);
    expect(screen.getByRole('link', { name: 'Docker' })).toHaveAttribute('href', '/docker');
  });

  it('shows the Docker hub its own pages, like Terraform without Modules', () => {
    renderAt('/docker');
    expect(primaryLabels()).toEqual(['News', 'Blogs', 'Code', 'Tools', 'Learning']);
    const hrefs = within(screen.getByRole('navigation', { name: 'Primary' }))
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/docker/rss',
      '/docker/blog',
      '/docker/code',
      '/docker/tools',
      '/docker/education',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /toggle tools menu/i }));
    expect(
      within(screen.getByRole('menu', { name: 'Tools' })).getByRole('menuitem', {
        name: 'Docker Tools',
      })
    ).toHaveAttribute('href', '/docker/tools');
  });

  it('sizes the all-providers columns to their labels', () => {
    // The all-providers list does not fit fixed 90px columns beside the logo:
    // with eight providers it was 936px and squeezed the logo to zero width
    // at every desktop width; nine would be 1030px.
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Primary' }).style.gridTemplateColumns).toBe(
      'repeat(11, max-content)'
    );
  });

  it('keeps 90px columns on a hub, so its links line up from one hub to the next', () => {
    renderAt('/terraform');
    expect(screen.getByRole('navigation', { name: 'Primary' }).style.gridTemplateColumns).toBe(
      'repeat(8, 90px)'
    );
  });

  it('lets the mobile menu scroll rather than run off a short screen', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /toggle menu/i }));
    const mobile = screen.getByRole('navigation', { name: 'Mobile' });
    expect(mobile.className).toMatch(/overflow-y-auto/);
    expect(mobile.className).toMatch(/max-h-\[calc\(100dvh-4rem\)\]/);
    expect(within(mobile).getByRole('link', { name: 'Docker' })).toHaveAttribute('href', '/docker');
  });
});
