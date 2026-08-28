/**
 * The timer catalogue and its validation allowlist must agree (T-751).
 *
 * The eighteen timer flag suffixes are written twice by hand: once in
 * `local.timer_catalogue` (infra/main.tf), which decides which
 * FEATURE_FLAG_* settings the Function App receives, and once in the
 * `enabled_timers` validation list (infra/variables.tf), which decides which
 * names an operator is allowed to pass.
 *
 * Adding a timer to the catalogue without adding it to the validation makes it
 * IMPOSSIBLE TO ARM: the variable rejects the name, and the failure looks like
 * a typo in the cutover procedure rather than a missing entry. That is
 * adjacent to the exact class of mistake the validation was written to prevent
 * — its own comment says "a typo here is indistinguishable from a timer that
 * does not fire, which is the single most expensive way to be wrong during a
 * cutover window."
 *
 * The reverse drift is quieter: a name allowed by the validation but absent
 * from the catalogue is accepted, sets nothing, and reports success.
 *
 * `route-inventory.test.js` already covers code against catalogue. This covers
 * catalogue against validation, which was the remaining unguarded edge.
 *
 * Read as text, like cors-platform-origins.test.js: this has to fail in CI, on
 * a checkout, with no Azure credentials and no Terraform binary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFRA = join(fileURLToPath(new URL('../../..', import.meta.url)), 'infra');

/** Flag suffixes declared in `local.timer_catalogue` in main.tf. */
function catalogueSuffixes() {
  const source = readFileSync(join(INFRA, 'main.tf'), 'utf8');
  const block = /timer_catalogue\s*=\s*\{([\s\S]*?)\n  \}/.exec(source);
  expect(block, 'local.timer_catalogue not found in infra/main.tf').not.toBeNull();
  // Keys are bare identifiers at the start of a line inside the map.
  return [...block[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
}

/** Names accepted by the `enabled_timers` validation in variables.tf. */
function validationSuffixes() {
  const source = readFileSync(join(INFRA, 'variables.tf'), 'utf8');
  const from = source.indexOf('variable "enabled_timers"');
  expect(from, 'variable "enabled_timers" not found').toBeGreaterThan(-1);
  // The validation's contains([...]) list, taken from within this variable
  // block only so a later variable cannot contribute names.
  const blockEnd = source.indexOf('\nvariable "', from + 1);
  const block = source.slice(from, blockEnd === -1 ? undefined : blockEnd);
  const list = /contains\(\s*\[([\s\S]*?)\]/.exec(block);
  expect(list, 'no contains([...]) allowlist in the enabled_timers validation').not.toBeNull();
  return [...list[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

describe('timer catalogue / enabled_timers validation', () => {
  it('both lists are non-empty — a silent parse failure would pass every other check', () => {
    expect(catalogueSuffixes().length).toBeGreaterThan(0);
    expect(validationSuffixes().length).toBeGreaterThan(0);
  });

  it('every catalogued timer can actually be armed', () => {
    const allowed = new Set(validationSuffixes());
    const unarmable = catalogueSuffixes().filter((name) => !allowed.has(name));
    expect(
      unarmable,
      'in local.timer_catalogue but rejected by the enabled_timers validation — these timers cannot be turned on'
    ).toEqual([]);
  });

  it('the validation allows no name the catalogue does not define', () => {
    const catalogue = new Set(catalogueSuffixes());
    const phantom = validationSuffixes().filter((name) => !catalogue.has(name));
    expect(
      phantom,
      'accepted by the validation but absent from local.timer_catalogue — arming one would set nothing and report success'
    ).toEqual([]);
  });
});
