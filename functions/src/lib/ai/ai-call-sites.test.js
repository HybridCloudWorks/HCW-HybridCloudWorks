/**
 * Every AI call site declares which feature it belongs to — enforced here.
 *
 * WHY A TEST AND NOT A RUNTIME CHECK. The router treats a call with no
 * `feature` as ungated, and it has to: a missing declaration must not take a
 * working feature offline in production, and throwing on an unknown feature
 * name would turn a typo into an outage. Failing open at runtime is the safe
 * direction — but on its own it means a new call site silently escapes the
 * portal's switches, and nobody finds out until someone turns a toggle off and
 * the model keeps being called.
 *
 * So the check lives where being strict is free. A call site added without a
 * feature fails here, before it can merge. This is the same shape as
 * `route-inventory.test.js`: derive the property from the real source rather
 * than from a list someone has to remember to update.
 *
 * This is deliberately a source scan and not a mocked-call assertion. What is
 * being guarded is that no call site is MISSED, and a test built from the call
 * sites it already knows about cannot notice a new one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_NAMES } from './ai-config.js';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const ROUTER = join(SRC, 'lib', 'ai', 'router.js');

/** The two entry points that actually reach a model. */
const CALLS = ['generateJsonResponse', 'generateTextResponse'];

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.js') && !entry.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

/** The argument text of `name(` starting at `from`, by paren balance. */
function argumentsAt(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  return '';
}

/**
 * Call sites of the two generate functions, excluding the router's own
 * definitions and its internal repair round trip.
 */
function collectCallSites() {
  const sites = [];
  for (const file of sourceFiles(SRC)) {
    if (file === ROUTER) continue;
    const text = readFileSync(file, 'utf8');
    for (const name of CALLS) {
      // `ai.generateJsonResponse(` or a destructured `generateJsonResponse(`,
      // but not `generateJsonResponse,` in an import or a doc comment.
      const pattern = new RegExp(`(?:\\bai\\.)?\\b${name}\\s*\\(`, 'g');
      for (const match of text.matchAll(pattern)) {
        const open = match.index + match[0].length - 1;
        sites.push({
          file: relative(SRC, file).replace(/\\/g, '/'),
          line: text.slice(0, match.index).split('\n').length,
          name,
          args: argumentsAt(text, open),
        });
      }
    }
  }
  return sites;
}

const SITES = collectCallSites();

describe('AI call sites', () => {
  it('finds the call sites at all — a scan that matches nothing proves nothing', () => {
    // Without this, a rename of the generate functions would make every
    // assertion below vacuously true and the guard would quietly stop working.
    expect(SITES.length).toBeGreaterThanOrEqual(6);
  });

  it('every call site declares a feature', () => {
    const undeclared = SITES.filter((s) => !/\bfeature\s*[:,]/.test(s.args)).map(
      (s) => `${s.file}:${s.line} ${s.name}()`
    );
    expect(
      undeclared,
      'These calls reach a model but are not covered by any portal toggle. Add `feature: ' +
        "'<one of " +
        FEATURE_NAMES.join(', ') +
        ">'` to each, or add a new entry to AI_FEATURES if none fits."
    ).toEqual([]);
  });

  it('every declared feature exists in the catalogue', () => {
    const bad = [];
    for (const site of SITES) {
      const declared = site.args.match(/\bfeature\s*:\s*'([^']+)'/);
      if (declared && !FEATURE_NAMES.includes(declared[1])) {
        bad.push(`${site.file}:${site.line} declares unknown feature '${declared[1]}'`);
      }
    }
    // A typo here fails open at runtime — the feature is simply never disabled
    // — so this is the only place it gets caught.
    expect(bad).toEqual([]);
  });

  it('every catalogue entry has at least one call site', () => {
    // A toggle for something that cannot happen is worse than no toggle: it
    // reads as a working switch and does nothing.
    const declared = new Set(
      SITES.map((s) => s.args.match(/\bfeature\s*:\s*'([^']+)'/)?.[1]).filter(Boolean)
    );
    const orphans = FEATURE_NAMES.filter((name) => !declared.has(name));
    expect(orphans, 'AI_FEATURES entries with no call site — the toggle would do nothing').toEqual(
      []
    );
  });
});
