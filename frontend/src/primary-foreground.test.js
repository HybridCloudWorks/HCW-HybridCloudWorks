// @vitest-environment node
/**
 * Text on a solid `bg-primary` surface is `text-primary-foreground`, and that
 * pair is readable in every scope and both themes (2026-09-28).
 *
 * THE BUG. `--primary` is not one colour. On the light theme it is near-black;
 * on the dark theme it is WHITE (index.css, `.dark`); inside a provider's
 * pages (`.theme-azure` and the rest, set on the app wrapper by App.jsx) it is
 * that provider's colour on both themes. So `bg-primary text-white` is a
 * blank white box on any dark page outside a provider scope — two buttons in
 * components/labs were exactly that until #767 — and `bg-primary
 * text-foreground` is dark on dark on the light theme and white on white on
 * the dark one. The only text colour defined to read on `--primary` wherever
 * it is is `--primary-foreground`, because each scope sets the two together.
 *
 * TWO HALVES, AND THE SECOND DEPENDS ON THE FIRST.
 *   1. The tokens: in each scope and theme, `--primary-foreground` on
 *      `--primary` must meet WCAG AA for normal text (4.5:1). Before this
 *      test, two did not: AWS paired its darkened orange with black (4.31:1)
 *      and FinOps paired its green with white (3.02:1). Both were changed.
 *   2. The source: every class string in src/ that puts text on a solid
 *      `bg-primary` must use `text-primary-foreground`. With half 1 holding,
 *      that pairing is readable wherever the element happens to render.
 *
 * HOW THE SOURCE IS READ is in scripts/primary-surface-scan.mjs: the parsed
 * module rather than a grep (template branches, `cn`/`clsx` combinations,
 * every variant state, and the markup inside a primary surface), with what it
 * catches and passes in its own test. A translucent tint, `bg-primary/10`, is
 * not a primary surface: the page shows through, and the text on it is chosen
 * for the page.
 *
 * ALLOWED below takes exceptions, each with its reason. It is empty, and an
 * entry nothing matches any more fails the test, so it can only shrink.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { CANONICAL_PROVIDERS } from '@/lib/providers';
import { offencesIn } from '../scripts/primary-surface-scan.mjs';

const SRC = join(process.cwd(), 'src');

/** WCAG 2.2 AA, normal-size text. */
const AA = 4.5;

// ---------------------------------------------------------------- tokens --

/** hsl(h s% l%) as index.css writes the components, to relative luminance. */
function luminance(hsl) {
  const match = String(hsl).match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) throw new Error(`not an "h s% l%" value: ${hsl}`);
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `--primary` and `--primary-foreground` per selector, the later declaration winning. */
function primaryTokensBySelector(css) {
  const bySelector = {};
  postcss.parse(css).walkDecls(/^--primary(?:-foreground)?$/, (decl) => {
    if (decl.parent.type !== 'rule') return;
    for (const selector of decl.parent.selectors) {
      bySelector[selector.trim()] ??= {};
      bySelector[selector.trim()][decl.prop] = decl.value.trim();
    }
  });
  return bySelector;
}

/**
 * The pair each scope resolves to on each theme. `.dark` is on <html>; a
 * provider's `.theme-*` is on the app wrapper inside it, so the provider's own
 * declaration is the nearer one and wins on both themes unless a
 * `.dark .theme-*` rule sets it again.
 */
function resolvedPairs(bySelector) {
  const pick = (...selectors) => {
    const merged = {};
    for (const selector of selectors.reverse()) Object.assign(merged, bySelector[selector]);
    return [merged['--primary'], merged['--primary-foreground']];
  };
  const pairs = [
    ['site, light', pick(':root')],
    ['site, dark', pick('.dark', ':root')],
  ];
  for (const provider of CANONICAL_PROVIDERS) {
    const scope = `.theme-${provider}`;
    pairs.push([`${provider}, light`, pick(scope, ':root')]);
    pairs.push([`${provider}, dark`, pick(`.dark ${scope}`, scope, '.dark', ':root')]);
  }
  return pairs;
}

const TOKENS = primaryTokensBySelector(readFileSync(join(SRC, 'index.css'), 'utf8'));

describe('--primary-foreground on --primary', () => {
  it('reads both tokens from the site scopes and from every provider scope', () => {
    for (const selector of [':root', '.dark', ...CANONICAL_PROVIDERS.map((p) => `.theme-${p}`)]) {
      expect(Object.keys(TOKENS[selector] ?? {}).sort(), selector).toEqual([
        '--primary',
        '--primary-foreground',
      ]);
    }
  });

  it.each(resolvedPairs(TOKENS))('meets AA in the %s scope', (_, [primary, foreground]) => {
    const ratio = contrast(primary, foreground);
    expect(
      ratio,
      `--primary ${primary} / --primary-foreground ${foreground} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA);
  });

  it('computes contrast the way WCAG does', () => {
    expect(contrast('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 5);
    // rgb(0, 125, 184), the Azure scope's primary: 4.54:1 against white in Chromium.
    expect(contrast('199 100% 36%', '0 0% 100%')).toBeCloseTo(4.54, 1);
  });
});

// ---------------------------------------------------------------- source --

/**
 * Exceptions: `{ file, classes, reason }`, where `classes` is a substring of
 * the offending class string. Empty: every pairing in src/ was fixable.
 */
const ALLOWED = Object.freeze([]);

const SOURCE = /\.(?:jsx?|tsx?)$/;
const TEST = /\.(?:test|spec)\.|\.fixture\./;

function walkFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

const allowed = (file, offence) =>
  ALLOWED.some((entry) => entry.file === file && offence.classes.includes(entry.classes));

function describeOffence(file, { line, state, text }) {
  const where = state === 'base' ? '' : `${state}: `;
  return `${file}:${line} ${where}bg-primary with text-${text} (use text-primary-foreground)`;
}

describe('solid bg-primary in src/', () => {
  const files = walkFiles(SRC)
    .map((path) => relative(SRC, path).replace(/\\/g, '/'))
    .filter((file) => SOURCE.test(file) && !TEST.test(file))
    .sort();
  const offences = Object.fromEntries(
    files.map((file) => [file, offencesIn(readFileSync(join(SRC, file), 'utf8'), file)])
  );

  it('scans the whole tree, the pages that had the pairing included', () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain('components/shared/ProviderBlogPage.jsx');
    expect(files).toContain('pages/azure/EducationPage.jsx');
    expect(files).toContain('components/accessibility/AccessibleButton.tsx');
  });

  it('puts only text-primary-foreground on a solid primary surface', () => {
    const report = Object.entries(offences).flatMap(([file, list]) =>
      list.filter((offence) => !allowed(file, offence)).map((o) => describeOffence(file, o))
    );
    expect(report).toEqual([]);
  });

  it('has no allowance that nothing needs any more', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason, `${entry.file}: every allowance says why`).toMatch(/\S/);
      expect(
        (offences[entry.file] ?? []).some((offence) => offence.classes.includes(entry.classes)),
        `${entry.file} no longer pairs "${entry.classes}": remove it from ALLOWED`
      ).toBe(true);
    }
  });
});
