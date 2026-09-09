/**
 * The badge must agree with the HTML it hydrates (#465 review). The hubs are
 * pre-rendered with "today" = `DATA_AS_OF` and hydrated the same way, then
 * move to the viewer's date. This pins that sequence for the badge exactly
 * as `certStatus.test.js` pins it for `useToday` itself.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useToday } from '@/lib/certStatus';
import CertStatusBadge from './CertStatusBadge';

// A catalogue "checked" in 2000 with a row that retired later in 2000: the
// fallback date says Retiring, the real date says Retired.
const AS_OF = '2000-01-01';
const CERT = {
  code: 'X-1',
  status: 'expiring',
  expiryDate: '2000-06-01',
  replacement: { code: 'X-2' },
};

function Page() {
  const today = useToday(AS_OF);
  return createElement(CertStatusBadge, { cert: CERT, today });
}

describe('CertStatusBadge', () => {
  it('is pure: the same cert and today always give the same markup', () => {
    const { container } = render(
      createElement(CertStatusBadge, { cert: CERT, today: '2000-03-01' })
    );
    expect(container.textContent).toBe('Retiring· last day to test Jun 1, 2000 · replaced by X-2');
    expect(container.querySelector('[data-cert-status]').dataset.certStatus).toBe('expiring');
  });

  it('renders nothing for an active exam', () => {
    const { container } = render(
      createElement(CertStatusBadge, { cert: { status: 'active' }, today: '2026-09-09' })
    );
    expect(container.innerHTML).toBe('');
  });

  it('pre-renders and hydrates on DATA_AS_OF, then moves to the real date without a mismatch', async () => {
    const html = renderToString(createElement(Page));
    expect(html).toContain('Retiring');
    expect(html).not.toContain('Retired');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    let root;
    await act(async () => {
      root = hydrateRoot(container, createElement(Page), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Retired· Jun 1, 2000 · replaced by X-2');
    expect(container.querySelector('[data-cert-status]').dataset.certStatus).toBe('retired');
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows the real date straight away on a client-only render', () => {
    render(createElement(Page));
    expect(screen.getByText('Retired')).toBeInTheDocument();
  });
});
