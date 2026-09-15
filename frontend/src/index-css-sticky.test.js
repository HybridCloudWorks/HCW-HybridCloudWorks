/**
 * Guards #580: the public site Header is `sticky top-0`, and it scrolled away
 * with the window while `src/index.css` gave `body` `overflow-x: hidden`.
 *
 * `html` has `overflow-y: scroll`, so body's overflow is not propagated to the
 * viewport. Any body overflow value that creates a scroll container (`hidden`,
 * `auto`, `scroll`) turns body into a box that never scrolls, and every sticky
 * descendant pins to it instead of the window. Measured in Chromium on
 * 2026-09-14: after `scrollTo(0, 2000)` the header's top was -2000 with
 * `hidden` and 0 with `clip`.
 *
 * jsdom does no layout, so this reads the stylesheet rather than rendering.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `process.cwd()` rather than `import.meta.url`: under the jsdom environment
// Vite rewrites `import.meta.url` to an http URL.
const CSS = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function bodyDeclarations() {
  const blocks = [...CSS.matchAll(/(?:^|[\s,}])body\s*\{([^}]*)\}/g)].map((m) => m[1]);
  return blocks.join(';');
}

describe('index.css keeps position: sticky working (#580)', () => {
  it('has at least one body rule to inspect', () => {
    expect(bodyDeclarations()).toMatch(/\S/);
  });

  it('gives body no overflow value that creates a scroll container', () => {
    const overflows = [...bodyDeclarations().matchAll(/overflow(?:-[xy])?\s*:\s*([^;]+)/g)].map(
      (m) => m[1].trim()
    );
    for (const value of overflows) {
      for (const keyword of value.split(/\s+/)) {
        expect(['visible', 'clip']).toContain(keyword);
      }
    }
  });

  it('still guards horizontal overflow on body with clip', () => {
    expect(bodyDeclarations()).toMatch(/overflow-x\s*:\s*clip/);
  });
});
