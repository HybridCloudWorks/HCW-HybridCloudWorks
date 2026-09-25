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
