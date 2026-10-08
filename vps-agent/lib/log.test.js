/**
 * The agent's log lines carry the priority journald reads (#1009).
 *
 * The lab host's data collection rule takes the `daemon` facility at Warning
 * and above only, and journald gives a line with no `<N>` prefix priority 6,
 * info. So the load-bearing assertions are that an error line starts `<3>`
 * and a warning `<4>` on EVERY physical line, that info carries no prefix,
 * and that index.js writes nothing that bypasses the logger.
 *
 * Node's built-in test runner, like the rest of this package.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PRIORITY, createLogger, formatLine } from './log.js';

const AT = new Date('2026-10-08T04:30:00.000Z');

function capture() {
  const writes = [];
  const log = createLogger({ agentId: 'vps-1', now: () => AT, write: (stream, text) => writes.push({ stream, text }) });
  return { log, writes };
}

describe('formatLine', () => {
  it('prefixes an error with <3> and a warning with <4>, the sd-daemon priorities', () => {
    assert.deepEqual(PRIORITY, { error: 3, warn: 4, info: 6 });
    assert.equal(
      formatLine({ level: 'error', agentId: 'vps-1', at: AT, args: ['job j1 errored:', 'boom'] }),
      '<3>2026-10-08T04:30:00.000Z [vps-1] job j1 errored: boom\n'
    );
    assert.equal(
      formatLine({ level: 'warn', agentId: 'vps-1', at: AT, args: ['heartbeat failed:', 'ETIMEDOUT'] }),
      '<4>2026-10-08T04:30:00.000Z [vps-1] heartbeat failed: ETIMEDOUT\n'
    );
  });

  it('leaves info unprefixed, so it stays at journald\'s default and reads as it always did', () => {
    assert.equal(
      formatLine({ level: 'info', agentId: 'vps-1', at: AT, args: ['running job j1 (terraform-validate)'] }),
      '2026-10-08T04:30:00.000Z [vps-1] running job j1 (terraform-validate)\n'
    );
  });

  it('prefixes every physical line, because journald reads the priority per line', () => {
    const text = formatLine({ level: 'error', agentId: 'vps-1', at: AT, args: ['Fatal agent error:', 'first\nsecond\r\nthird'] });
    const lines = text.trimEnd().split('\n');
    assert.equal(lines.length, 3);
    for (const line of lines) assert.match(line, /^<3>/);
    assert.equal(lines[2], '<3>third');
  });

  it('formats its arguments the way console.log does, an Error with its stack', () => {
    const text = formatLine({ level: 'error', agentId: 'vps-1', at: AT, args: ['Fatal agent error:', new Error('no certificate')] });
    assert.match(text, /^<3>2026-10-08T04:30:00\.000Z \[vps-1\] Fatal agent error: Error: no certificate\n<3>\s+at /);
    assert.equal(formatLine({ level: 'info', agentId: 'a', at: AT, args: ['%s jobs', 2] }), '2026-10-08T04:30:00.000Z [a] 2 jobs\n');
  });
});

describe('createLogger', () => {
  it('writes info to stdout and warnings and errors to stderr, both of which reach the journal', () => {
    const { log, writes } = capture();
    log.info('starting');
    log.warn('claim failed:', 'socket hang up');
    log.error('could not report failure for j1:', '503');
    assert.deepEqual(
      writes.map(({ stream, text }) => [stream, text.slice(0, 3)]),
      [
        ['stdout', '202'],
        ['stderr', '<4>'],
        ['stderr', '<3>'],
      ]
    );
  });
});

describe('index.js', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('writes nothing past the logger: no console call, no bare log()', () => {
    assert.doesNotMatch(code, /\bconsole\.\w+\(/);
    assert.doesNotMatch(code, /(?<![.\w])log\(/);
    assert.match(code, /const log = createLogger\(\{ agentId: config\.agentId \}\)/);
  });

  it('writes the failures that need a person at error, and the transient ones at warn', () => {
    for (const message of [
      'Missing required configuration',
      'refusing job ${job.id}',
      'could not report refusal for',
      'job ${job.id} errored:',
      'could not report failure for',
      'Fatal agent error:',
    ]) {
      assert.ok(code.includes(`log.error(\`${message}`) || code.includes(`log.error('${message}`), `${message} is not logged at error`);
    }
    for (const message of ['heartbeat failed:', 'claim failed:']) {
      assert.ok(code.includes(`log.warn('${message}`), `${message} is not logged at warn`);
    }
  });
});

describe('the systemd unit', () => {
  it('keeps journald reading the prefix (SyslogLevelPrefix=true), so the priority is not printed as text', () => {
    const unit = readFileSync(
      new URL('../../lab-host/ansible/roles/labs_agent/templates/hcw-labs-agent.service.j2', import.meta.url),
      'utf8'
    );
    assert.match(unit, /^SyslogLevelPrefix=true$/m);
    assert.doesNotMatch(unit, /^StandardOutput=(?!journal)/m);
    assert.doesNotMatch(unit, /^StandardError=(?!journal|inherit)/m);
  });
});
