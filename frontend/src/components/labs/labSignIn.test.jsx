/**
 * The sign-in records the lab panes keep (#751): a started sign-in is taken
 * once and only while fresh, a completed one reads as a time while fresh,
 * both survive storage that throws, another tab's write reaches a
 * subscriber, and the labs page sends a tab returning from sign-in on to its
 * pane only when the tab arrived from outside the site.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGNED_IN_KEY,
  SIGNED_IN_MS,
  SIGN_IN_PENDING_KEY,
  SIGN_IN_PENDING_MS,
  markSignInStarted,
  markSignedIn,
  readSignedInAt,
  subscribeSignedIn,
  takePendingSignIn,
  useLabSignInReturn,
} from './labSignIn';

const NOW = Date.parse('2026-09-28T12:00:00Z');
const LAB = 'terraform-validate-walkthrough';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a started sign-in', () => {
  it('is taken once, for the lab it came from', () => {
    markSignInStarted(LAB, NOW);
    expect(JSON.parse(window.localStorage.getItem(SIGN_IN_PENDING_KEY))).toEqual({
      labId: LAB,
      at: NOW,
    });
    expect(takePendingSignIn(NOW + 60_000)).toBe(LAB);
    expect(window.localStorage.getItem(SIGN_IN_PENDING_KEY)).toBeNull();
    expect(takePendingSignIn(NOW + 60_000)).toBeNull();
  });

  it('is dropped, not acted on, once it is older than the wait', () => {
    markSignInStarted(LAB, NOW);
    expect(takePendingSignIn(NOW + SIGN_IN_PENDING_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(SIGN_IN_PENDING_KEY)).toBeNull();
  });

  it('is dropped when it is not the shape this page writes', () => {
    window.localStorage.setItem(SIGN_IN_PENDING_KEY, 'not json');
    expect(takePendingSignIn(NOW)).toBeNull();
    window.localStorage.setItem(SIGN_IN_PENDING_KEY, JSON.stringify({ labId: 7, at: NOW }));
    expect(takePendingSignIn(NOW)).toBeNull();
    window.localStorage.setItem(SIGN_IN_PENDING_KEY, JSON.stringify({ labId: LAB, at: NOW + 5 }));
    expect(takePendingSignIn(NOW)).toBeNull();
  });
});

describe('a completed sign-in', () => {
  it('reads as its time while fresh, and as nothing after', () => {
    expect(readSignedInAt(NOW)).toBe(0);
    markSignedIn(NOW);
    expect(window.localStorage.getItem(SIGNED_IN_KEY)).toBe(String(NOW));
    expect(readSignedInAt(NOW + 1000)).toBe(NOW);
    expect(readSignedInAt(NOW + SIGNED_IN_MS + 1)).toBe(0);
    expect(readSignedInAt(NOW - 1)).toBe(0);
    window.localStorage.setItem(SIGNED_IN_KEY, 'soon');
    expect(readSignedInAt(NOW)).toBe(0);
  });

  it('reaches a subscriber from another tab, and from this one, until it unsubscribes', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSignedIn(onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: SIGNED_IN_KEY, newValue: '1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    markSignedIn(NOW);
    expect(onChange).toHaveBeenCalledTimes(3);

    unsubscribe();
    markSignedIn(NOW + 1);
    window.dispatchEvent(new StorageEvent('storage', { key: SIGNED_IN_KEY, newValue: '2' }));
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});

describe('storage that refuses', () => {
  it('reads as nothing recorded and never throws', () => {
    for (const method of ['getItem', 'setItem', 'removeItem']) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('SecurityError: storage is disabled');
      });
    }
    expect(() => markSignInStarted(LAB, NOW)).not.toThrow();
    expect(() => markSignedIn(NOW)).not.toThrow();
    expect(takePendingSignIn(NOW)).toBeNull();
    expect(readSignedInAt(NOW)).toBe(0);
  });
});

function ReturningLabsPage() {
  useLabSignInReturn();
  return <p>labs page</p>;
}

function renderLabsAt(entries, index = entries.length - 1) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route path="/education/labs" element={<ReturningLabsPage />} />
        <Route path="/education/labs/:labId" element={<p>pane page</p>} />
        <Route path="/education" element={<p>learn page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('useLabSignInReturn', () => {
  it('sends a tab arriving from outside the site on to the pane its sign-in started from', async () => {
    markSignInStarted(LAB);
    renderLabsAt(['/education/labs']);
    expect(await screen.findByText('pane page')).toBeInTheDocument();
    expect(window.localStorage.getItem(SIGN_IN_PENDING_KEY)).toBeNull();
    expect(readSignedInAt()).toBeGreaterThan(0);
  });

  it('leaves a visit that came by the site’s own links alone, and keeps the record', () => {
    // "Back to labs" in the tab still waiting on sign-in must not bounce back.
    markSignInStarted(LAB);
    renderLabsAt(['/education', '/education/labs']);
    expect(screen.getByText('labs page')).toBeInTheDocument();
    expect(window.localStorage.getItem(SIGN_IN_PENDING_KEY)).not.toBeNull();
    expect(readSignedInAt()).toBe(0);
  });

  it('does nothing without a record', () => {
    renderLabsAt(['/education/labs']);
    expect(screen.getByText('labs page')).toBeInTheDocument();
    expect(readSignedInAt()).toBe(0);
  });

  it('does not act on a record for a lab the catalogue does not have', () => {
    markSignInStarted('no-such-lab');
    renderLabsAt(['/education/labs']);
    expect(screen.getByText('labs page')).toBeInTheDocument();
    expect(readSignedInAt()).toBe(0);
  });
});
