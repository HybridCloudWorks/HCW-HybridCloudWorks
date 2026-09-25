/**
 * A lab job type lands in three places or the gate fails (#675).
 *
 * The server allowlist (`LAB_JOB_TYPES`, functions/src/lib/labs.js) decides
 * what can be enqueued; the agent allowlist (`CAPABILITIES`,
 * vps-agent/lib/capabilities.js) decides what can run; the admin console's
 * fallback (`FALLBACK_JOB_TYPES`, frontend/src/components/admin/labs/
 * labsView.js) decides what can be picked before the first snapshot. Each
 * file says "keep in sync with the other two" in a comment, and until this
 * test nothing checked that anyone did. The three are in three packages, so
 * the check lives here with the other cross-cutting repository tests.
 *
 * The frontend module imports through the `@/` alias, which a test outside
 * the frontend's vitest config cannot resolve, so its list is read from the
 * source text: the `type:` and `payloadEncodings:` of every entry between
 * `FALLBACK_JOB_TYPES = [` and the closing `];`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { LAB_JOB_TYPES, PAYLOAD_ENCODINGS } from '../functions/src/lib/labs.js';
import { CAPABILITIES } from '../vps-agent/lib/capabilities.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const labsViewSource = readFileSync(
  path.join(here, '..', 'frontend', 'src', 'components', 'admin', 'labs', 'labsView.js'),
  'utf8'
);

function fallbackJobTypes(source) {
  const start = source.indexOf('FALLBACK_JOB_TYPES = [');
  const end = source.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const entries = {};
  for (const m of block.matchAll(/type:\s*'([^']+)'[\s\S]*?payloadEncodings:\s*\[([^\]]*)\]/g)) {
    entries[m[1]] = m[2]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
  }
  return entries;
}

describe('lab job types are declared in all three places', () => {
  const server = Object.keys(LAB_JOB_TYPES).sort();
  const agent = Object.keys(CAPABILITIES).sort();
  const console = fallbackJobTypes(labsViewSource);

  it('the server allowlist and the agent allowlist name the same types', () => {
    expect(agent).toEqual(server);
  });

  it('the admin console fallback names the same types', () => {
    expect(Object.keys(console).sort()).toEqual(server);
  });

  it('every type accepts the same payload encodings in all three', () => {
    for (const type of server) {
      const serverEncodings = [...LAB_JOB_TYPES[type].payloadEncodings].sort();
      expect(serverEncodings.length, `${type} declares no payloadEncodings on the server`).toBeGreaterThan(0);
      for (const e of serverEncodings) expect(PAYLOAD_ENCODINGS).toContain(e);
      expect([...(CAPABILITIES[type].payloadEncodings ?? ['text'])].sort(), `${type} on the agent`).toEqual(
        serverEncodings
      );
      expect([...console[type]].sort(), `${type} in the console fallback`).toEqual(serverEncodings);
    }
  });

  it('a type that accepts a text payload names the file it is written to', () => {
    for (const [type, capability] of Object.entries(CAPABILITIES)) {
      if ((capability.payloadEncodings ?? ['text']).includes('text')) {
        expect(capability.payloadFileName, `${type} accepts text but has no payloadFileName`).toBeTruthy();
      }
    }
  });
});
