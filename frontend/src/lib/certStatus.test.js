import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveStatus, findStaleStatuses, isPastDate, todayIso, useToday } from './certStatus';

const TODAY = '2026-09-09';

describe('useToday', () => {
  const FALLBACK = '2000-01-01';

  it('pre-renders with the fallback, hydrates against it, then switches to the local date', async () => {
    // What scripts/prerender.mjs does at build time, then what main.jsx does
    // in the browser: the HTML and the hydrating render must agree (both see
    // the fallback), and only then may "today" move to the viewer's date.
    const seen = [];
    function Probe() {
      const today = useToday(FALLBACK);
      seen.push(today);
      return createElement('p', null, today);
    }
    const html = renderToString(createElement(Probe));
    expect(html).toContain(FALLBACK);
    expect(seen).toEqual([FALLBACK]);

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    let root;
    await act(async () => {
      root = hydrateRoot(container, createElement(Probe), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(seen[1]).toBe(FALLBACK);
    expect(seen[seen.length - 1]).toBe(todayIso());
    expect(container.textContent).toBe(todayIso());
    await act(async () => root.unmount());
    container.remove();
  });

  it('uses the local date straight away on a client-only render', () => {
    // A client-side navigation has no HTML to agree with, so nothing waits.
    const seen = [];
    function Probe() {
      seen.push(useToday(FALLBACK));
      return null;
    }
    render(createElement(Probe));
    expect(seen[0]).toBe(todayIso());
  });
});

describe('isPastDate', () => {
  it('compares ISO dates as text, strictly before today', () => {
    expect(isPastDate('2026-09-08', TODAY)).toBe(true);
    expect(isPastDate('2026-09-09', TODAY)).toBe(false);
    expect(isPastDate('2026-09-10', TODAY)).toBe(false);
  });

  it('never treats a missing or malformed date as past', () => {
    expect(isPastDate(undefined, TODAY)).toBe(false);
    expect(isPastDate(null, TODAY)).toBe(false);
    expect(isPastDate('June 30, 2026', TODAY)).toBe(false);
    expect(isPastDate('2026-06-30', 'not-a-date')).toBe(false);
  });
});

describe('todayIso', () => {
  it('formats the local calendar date with zero padding', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('deriveStatus', () => {
  it('retires an "expiring" certification once its expiryDate has passed', () => {
    expect(deriveStatus({ status: 'expiring', expiryDate: '2026-06-30' }, TODAY)).toBe('retired');
  });

  it('keeps "expiring" while the expiryDate is still ahead', () => {
    expect(deriveStatus({ status: 'expiring', expiryDate: '2026-09-30' }, TODAY)).toBe('expiring');
    expect(deriveStatus({ status: 'expiring', expiryDate: '2026-09-09' }, TODAY)).toBe('expiring');
  });

  it('retires an "active" certification whose expiryDate has passed (MB-240 on 2026-09-09)', () => {
    expect(deriveStatus({ status: 'active', expiryDate: '2026-06-30' }, TODAY)).toBe('retired');
  });

  it('reads a future expiryDate on an "active" entry as expiring', () => {
    expect(deriveStatus({ status: 'active', expiryDate: '2026-11-30' }, TODAY)).toBe('expiring');
  });

  it('promotes a beta to active once its betaEndDate has passed', () => {
    expect(deriveStatus({ status: 'beta', betaEndDate: '2026-06-30' }, TODAY)).toBe('active');
  });

  it('promotes a beta to active on its gaDate', () => {
    expect(deriveStatus({ status: 'beta', gaDate: '2026-09-09' }, TODAY)).toBe('active');
    expect(deriveStatus({ status: 'beta', gaDate: '2026-10-01' }, TODAY)).toBe('beta');
  });

  it('keeps a beta with no dates as beta', () => {
    expect(deriveStatus({ status: 'beta' }, TODAY)).toBe('beta');
  });

  it('keeps a stored "retired" and an "active" with no dates', () => {
    expect(deriveStatus({ status: 'retired' }, TODAY)).toBe('retired');
    expect(deriveStatus({ status: 'active' }, TODAY)).toBe('active');
  });

  it('treats an unknown or missing status as active', () => {
    expect(deriveStatus({}, TODAY)).toBe('active');
    expect(deriveStatus({ status: 'bogus' }, TODAY)).toBe('active');
    expect(deriveStatus(null, TODAY)).toBe('active');
  });

  it('defaults today to the local date', () => {
    expect(deriveStatus({ status: 'expiring', expiryDate: '2000-01-01' })).toBe('retired');
    expect(deriveStatus({ status: 'expiring', expiryDate: '2999-01-01' })).toBe('expiring');
  });
});

describe('findStaleStatuses', () => {
  it('names every stored status its own dates contradict', () => {
    const problems = findStaleStatuses(
      [
        { code: 'A', status: 'expiring', expiryDate: '2026-06-30' },
        { code: 'B', status: 'beta', betaEndDate: '2026-05-07' },
        { code: 'C', status: 'beta', gaDate: '2026-06-01' },
        { code: 'D', status: 'active', expiryDate: '2026-06-30' },
        { code: 'E', status: 'expiring', expiryDate: '2026-09-30' },
        { code: 'F', status: 'beta' },
        { code: 'G', status: 'retired', expiryDate: '2026-06-30' },
      ],
      TODAY
    );
    expect(problems).toEqual([
      "A: status 'expiring' but expiryDate 2026-06-30 has passed",
      "B: status 'beta' but betaEndDate 2026-05-07 has passed",
      "C: status 'beta' but gaDate 2026-06-01 has been reached",
      "D: status 'active' but expiryDate 2026-06-30 has passed",
    ]);
  });

  it('returns nothing for a consistent list', () => {
    expect(findStaleStatuses([{ code: 'A', status: 'active' }], TODAY)).toEqual([]);
    expect(findStaleStatuses(undefined, TODAY)).toEqual([]);
  });
});
