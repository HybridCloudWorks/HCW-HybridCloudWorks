/**
 * Guards the cascade contract in src/index.css: element defaults live in
 * `@layer base`, never unlayered (#1020).
 *
 * Tailwind 4 puts every utility in `@layer utilities`, and a rule outside any
 * layer beats every layered rule whatever its specificity. While `p`,
 * `h1`-`h6`, `body` and `header`/`footer` sat unlayered, no `mb-*`,
 * `leading-*` or `text-xs` line height could change a paragraph, and no
 * `text-*` colour or `font-*` weight a heading, anywhere on the site. The
 * defaults moved into `@layer base`; one unlayered element rule added later
 * would bring the whole failure back for that element, and nothing on the
 * page would look broken in review.
 *
 * jsdom does no layout and resolves no cascade layers, so this reads the
 * stylesheet's structure, as index-css-sticky.test.js does: every rule with
 * the at-rules that enclose it.
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

/** The element-type defaults the contract is about. */
const ELEMENTS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'header', 'footer']);

/** A selector list split on its own commas, not those inside `:is(...)` or `:where(...)`. */
function splitSelectors(list) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** Every style rule as `{ selectors, context }`, context being the enclosing at-rule preludes, outermost first. */
function styleRules(css) {
  const rules = [];
  const stack = [];
  let prelude = '';
  for (const ch of css) {
    if (ch === '{') {
      const head = prelude.trim().replace(/\s+/g, ' ');
      if (!head.startsWith('@')) {
        rules.push({
          selectors: splitSelectors(head),
          context: stack.filter((entry) => entry.startsWith('@')),
        });
      }
      stack.push(head);
      prelude = '';
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return rules;
}

const RULES = styleRules(CSS);
const inBaseLayer = (rule) => rule.context.some((entry) => /^@layer base$/.test(entry));
const inAnyLayer = (rule) => rule.context.some((entry) => entry.startsWith('@layer'));
const namesBareElement = (rule) => rule.selectors.some((selector) => ELEMENTS.has(selector));

describe('index.css keeps element defaults in @layer base (#1020)', () => {
  it('reads the stylesheet as rules with their enclosing at-rules', () => {
    expect(RULES.length).toBeGreaterThan(50);
    expect(RULES.some((rule) => rule.context.length > 0)).toBe(true);
  });

  it('has no unlayered rule for p, h1-h6, body, header or footer, at the top level or in a media query', () => {
    const unlayered = RULES.filter((rule) => namesBareElement(rule) && !inAnyLayer(rule)).map(
      (rule) => `${rule.context.concat(rule.selectors.join(', ')).join(' > ')}`
    );
    expect(unlayered).toEqual([]);
  });

  it('keeps each of those defaults in the base layer, not another one', () => {
    const misplaced = RULES.filter(
      (rule) => namesBareElement(rule) && inAnyLayer(rule) && !inBaseLayer(rule)
    );
    expect(misplaced.map((rule) => rule.selectors.join(', '))).toEqual([]);
    for (const element of ['p', 'h1', 'h6', 'body', 'header', 'footer']) {
      expect(
        RULES.some((rule) => inBaseLayer(rule) && rule.selectors.includes(element)),
        `${element} has no default in @layer base`
      ).toBe(true);
    }
  });

  it('leaves the provider-theme overrides unlayered on purpose, so a themed page still gets them (#174)', () => {
    const themed = RULES.filter(
      (rule) =>
        !inAnyLayer(rule) &&
        rule.selectors.some((selector) =>
          /^:is\(\s*\.theme-[^)]*\)\s+(header|footer)$/.test(selector)
        )
    );
    expect(themed.length).toBeGreaterThan(0);
  });

  it('would catch the regression it guards: an unlayered paragraph rule', () => {
    const regressed = styleRules(
      `${CSS}\np { margin-bottom: 1rem; }\n@media (min-width: 1px) { h2 { color: red; } }`
    );
    const unlayered = regressed.filter((rule) => namesBareElement(rule) && !inAnyLayer(rule));
    expect(unlayered.map((rule) => rule.selectors.join(', '))).toEqual(['p', 'h2']);
  });
});
