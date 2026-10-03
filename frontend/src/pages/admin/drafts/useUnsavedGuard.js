/**
 * Warn before leaving the Drafts page with unsaved changes.
 *
 * Two exits, two guards:
 *   - Closing the tab, reloading, or typing another address: `beforeunload`,
 *     which shows the browser's own prompt.
 *   - Following a link inside the app (the admin sidebar, a "Review" link):
 *     the app is mounted under `BrowserRouter`, not a data router, so
 *     react-router's `useBlocker` is unavailable. A capture-phase click
 *     listener on the document runs before React's own listeners on the root
 *     element, so cancelling there stops the router from ever seeing the
 *     click. Only plain left clicks on same-origin links are asked about; a
 *     new-tab click leaves this tab, and its edits, where they are.
 *
 * Switching drafts inside the page is the page's own confirm, not this.
 */
import { useEffect } from 'react';

export const UNSAVED_MESSAGE = 'This draft has unsaved changes. Leave without saving them?';

function isInAppNavigation(event) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
    return null;
  }
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const here = window.location;
    if (url.pathname === here.pathname && url.search === here.search) return null;
    return anchor;
  } catch {
    return null;
  }
}

const browserConfirm = (message) => window.confirm(message);

export function useUnsavedGuard(dirty, { confirm = browserConfirm } = {}) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      // Required by some browsers for the prompt to appear at all.
      event.returnValue = UNSAVED_MESSAGE;
      return UNSAVED_MESSAGE;
    };
    const onClick = (event) => {
      if (!isInAppNavigation(event)) return;
      if (confirm(UNSAVED_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm]);
}
