/**
 * The clobbering case is the reason this module exists, so it is asserted
 * directly rather than through the components that call it.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, USER_CONTENT_PREFIX } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('still does the ordinary job: scripts and handlers do not survive', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
  });

  // THE FINDING. DOMPurify's defaults strip an injected <script id="…"> but
  // keep an injected <div id="…">, and getElementById returns the first
  // element with that id of ANY tag. An article body renders inside the app's
  // own markup, so an author could answer a lookup the application makes.
  it('an author cannot claim an id the application looks up', () => {
    const out = sanitizeHtml('<div id="__PRERENDER_DATA__">{"seed":"theirs"}</div>');
    expect(out).not.toContain('id="__PRERENDER_DATA__"');
    expect(out).toContain(`id="${USER_CONTENT_PREFIX}__PRERENDER_DATA__"`);
  });

  it('covers name as well as id, which clobbers through document.forms', () => {
    expect(sanitizeHtml('<form name="root"></form>')).toContain(
      `name="${USER_CONTENT_PREFIX}root"`
    );
  });

  // The reason this is a prefix and not a ban: prefixing the id alone would
  // silently break every in-page anchor in a hand-written HTML body.
  it('keeps in-page anchors working by rewriting both sides', () => {
    const out = sanitizeHtml('<h2 id="intro">Intro</h2><a href="#intro">jump</a>');
    expect(out).toContain(`id="${USER_CONTENT_PREFIX}intro"`);
    expect(out).toContain(`href="#${USER_CONTENT_PREFIX}intro"`);
  });

  it('leaves a bare # and an external fragment alone', () => {
    const out = sanitizeHtml('<a href="#">top</a><a href="https://x.test/page#frag">ext</a>');
    expect(out).toContain('href="#"');
    expect(out).toContain('href="https://x.test/page#frag"');
  });

  // The hook is added once and runs per node; sanitizing twice must not
  // produce '#user-content-user-content-intro'.
  it('does not double-prefix across repeated calls', () => {
    sanitizeHtml('<a href="#intro">a</a>');
    const twice = sanitizeHtml(sanitizeHtml('<h2 id="intro">I</h2><a href="#intro">a</a>'));
    expect(twice).not.toContain(`${USER_CONTENT_PREFIX}${USER_CONTENT_PREFIX}`);
  });

  it('renders an absent body as empty rather than as the word null', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });
});
