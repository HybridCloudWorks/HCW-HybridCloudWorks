import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Reset the reading position on navigation — for every user, not only sighted
 * mouse users (T-740).
 *
 * Scrolling to the top moves the *viewport*. It does not move focus, so before
 * this change a keyboard or screen-reader user stayed parked on the link they
 * had just activated, in the old page's navigation, with nothing announced.
 * Every navigation left them to work out for themselves that the page had
 * changed and then tab back through the header to reach the new content. The
 * `<main id="main-content" tabIndex={-1}>` target already existed in App.jsx
 * and was simply never focused.
 *
 * Two things happen here now, and they are separate on purpose:
 *
 *  - **Focus moves to `#main-content`.** `tabIndex={-1}` makes it
 *    programmatically focusable without adding it to the tab order, which is
 *    the standard SPA route-change pattern. `preventScroll` is set because
 *    focusing an element scrolls it into view, which would fight the
 *    `scrollTo` below and land the page a few pixels off the top.
 *
 *  - **The new title is announced** through a polite live region. Focus alone
 *    is not an announcement: a screen reader reads the focused container,
 *    which is a generic landmark, so without this the user learns that
 *    something moved but not what they arrived at.
 *
 * A hash link is left alone entirely. `#section` navigation means "go to this
 * part of the page", and stealing focus to the top of `<main>` would undo
 * exactly what the user asked for.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    // In-page anchor: the browser's own behaviour is the correct one.
    if (hash) return;

    window.scrollTo(0, 0);

    const main = document.getElementById('main-content');
    if (main) main.focus({ preventScroll: true });

    // The title is set by each page's Helmet, which commits after this effect
    // on the first paint of a route. A frame's delay means the announcement
    // carries the new page's title rather than the previous one's.
    const frame = requestAnimationFrame(() => {
      const announcer = document.getElementById('route-announcer');
      if (announcer) announcer.textContent = document.title;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
