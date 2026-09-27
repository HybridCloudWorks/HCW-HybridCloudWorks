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
 *
 * A fourth list is the capabilities of the lab_agents registry document that
 * scripts/lab/Register-LabAgent.ps1 prints (`Get-LabJobTypes`). It decides
 * what the agent may claim once the document exists, so a type missing there
 * is a type the host never runs. PowerShell cannot be imported either, so it
 * is read from the source text the same way: the quoted names in the
 * `return [string[]]@(...)` line of that function.
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
const registerLabAgentSource = readFileSync(path.join(here, 'lab', 'Register-LabAgent.ps1'), 'utf8');

function registrationJobTypes(source) {
  const start = source.indexOf('function Get-LabJobTypes {');
  const end = source.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const list = source.slice(start, end).match(/return \[string\[\]\]@\(([^)]*)\)/);
  expect(list, 'Get-LabJobTypes has no return [string[]]@(...) line').not.toBeNull();
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

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

describe('lab job types are declared in every place that lists them', () => {
  const server = Object.keys(LAB_JOB_TYPES).sort();
  const agent = Object.keys(CAPABILITIES).sort();
  const console = fallbackJobTypes(labsViewSource);

  it('the server allowlist and the agent allowlist name the same types', () => {
    expect(agent).toEqual(server);
  });

  it('the admin console fallback names the same types', () => {
    expect(Object.keys(console).sort()).toEqual(server);
  });

  it('the registry document Register-LabAgent.ps1 prints names the same types, once each', () => {
    const registered = registrationJobTypes(registerLabAgentSource);
    expect(new Set(registered).size).toBe(registered.length);
    expect([...registered].sort()).toEqual(server);
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
