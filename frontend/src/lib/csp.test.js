/**
 * The Content-Security-Policy shipped with the static site.
 *
 * A CSP is only a control if it says no to something. This one had drifted into
 * saying yes to the entire Firebase/GCP surface long after the last Firebase
 * import was deleted, while omitting the one origin admin sign-in cannot work
 * without (TODO.md T-404). Both halves are asserted here, because neither
 * shows up in a build, a lint, or any test that renders a component — a CSP
 * failure appears in a browser console on a deployed site and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(join(process.cwd(), 'staticwebapp.config.json'), 'utf8'));
const CSP = config.globalHeaders['Content-Security-Policy'];

/** Everything allowed for one directive. */
const directive = (name) => {
  const match = CSP.split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return match ? match.slice(name.length).trim().split(/\s+/).filter(Boolean) : [];
};

describe('Content-Security-Policy', () => {
  it('grants nothing to Firebase or Google Cloud where code could reach it', () => {
    // Zero Firebase imports remain in the bundle. Every one of these was a
    // standing permission for an origin the app cannot reach any more.
    //
    // Scoped to the three directives that grant *code* a destination. A
    // blanket check over the whole policy is wrong here and this test caught
    // that: `fonts.googleapis.com` is a Google origin the site genuinely uses,
    // for the Material Symbols stylesheet `index.html` loads.
    const reachable = [
      ...directive('connect-src'),
      ...directive('script-src'),
      ...directive('frame-src'),
    ].join(' ');

    for (const dead of [
      'firebaseio.com',
      'cloudfunctions.net',
      'run.app',
      'firebaseapp.com',
      'apis.google.com',
      'accounts.google.com',
      'googletagmanager.com',
      // The Firebase-era wildcard. `fonts.googleapis.com` in style-src is a
      // different, live thing — hence the exact-suffix match.
      '*.googleapis.com',
    ]) {
      expect(reachable).not.toContain(dead);
    }
  });

  it('keeps the font origins index.html actually loads', () => {
    // Removing these breaks the Material Symbols icon font site-wide, which is
    // exactly the kind of silent regression a CSP cleanup invites.
    expect(directive('style-src')).toContain('https://fonts.googleapis.com');
    expect(directive('font-src')).toContain('https://fonts.gstatic.com');
  });

  it('grants nothing to Cosmos DB', () => {
    // The standing constraint: the browser must never hold a Cosmos data-plane
    // client or key. `*.documents.azure.com` in connect-src contradicted it.
    expect(CSP).not.toContain('documents.azure.com');
  });

  it('permits the Entra endpoints MSAL actually uses', () => {
    // Absent from both directives before this. Admin sign-in cannot complete
    // without the first, and silent token renewal — a hidden iframe against
    // the same authority — cannot work without the second.
    expect(directive('connect-src')).toContain('https://login.microsoftonline.com');
    expect(directive('frame-src')).toContain('https://login.microsoftonline.com');
  });

  it('permits the API in both deployment topologies', () => {
    // `'self'` covers a same-origin `/api` base; the wildcard covers the
    // cross-origin one. The second can be dropped once REVIEW.md §0.1 settles
    // on same-origin — not before.
    const connect = directive('connect-src');
    expect(connect).toContain("'self'");
    expect(connect).toContain('https://*.azurewebsites.net');
  });

  it('keeps the third-party origins the app still calls', () => {
    // CustomSessionizeWidget and SpeakingEventsPage fetch both of these.
    const connect = directive('connect-src');
    expect(connect).toContain('https://sessionize.com');
    expect(connect).toContain('https://nominatim.openstreetmap.org');
  });

  it('still refuses framing and defaults closed', () => {
    expect(directive('default-src')).toEqual(["'self'"]);
    expect(directive('frame-ancestors')).toEqual(["'none'"]);
  });

  it('allows no inline or eval script', () => {
    const script = directive('script-src');
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });
});
