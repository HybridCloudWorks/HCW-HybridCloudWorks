/**
 * The applied-commit record the heartbeat carries (#1009, LAB-4 #950).
 *
 * What matters: the agent sends exactly the three fields the site reads, or
 * nothing at all, and a missing or mangled file never stops a heartbeat. The
 * path is pinned to the one the playbook writes, so the two cannot drift
 * apart silently.
 *
 * Node's built-in test runner, like the rest of this package.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  APPLIED_COMMIT_FILE,
  MAX_RECORD_BYTES,
  parseAppliedCommit,
  readAppliedCommit,
} from './applied-commit.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RECORD = {
  commit: SHA,
  committedAt: '2026-10-09T23:02:14-05:00',
  appliedAt: '2026-10-10T04:31:07Z',
};

describe('parseAppliedCommit', () => {
  it('reads the three fields the playbook writes', () => {
    assert.deepEqual(parseAppliedCommit(JSON.stringify(RECORD)), RECORD);
  });

  it('drops any other key rather than passing it on', () => {
    const parsed = parseAppliedCommit(JSON.stringify({ ...RECORD, token: 'nope', host: 'x' }));
    assert.deepEqual(Object.keys(parsed).sort(), ['appliedAt', 'commit', 'committedAt']);
  });

  it('refuses a short, upper-case or non-hex commit', () => {
    for (const commit of [SHA.slice(0, 12), SHA.toUpperCase(), `${SHA.slice(0, 39)}g`, 42, null]) {
      assert.equal(parseAppliedCommit(JSON.stringify({ ...RECORD, commit })), null, String(commit));
    }
  });

  it('refuses a date that is not an ISO date-time with seconds and a zone', () => {
    for (const bad of ['2026-10-10', '2026-10-10T04:31Z', '2026-10-10T04:31:07', 'yesterday', 1760000000]) {
      assert.equal(parseAppliedCommit(JSON.stringify({ ...RECORD, appliedAt: bad })), null, String(bad));
      assert.equal(parseAppliedCommit(JSON.stringify({ ...RECORD, committedAt: bad })), null, String(bad));
    }
  });

  it('refuses text that is not one JSON object', () => {
    for (const text of ['', 'not json', '[]', 'null', '"x"', JSON.stringify([RECORD])]) {
      assert.equal(parseAppliedCommit(text), null, text);
    }
  });
});

describe('readAppliedCommit', () => {
  it('reads the playbook path by default', async () => {
    const paths = [];
    const read = async (path) => {
      paths.push(path);
      return JSON.stringify(RECORD);
    };
    assert.deepEqual(await readAppliedCommit({ read }), RECORD);
    assert.deepEqual(paths, [APPLIED_COMMIT_FILE]);
  });

  it('resolves null, never rejects, when the file is missing or unreadable', async () => {
    const missing = async () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    };
    assert.equal(await readAppliedCommit({ read: missing }), null);
  });

  it('resolves null for a file too large to be the record', async () => {
    const huge = async () => JSON.stringify({ ...RECORD, pad: 'x'.repeat(MAX_RECORD_BYTES) });
    assert.equal(await readAppliedCommit({ read: huge }), null);
  });
});

describe('the path is the one the playbook writes', () => {
  it('equals lab_host_applied_commit_file in group_vars/all.yml', () => {
    const vars = readFileSync(
      new URL('../../lab-host/ansible/group_vars/all.yml', import.meta.url),
      'utf8'
    );
    const declared = /^lab_host_applied_commit_file:\s*(\S+)\s*$/m.exec(vars)?.[1];
    assert.equal(declared, APPLIED_COMMIT_FILE);
  });
});

describe('index.js', () => {
  it('reads the record on every heartbeat and sends it as `applied`', () => {
    const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const heartbeat = /async function sendHeartbeat[\s\S]*?\n}\n/.exec(index)?.[0] ?? '';
    assert.match(heartbeat, /await readAppliedCommit\(\)/);
    assert.match(heartbeat, /applied/);
  });
});
