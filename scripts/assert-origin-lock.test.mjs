/**
 * The origin-lock assertion (PLAT-2, #962) reads the Azure restriction, so it
 * fails when the lock is off, which the Cloudflare curl it replaced never did.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LOCK_VARIABLE, lockProblems, parseRestrictions, report, run } from './assert-origin-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'assert-origin-lock.mjs');

/** A rule as `az functionapp config access-restriction show` prints it. */
const rule = (name, ip, action = 'Allow', priority = 100) => ({
  action,
  description: null,
  headers: null,
  ip_address: ip,
  name,
  priority,
  subnet_mask: null,
  subnet_traffic_tag: null,
  tag: 'Default',
  vnet_subnet_resource_id: null,
  vnet_traffic_tag: null,
});

/** The posture infra/functionapp.tf writes with functions_origin_lock_enabled = true. */
const locked = (extra = []) => ({
  scmIpSecurityRestrictionsUseMain: false,
  ipSecurityRestrictions: [
    rule('cloudflare-173-245-48-0-20', '173.245.48.0/20'),
    rule('cloudflare-103-21-244-0-22', '103.21.244.0/22', 'Allow', 101),
    ...extra,
    rule('deny-all-non-cloudflare', '0.0.0.0/0', 'Deny', 65000),
    rule('Deny all', 'Any', 'Deny', 2147483647),
  ],
  scmIpSecurityRestrictions: [rule('Allow all', 'Any', 'Allow', 2147483647)],
  ipSecurityRestrictionsDefaultAction: 'Deny',
  scmIpSecurityRestrictionsDefaultAction: 'Allow',
});

/** The posture with functions_origin_lock_enabled = false: no rules, Allow. */
const unlocked = () => ({
  scmIpSecurityRestrictionsUseMain: false,
  ipSecurityRestrictions: [rule('Allow all', 'Any', 'Allow', 2147483647)],
  scmIpSecurityRestrictions: [rule('Allow all', 'Any', 'Allow', 2147483647)],
  ipSecurityRestrictionsDefaultAction: 'Allow',
  scmIpSecurityRestrictionsDefaultAction: 'Allow',
});

describe('lockProblems', () => {
  it('passes the posture Terraform writes when the lock is on', () => {
    expect(lockProblems(locked())).toEqual([]);
  });

  it('fails when the lock variable is false, naming the variable', () => {
    const problems = lockProblems(unlocked());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain('`Allow`');
    expect(problems[0]).toContain(LOCK_VARIABLE);
  });

  it('fails when only the default action has been turned to Allow, the IPv6 hole', () => {
    // Every IPv4 request is still refused by the deny-all rule here, which is
    // exactly what a curl from an IPv4 runner would have seen.
    const doc = { ...locked(), ipSecurityRestrictionsDefaultAction: 'Allow' };
    expect(lockProblems(doc)).toHaveLength(1);
  });

  it('fails an unset default action rather than assuming Deny', () => {
    const doc = locked();
    delete doc.ipSecurityRestrictionsDefaultAction;
    expect(lockProblems(doc)[0]).toContain('`unset`');
  });

  it.each(['0.0.0.0/0', '::/0', 'Any'])('fails an Allow rule for %s, whatever the default action', (ip) => {
    const problems = lockProblems(locked([rule('ci-smoke-1', ip, 'Allow', 50)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('every address');
  });

  it('fails an Allow rule added outside Terraform, naming it', () => {
    const problems = lockProblems(locked([rule('owner-laptop', '203.0.113.7/32', 'Allow', 200)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('`owner-laptop`');
  });

  it("tolerates another workflow's per-run window", () => {
    expect(lockProblems(locked([rule('ci-manifest-123', '198.51.100.4/32', 'Allow', 300)]))).toEqual([]);
  });

  it("fails when this run's own window is still there", () => {
    const doc = locked([rule('ci-smoke-77', '198.51.100.4/32', 'Allow', 300)]);
    expect(lockProblems(doc, { windowRule: 'ci-smoke-78' })).toEqual([]);
    expect(lockProblems(doc, { windowRule: 'ci-smoke-77' })[0]).toContain('ci-smoke-77');
  });

  it('reads the camelCase spelling of the address too', () => {
    const open = { name: 'x', action: 'Allow', ipAddress: '0.0.0.0/0' };
    expect(lockProblems(locked([open])).join(' ')).toContain('every address');
  });
});

describe('report', () => {
  it('says enforcing, with what it read', () => {
    const { code, lines } = report(locked([rule('ci-manifest-9', '198.51.100.4/32', 'Allow', 300)]));
    expect(code).toBe(0);
    expect(lines[0]).toBe('✅ Origin lock: **enforcing**');
    expect(lines.join('\n')).toContain('2 Cloudflare allow rule(s)');
    expect(lines.join('\n')).toContain('`ci-manifest-9`');
  });

  it('says NOT ENFORCING with each reason as a list item', () => {
    const { code, lines } = report(unlocked());
    expect(code).toBe(1);
    expect(lines[0]).toBe('❌ Origin lock: **NOT ENFORCING**');
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(2);
  });
});

describe('parseRestrictions and run', () => {
  it.each([
    ['not JSON', 'Forbidden'],
    ['an empty document', ''],
    ['a document without the main site rules', '{"scmIpSecurityRestrictions":[]}'],
  ])('exits 2 on %s rather than calling the lock open or closed', (_label, input) => {
    const got = run({ input });
    expect(got.code).toBe(2);
    expect(got.lines[0]).toContain('unreadable');
  });

  it('parses what the CLI prints', () => {
    expect(parseRestrictions(JSON.stringify(locked())).ipSecurityRestrictions).toHaveLength(4);
  });

  it('exits 2 on an argument it does not know, or a flag with no value', () => {
    expect(run({ args: ['--strict'], input: JSON.stringify(locked()) }).code).toBe(2);
    expect(run({ args: ['--window-closed'], input: JSON.stringify(locked()) }).code).toBe(2);
  });
});

describe('deploy-functions.yml asserts the lock from the control plane', () => {
  const text = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-functions.yml'), 'utf8');

  it('reads the access restriction and pipes it here, naming its own window', () => {
    expect(text).toMatch(/az functionapp config access-restriction show -n "\$APP" -g "\$RG" -o json/);
    expect(text).toMatch(/node scripts\/assert-origin-lock\.mjs --window-closed "ci-smoke-\$\{GITHUB_RUN_ID\}"/);
  });

  it('no longer judges the lock by what Cloudflare answers a runner', () => {
    expect(text).not.toMatch(/FUNCTIONS_URL\}\/health/);
    expect(text).not.toMatch(/unlisted caller/);
  });
});

describe('the CLI actually executes', () => {
  const spawn = (args, input) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', cwd: ROOT }) };
    } catch (err) {
      return { code: err.status, stdout: err.stdout ?? '' };
    }
  };

  it('exits 0 on the locked posture', () => {
    const got = spawn(['--window-closed', 'ci-smoke-1'], JSON.stringify(locked()));
    expect(got.code).toBe(0);
    expect(got.stdout).toContain('enforcing');
  });

  it('exits 1 when the lock is off', () => {
    expect(spawn([], JSON.stringify(unlocked())).code).toBe(1);
  });

  it('exits 2 on unreadable input', () => {
    expect(spawn([], '').code).toBe(2);
  });
});
