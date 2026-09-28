/**
 * `/education/labs/:labId` (#751): the pane opens only when the status read
 * says the workspaces are reachable; it asks for GitHub sign-in in a new tab
 * first, and opens (and later reloads) when another tab finishes it; the
 * frame loads the lab's workspace deep link with exactly the sandbox and
 * `allow` lists the page states; full screen is the pane itself; and every
 * way the workspaces can be missing reads as one sentence, never an error.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODER_APPS_ORIGIN,
  CODER_ORIGIN,
  coderSignInUrl,
  labById,
  labs,
} from '@/data/labs/catalogue';
import { SIGNED_IN_KEY, SIGN_IN_PENDING_KEY, markSignedIn } from '@/components/labs/labSignIn';

const fetchCoderStatus = vi.fn();
vi.mock('@/lib/publicApi', () => ({
  fetchCoderStatus: () => fetchCoderStatus(),
}));

import LabPanePage, {
  OPENING_SENTENCE,
  PANE_LOAD_TIMEOUT_MS,
  SIGN_IN_HEADING,
  SIGN_IN_PENDING_SENTENCE,
  UNAVAILABLE_SENTENCE,
  workspaceService,
} from './LabPanePage';

const LAB = labById('terraform-validate-walkthrough');
const REACHABLE = {
  configured: true,
  reachable: true,
  templates: [{ name: 'hcw-lab', activeVersion: 'v0.3.1' }],
  capacity: { running: 1, max: 5 },
  asOf: '2026-09-28T11:59:40.000Z',
};

/** Backend words a visitor must not read on this page, in any state. */
const BEHIND_THE_SITE = /\bcoder\b|oauth|code-server|\bvps\b|callback|caddy|hostinger|\bapi\b/i;

function renderPane(labId = LAB.id) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/education/labs/${labId}`]}>
        <Routes>
          <Route path="/education/labs/:labId" element={<LabPanePage />} />
          <Route path="/education/labs" element={<p>labs index</p>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

/** Everything on the page a visitor reads: text, and the names assistive technology reads out. */
function visibleWords(container) {
  const named = [...container.querySelectorAll('[title], [aria-label]')].map(
    (el) => `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
  );
  return [container.textContent, ...named].join(' ');
}

/**
 * Another tab of the site recording a completed sign-in, as the browser
 * delivers it here: a `storage` event with the key and value the listener
 * reads. Built on Event rather than `new StorageEvent(type, init)`, which
 * CodeQL's DOM model takes for a one-argument constructor (#758).
 */
function anotherTabSignsIn(at) {
  window.localStorage.setItem(SIGNED_IN_KEY, String(at));
  const event = Object.assign(new Event('storage'), {
    key: SIGNED_IN_KEY,
    newValue: String(at),
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

/** Let React run the effects of a commit that arrived outside `act` (the status read resolving). */
async function flushEffects() {
  await act(async () => {});
}

/** jsdom would try to follow a target=_blank link; the page's own click handler is what is tested. */
const preventNavigation = (event) => {
  if (event.target.closest?.('a[target="_blank"]')) event.preventDefault();
};

beforeEach(() => {
  window.localStorage.clear();
  fetchCoderStatus.mockReset();
  window.addEventListener('click', preventNavigation);
});

afterEach(() => {
  window.removeEventListener('click', preventNavigation);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('workspaceService', () => {
  it.each([
    [{ data: null, loading: true, error: null }, 'checking'],
    [{ data: REACHABLE, loading: false, error: null }, 'available'],
    [{ data: { ...REACHABLE, reachable: false }, loading: false, error: null }, 'unavailable'],
    [{ data: { configured: false }, loading: false, error: null }, 'unavailable'],
    [{ data: null, loading: false, error: null }, 'unavailable'],
    [{ data: null, loading: false, error: new Error('x') }, 'unavailable'],
  ])('%j is %s', (query, expected) => {
    expect(workspaceService(query)).toBe(expected);
  });
});

describe('LabPanePage before the pane', () => {
  it('says it is opening while the status read is in flight, and shows no frame', () => {
    fetchCoderStatus.mockReturnValue(new Promise(() => {}));
    const { container } = renderPane();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LAB.title);
    expect(screen.getByTestId('lab-opening')).toHaveTextContent(OPENING_SENTENCE);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it.each([
    ['not configured', () => fetchCoderStatus.mockResolvedValue({ configured: false })],
    [
      'unreachable',
      () => fetchCoderStatus.mockResolvedValue({ ...REACHABLE, reachable: false, templates: [] }),
    ],
    ['a missing route', () => fetchCoderStatus.mockResolvedValue(null)],
    [
      'a failed read',
      () =>
        fetchCoderStatus.mockRejectedValue(
          new Error('coder-status answered HTTP 503 from https://coder.lab.hybridcloudworks.com')
        ),
    ],
  ])('shows one sentence, and never the error, for %s', async (_label, arrange) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    arrange();
    markSignedIn();
    const { container } = renderPane();
    const unavailable = await screen.findByTestId('lab-unavailable');
    expect(unavailable).toHaveTextContent(UNAVAILABLE_SENTENCE);
    expect(within(unavailable).getByRole('link', { name: 'Back to labs' })).toHaveAttribute(
      'href',
      '/education/labs'
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).not.toMatch(/HTTP|503|coder-status/);
    expect(visibleWords(container)).not.toMatch(BEHIND_THE_SITE);
  });
});

describe('LabPanePage sign-in', () => {
  beforeEach(() => {
    fetchCoderStatus.mockResolvedValue(REACHABLE);
  });

  it('asks for GitHub sign-in in a new tab before showing the pane', async () => {
    const { container } = renderPane();
    const step = await screen.findByTestId('lab-sign-in');
    expect(within(step).getByRole('heading', { level: 2 })).toHaveTextContent(SIGN_IN_HEADING);
    const link = within(step).getByTestId('lab-sign-in-link');
    expect(link).toHaveAccessibleName('Sign in with GitHub (opens in a new tab)');
    expect(link).toHaveAttribute('href', coderSignInUrl());
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel').split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    expect(container.querySelector('iframe')).toBeNull();
    expect(visibleWords(container)).not.toMatch(BEHIND_THE_SITE);
  });

  it('records which lab the sign-in started from, and says to finish it in the new tab', async () => {
    renderPane();
    fireEvent.click(await screen.findByTestId('lab-sign-in-link'));
    expect(JSON.parse(window.localStorage.getItem(SIGN_IN_PENDING_KEY))).toMatchObject({
      labId: LAB.id,
    });
    expect(screen.getByText(SIGN_IN_PENDING_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByTitle(/lab workspace/i)).toBeNull();
  });

  it('opens the pane when another tab finishes sign-in, and reloads it on the next one', async () => {
    const { container } = renderPane();
    fireEvent.click(await screen.findByTestId('lab-sign-in-link'));

    anotherTabSignsIn(Date.now() - 5000);
    const first = container.querySelector('iframe');
    expect(first).not.toBeNull();
    expect(screen.queryByTestId('lab-sign-in')).toBeNull();

    // A session that expired is signed in again from the toolbar; the frame
    // that comes back is a new one, which is the reload.
    anotherTabSignsIn(Date.now());
    const second = container.querySelector('iframe');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it('opens the pane at once for a visitor who is already signed in', async () => {
    const { container } = renderPane();
    fireEvent.click(await screen.findByRole('button', { name: /already signed in/i }));
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(Number(window.localStorage.getItem(SIGNED_IN_KEY))).toBeGreaterThan(0);
  });
});

describe('LabPanePage, the pane', () => {
  beforeEach(() => {
    fetchCoderStatus.mockResolvedValue(REACHABLE);
    markSignedIn();
  });

  it('loads the lab’s workspace deep link, titled for the lab', async () => {
    renderPane();
    await screen.findByTestId('lab-pane');
    const frame = screen.getByTitle(`Lab workspace: ${LAB.title}`);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe(
      'https://coder.lab.hybridcloudworks.com/templates/hcw-lab/workspace?mode=auto&param.lab=terraform-validate-walkthrough'
    );
  });

  it.each(labs.map((lab) => [lab.id]))('gives %s its own workspace parameter', async (id) => {
    renderPane(id);
    await screen.findByTestId('lab-pane');
    const frame = document.querySelector('iframe');
    expect(new URL(frame.src).searchParams.get('param.lab')).toBe(id);
    expect(new URL(frame.src).origin).toBe(CODER_ORIGIN);
  });

  it('sandboxes the frame to scripts, its own origin, forms and popups, and nothing more', async () => {
    renderPane();
    await screen.findByTestId('lab-pane');
    const sandbox = document.querySelector('iframe').getAttribute('sandbox').split(/\s+/);
    expect([...sandbox].sort()).toEqual([
      'allow-forms',
      'allow-popups',
      'allow-same-origin',
      'allow-scripts',
    ]);
  });

  it('allows clipboard read and write and fullscreen, to Coder and its apps only', async () => {
    renderPane();
    await screen.findByTestId('lab-pane');
    const allow = document.querySelector('iframe').getAttribute('allow');
    const features = Object.fromEntries(
      allow.split(';').map((entry) => {
        const [feature, ...origins] = entry.trim().split(/\s+/);
        return [feature, origins];
      })
    );
    expect(Object.keys(features).sort()).toEqual([
      'clipboard-read',
      'clipboard-write',
      'fullscreen',
    ]);
    for (const origins of Object.values(features)) {
      expect(origins).toEqual([CODER_ORIGIN, CODER_APPS_ORIGIN]);
    }
    expect(document.querySelector('iframe').hasAttribute('allowfullscreen')).toBe(false);
  });

  it('keeps sign-in and the way back on the toolbar', async () => {
    renderPane();
    const pane = await screen.findByTestId('lab-pane');
    const signIn = within(pane).getByRole('link', { name: /sign in with github/i });
    expect(signIn).toHaveAttribute('href', coderSignInUrl());
    expect(signIn).toHaveAttribute('target', '_blank');
    expect(within(pane).getByRole('link', { name: 'Back to labs' })).toHaveAttribute(
      'href',
      '/education/labs'
    );
    expect(visibleWords(document.body)).not.toMatch(BEHIND_THE_SITE);
  });

  it('shows no full-screen button where the browser cannot do it', async () => {
    renderPane();
    await screen.findByTestId('lab-pane');
    expect(screen.queryByRole('button', { name: /full screen/i })).toBeNull();
  });

  describe('full screen', () => {
    let requestFullscreen;
    let exitFullscreen;
    beforeEach(() => {
      requestFullscreen = vi.fn(() => Promise.resolve());
      exitFullscreen = vi.fn(() => Promise.resolve());
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      });
      Element.prototype.requestFullscreen = requestFullscreen;
    });
    afterEach(() => {
      delete document.fullscreenEnabled;
      delete document.fullscreenElement;
      delete document.exitFullscreen;
      delete Element.prototype.requestFullscreen;
    });

    it('makes the pane itself full screen, and never opens a window', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      renderPane();
      const pane = await screen.findByTestId('lab-pane');
      fireEvent.click(screen.getByRole('button', { name: 'Open full screen' }));
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      expect(requestFullscreen.mock.contexts[0]).toBe(pane);
      expect(open).not.toHaveBeenCalled();

      document.fullscreenElement = pane;
      act(() => {
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
    });
  });

  it('says the workspaces are unavailable when the frame has not loaded in time, and not once it has', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, unmount } = renderPane();
    await screen.findByTestId('lab-pane');
    // The frame can be in the DOM before its effects have run; the watchdog
    // is set in one, so let it run before moving the clock.
    await flushEffects();
    act(() => {
      vi.advanceTimersByTime(PANE_LOAD_TIMEOUT_MS + 1);
    });
    expect(screen.getByTestId('lab-unavailable')).toHaveTextContent(UNAVAILABLE_SENTENCE);
    expect(container.querySelector('iframe')).toBeNull();
    unmount();

    const again = renderPane();
    await screen.findByTestId('lab-pane');
    await flushEffects();
    fireEvent.load(again.container.querySelector('iframe'));
    act(() => {
      vi.advanceTimersByTime(PANE_LOAD_TIMEOUT_MS * 2);
    });
    expect(screen.queryByTestId('lab-unavailable')).toBeNull();
    expect(again.container.querySelector('iframe')).not.toBeNull();
  });
});

describe('LabPanePage routing', () => {
  it('sends an id the catalogue does not have back to the labs page', () => {
    fetchCoderStatus.mockResolvedValue(REACHABLE);
    renderPane('no-such-lab');
    expect(screen.getByText('labs index')).toBeInTheDocument();
    expect(fetchCoderStatus).not.toHaveBeenCalled();
  });
});
