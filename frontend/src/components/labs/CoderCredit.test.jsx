/**
 * The Coder credit on `/education/labs` (owner request 2026-09-28): the link
 * to Coder's site opens a new tab safely and says so, the wordmark has an
 * accessible name and is the file in `src/assets/brands/coder/` path for
 * path, its square carries the cursor class, and the stylesheet blinks that
 * square a finite number of times and not at all under reduced motion.
 *
 * jsdom does no layout and runs no CSS animations, so the stylesheet is read
 * as text, the way index-css-sticky.test.js reads it.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CoderCredit, { CODER_URL, CoderWordmark, WORDMARK_VIEW_BOX } from './CoderCredit';

// `process.cwd()` rather than `import.meta.url`: under the jsdom environment
// Vite rewrites `import.meta.url` to an http URL.
const read = (...parts) => readFileSync(resolve(process.cwd(), 'src', ...parts), 'utf8');

/** The attributes of each path that decide what it draws. */
const PATH_ATTRIBUTES = ['d', 'fill', 'fill-rule', 'clip-rule', 'class'];
const pathFacts = (svg) =>
  [...svg.querySelectorAll('path')].map((path) =>
    Object.fromEntries(PATH_ATTRIBUTES.map((name) => [name, path.getAttribute(name)]))
  );

/**
 * The top-level blocks of a stylesheet, comments removed, as
 * `{ prelude, body }` with nested blocks left inside `body`.
 */
function blocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return found.map(({ prelude, body }) => ({
    prelude: prelude.replace(/^[\s\S]*;\s*/, '').replace(/\s+/g, ' '),
    body,
  }));
}

const selectors = (prelude) => prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
const declaration = (body, property) =>
  body.match(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`))?.[1].trim();

function renderCredit() {
  return render(<CoderCredit />);
}

describe('CoderCredit', () => {
  it("links Coder's name to its site in a new tab, safely, and says it opens one", () => {
    renderCredit();
    const link = screen.getByRole('link', { name: 'Coder (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://coder.com/');
    expect(link).toHaveAttribute('href', CODER_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel').split(/\s+/).sort()).toEqual(['noopener', 'noreferrer']);
    // What a sighted reader sees is the name alone, and the spoken name
    // starts with it (WCAG 2.5.3, label in name).
    expect(link).toHaveTextContent(/^Coder$/);
  });

  it('says the labs are provided using Coder, and never that Coder sponsors them', () => {
    renderCredit();
    const credit = screen.getByTestId('coder-credit');
    expect(credit.tagName).toBe('ASIDE');
    expect(credit).toHaveAccessibleName('How we provide these labs');
    expect(credit).toHaveTextContent(
      'We provide these browser labs using Coder, the open-source platform for self-hosted development environments. Every lab workspace is a Coder workspace built from our lab template.'
    );
    expect(credit).not.toHaveTextContent(/sponsor|partner|endorse/i);
  });

  it('shows the wordmark as an image named Coder, in the theme text colour', () => {
    renderCredit();
    const credit = screen.getByTestId('coder-credit');
    const logo = within(credit).getByRole('img', { name: 'Coder' });
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(logo).toHaveAttribute('viewBox', WORDMARK_VIEW_BOX);
    for (const path of logo.querySelectorAll('path')) {
      expect(path).toHaveAttribute('fill', 'currentColor');
    }
    expect(logo.getAttribute('class')).toMatch(/\btext-slate-950\b/);
    expect(logo.getAttribute('class')).toMatch(/\bdark:text-white\b/);
  });

  it('puts the cursor class on the square, and only on the square', () => {
    const { container } = render(<CoderWordmark />);
    const cursors = container.querySelectorAll('.coder-cursor');
    expect(cursors).toHaveLength(1);
    const paths = container.querySelectorAll('path');
    expect(cursors[0]).toBe(paths[paths.length - 1]);
    // A square: four straight edges, no curves.
    expect(cursors[0].getAttribute('d')).toMatch(/^M[\d.\s]+(?:[HV][\d.]+)+Z$/);
  });

  it('draws exactly what src/assets/brands/coder/coder-wordmark.svg draws', () => {
    const file = new DOMParser()
      .parseFromString(read('assets', 'brands', 'coder', 'coder-wordmark.svg'), 'image/svg+xml')
      .querySelector('svg');
    const { container } = render(<CoderWordmark />);
    const inline = container.querySelector('svg');

    expect(file.getAttribute('viewBox')).toBe(WORDMARK_VIEW_BOX);
    expect(inline.getAttribute('viewBox')).toBe(file.getAttribute('viewBox'));
    expect(inline.getAttribute('aria-label')).toBe(file.getAttribute('aria-label'));
    expect(pathFacts(inline)).toEqual(pathFacts(file));
    expect(pathFacts(file).map((facts) => facts.class)).toContain('coder-cursor');
  });

  it.each(['coder-wordmark.svg', 'coder-mark.svg'])(
    '%s says it is Coder’s, kept only to credit Coder',
    (file) => {
      const text = read('assets', 'brands', 'coder', file);
      expect(text).toMatch(/^<!--\s+Coder's (?:wordmark|mark), not ours/);
      expect(text).toMatch(/only to credit Coder/);
      expect(text).toMatch(/implies no sponsorship or endorsement/);
    }
  );

  it('keeps the compact mark beside it, with its square marked the same way', () => {
    const mark = new DOMParser()
      .parseFromString(read('assets', 'brands', 'coder', 'coder-mark.svg'), 'image/svg+xml')
      .querySelector('svg');
    expect(mark.getAttribute('aria-label')).toBe('Coder');
    expect(mark.querySelectorAll('path.coder-cursor')).toHaveLength(1);
    for (const path of mark.querySelectorAll('path')) {
      expect(path.getAttribute('fill')).toBe('currentColor');
    }
  });
});

describe('index.css blinks the cursor, briefly, and never under reduced motion', () => {
  const css = blocks(read('index.css'));

  /** Every top-level rule whose selector reaches the cursor and sets an animation property. */
  const animating = css.filter(
    ({ prelude, body }) =>
      !prelude.startsWith('@') && prelude.includes('.coder-cursor') && /animation/.test(body)
  );

  it('blinks the square in one-second steps', () => {
    const base = css.find(({ prelude }) => prelude === '.coder-cursor');
    expect(base, 'a top-level .coder-cursor rule').toBeDefined();
    const animation = declaration(base.body, 'animation');
    expect(animation).toMatch(/^coder-cursor-blink\b/);
    expect(animation).toMatch(/\b1s\b/);
    expect(animation).toMatch(/\bsteps\(/);

    const keyframes = css.find(({ prelude }) => prelude === '@keyframes coder-cursor-blink');
    expect(keyframes, '@keyframes coder-cursor-blink').toBeDefined();
    expect(keyframes.body).toMatch(/opacity\s*:\s*0\b/);
  });

  it('stops by itself within five seconds of loading (WCAG 2.2.2)', () => {
    const base = css.find(({ prelude }) => prelude === '.coder-cursor');
    const animation = declaration(base.body, 'animation');
    expect(animation).not.toMatch(/\binfinite\b/);
    const count = Number(animation.match(/\s(\d+)\s*$/)?.[1]);
    expect(count).toBeGreaterThan(0);
    // Each iteration is one second.
    expect(count).toBeLessThanOrEqual(5);
  });

  it('switches every rule that animates the cursor off under prefers-reduced-motion: reduce', () => {
    expect(animating.length).toBeGreaterThan(0);
    const reduced = css
      .filter(({ prelude }) => /^@media \(prefers-reduced-motion: ?reduce\)$/.test(prelude))
      .flatMap(({ body }) => blocks(body))
      .filter(({ body }) => declaration(body, 'animation') === 'none');
    const stopped = new Set(reduced.flatMap(({ prelude }) => selectors(prelude)));

    for (const { prelude } of animating) {
      for (const selector of selectors(prelude).filter((s) => s.includes('.coder-cursor'))) {
        expect(stopped, `${selector} keeps animating under reduced motion`).toContain(selector);
      }
    }
  });
});
