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
import { AI_TASKS, isMediaTask } from './tasks.js';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const ROUTER = join(SRC, 'lib', 'ai', 'router.js');

/** The three entry points that actually reach a text model. */
const CALLS = ['generateJsonResponse', 'generateTextResponse', 'generateGroundedJsonResponse'];

/**
 * The one door the audio and image call sites use (ADR 0034 slice 5, #860):
 * `modelForTask({ task })` resolves the task's model through the same
 * document and switches as a text call, and the task is named where a text
 * site names its feature. Scanned with the same regex, on `task:` instead
 * of `feature:`.
 */
const MEDIA_CALLS = ['modelForTask'];

/**
 * Catalogue entries whose call site is a later slice of a named issue.
 *
 * The orphan check below exists so a toggle never reads as a working switch
 * for something that cannot happen. An entry listed here is that, knowingly
 * and briefly: a feature that landed with the router change that makes it
 * possible, whose call site is the next PR. The exception is checked in both
 * directions — the feature must exist AND must still have no call site — so
 * it cannot outlive the slice that removes the need for it. Empty since
 * `sourceGrounding` gained its call site (#433 slice 2,
 * listen-and-learn/script.js); the mechanism stays for the next split issue.
 */
const PENDING_CALL_SITES = Object.freeze({});

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
    for (const name of [...CALLS, ...MEDIA_CALLS]) {
      // `ai.generateJsonResponse(` or a destructured `generateJsonResponse(`,
      // but not `generateJsonResponse,` in an import or a doc comment.
      const pattern = new RegExp(`(?:\\bai\\.)?\\b${name}\\s*\\(`, 'g');
      for (const match of text.matchAll(pattern)) {
        const open = match.index + match[0].length - 1;
        sites.push({
          file: relative(SRC, file).replace(/\\/g, '/'),
          line: text.slice(0, match.index).split('\n').length,
          name,
          // The word a site names its work by: `feature:` for a text call,
          // `task:` for a media one. Both name an AI_FEATURES id.
          key: MEDIA_CALLS.includes(name) ? 'task' : 'feature',
          args: argumentsAt(text, open),
        });
      }
    }
  }
  return sites;
}

const SITES = collectCallSites();

/** The feature a site declares, by its own key word, or undefined. */
const declaredBy = (site) => site.args.match(new RegExp(`\\b${site.key}\\s*:\\s*'([^']+)'`))?.[1];

describe('AI call sites', () => {
  it('finds the call sites at all — a scan that matches nothing proves nothing', () => {
    // Without this, a rename of the generate functions would make every
    // assertion below vacuously true and the guard would quietly stop working.
    expect(SITES.filter((s) => s.key === 'feature').length).toBeGreaterThanOrEqual(6);
    // The four media call sites (slice 5): Listen & Learn speech, the
    // podcast voice, the cover art and the manual images.
    expect(SITES.filter((s) => s.key === 'task').length).toBeGreaterThanOrEqual(4);
  });

  it('every call site declares a feature (a media site names its task)', () => {
    const undeclared = SITES.filter((s) => !new RegExp(`\\b${s.key}\\s*[:,]`).test(s.args)).map(
      (s) => `${s.file}:${s.line} ${s.name}()`
    );
    expect(
      undeclared,
      'These calls reach a model but are not covered by any portal toggle. Add `feature: ' +
        "'<one of " +
        FEATURE_NAMES.join(', ') +
        ">'` (or `task:` on modelForTask) to each, or add a new entry to AI_TASKS if none fits."
    ).toEqual([]);
  });

  it('every declared feature exists in the catalogue', () => {
    const bad = [];
    for (const site of SITES) {
      const declared = declaredBy(site);
      if (declared && !FEATURE_NAMES.includes(declared)) {
        bad.push(`${site.file}:${site.line} declares unknown ${site.key} '${declared}'`);
      }
    }
    // A typo here fails open at runtime — the feature is simply never disabled
    // — so this is the only place it gets caught.
    expect(bad).toEqual([]);
  });

  it('every catalogue entry has at least one call site', () => {
    // A toggle for something that cannot happen is worse than no toggle: it
    // reads as a working switch and does nothing.
    const declared = new Set(SITES.map(declaredBy).filter(Boolean));
    const pending = Object.keys(PENDING_CALL_SITES);
    const orphans = FEATURE_NAMES.filter((name) => !declared.has(name) && !pending.includes(name));
    expect(orphans, 'AI_FEATURES entries with no call site — the toggle would do nothing').toEqual(
      []
    );
  });

  it('a media task is named only through modelForTask, and a text feature never is', () => {
    // The door matches the work: a voice resolved through generateTextResponse
    // would reach a chat model, and a draft resolved through modelForTask
    // would never be called.
    for (const site of SITES) {
      const declared = declaredBy(site);
      if (!declared) continue;
      expect(isMediaTask(AI_TASKS[declared]), `${site.file}:${site.line} ${site.name}() names ${declared}`).toBe(
        site.key === 'task'
      );
    }
  });

  it('a pending exception names a real feature that really has no call site yet', () => {
    // Two ways for the exception to go stale, both caught: the feature was
    // renamed or removed (the exception names nothing), or its call site landed
    // (the exception is now hiding nothing and must be deleted with the slice).
    for (const [name, why] of Object.entries(PENDING_CALL_SITES)) {
      expect(FEATURE_NAMES, `${name} is exempted but is not in AI_FEATURES`).toContain(name);
      const declared = SITES.some((s) => declaredBy(s) === name);
      expect(
        declared,
        `${name} now has a call site (${why}); remove it from PENDING_CALL_SITES`
      ).toBe(false);
    }
  });
});
