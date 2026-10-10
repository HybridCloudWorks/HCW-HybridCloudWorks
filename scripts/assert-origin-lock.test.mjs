/**
 * The origin-lock assertion (PLAT-2, #962) reads the Azure restriction and
 * holds it to what infra/ declares, so it fails when the lock is off, which
 * the Cloudflare curl it replaced never did.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  addressesOf,
  declaredCloudflareRanges,
  isSingleAddress,
  LOCK_VARIABLE,
  lockProblems,
  MIN_DECLARED_RANGES,
  parseRestrictions,
  report,
  run,
} from './assert-origin-lock.mjs';
import { terraformSource } from './terraform-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'assert-origin-lock.mjs');

/** The ranges infra/variables.tf declares, read the way the script reads them. */
const RANGES = declaredCloudflareRanges(terraformSource());

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

/** Terraform's rule name for a range (infra/functionapp.tf). */
const cloudflareName = (range) => `cloudflare-${range.replaceAll('.', '-').replaceAll('/', '-')}`;

/** The posture infra/functionapp.tf writes with functions_origin_lock_enabled = true. */
const locked = (extra = [], ranges = RANGES) => ({
  scmIpSecurityRestrictionsUseMain: false,
  ipSecurityRestrictions: [
    ...ranges.map((range, i) => rule(cloudflareName(range), range, 'Allow', 100 + i)),
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

/** lockProblems against the declared ranges. */
const problemsOf = (doc, options = {}) => lockProblems(doc, { declaredRanges: RANGES, ...options });

describe('declaredCloudflareRanges', () => {
  it('reads the ranges infra/variables.tf declares, above the floor', () => {
    expect(RANGES.length).toBeGreaterThanOrEqual(MIN_DECLARED_RANGES);
    expect(RANGES).toContain('173.245.48.0/20');
    for (const range of RANGES) expect(range).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
  });

  it('finds nothing in a module without the variable, rather than guessing', () => {
    expect(declaredCloudflareRanges('variable "other" {\n  default = ["1.2.3.0/24"]\n}\n')).toEqual([]);
  });
});

describe('addressesOf and isSingleAddress', () => {
  it('splits a rule that lists several addresses', () => {
    expect(addressesOf(rule('x', '198.51.100.4/32, 0.0.0.0/0'))).toEqual(['198.51.100.4/32', '0.0.0.0/0']);
    expect(addressesOf({ ipAddress: '203.0.113.7/32' })).toEqual(['203.0.113.7/32']);
  });

  it.each([
    ['198.51.100.4/32', true],
    ['198.51.100.4', true],
    ['2001:db8::1/128', true],
    ['198.51.100.0/24', false],
    ['2001:db8::/64', false],
    ['AzureCloud', false],
  ])('%s is one address: %s', (address, single) => {
    expect(isSingleAddress(address)).toBe(single);
  });
});

describe('lockProblems', () => {
  it('passes the posture Terraform writes when the lock is on', () => {
    expect(problemsOf(locked())).toEqual([]);
  });

  it('fails when the lock variable is false, naming the variable', () => {
    const problems = problemsOf(unlocked());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain('`Allow`');
    expect(problems[0]).toContain(LOCK_VARIABLE);
  });

  it('fails when only the default action has been turned to Allow, the IPv6 hole', () => {
    // Every IPv4 request is still refused by the deny-all rule here, which is
    // exactly what a curl from an IPv4 runner would have seen.
    const doc = { ...locked(), ipSecurityRestrictionsDefaultAction: 'Allow' };
    expect(problemsOf(doc)).toHaveLength(1);
  });

  it('fails an unset default action rather than assuming Deny', () => {
    const doc = locked();
    delete doc.ipSecurityRestrictionsDefaultAction;
    expect(problemsOf(doc)[0]).toContain('`unset`');
  });

  it.each(['0.0.0.0/0', '::/0', 'Any'])('fails an Allow rule for %s, whatever its name', (ip) => {
    const problems = problemsOf(locked([rule('ci-smoke-1', ip, 'Allow', 50)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('every address');
  });

  it('reads every address in a rule, so a permitted one cannot hide an unrestricted one', () => {
    // The shape review found: an allowed name and an allowed address,
    // comma-separated with 0.0.0.0/0, compared as one string.
    const problems = problemsOf(locked([rule('ci-manifest-123', '198.51.100.4/32,0.0.0.0/0', 'Allow', 300)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0.0.0.0/0');
  });

  it('fails a cloudflare-* rule for an address infra/ does not declare, whatever it is called', () => {
    const problems = problemsOf(locked([rule('cloudflare-extra', '203.0.113.0/24', 'Allow', 120)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('203.0.113.0/24');
    expect(problems[0]).toContain('cloudflare_ip_ranges');
  });

  it('fails a ci-* rule wider than one address', () => {
    const problems = problemsOf(locked([rule('ci-smoke-9', '198.51.100.0/24', 'Allow', 300)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('/32');
  });

  it('fails an Allow rule added outside Terraform, naming it', () => {
    const problems = problemsOf(locked([rule('owner-laptop', '203.0.113.7/32', 'Allow', 200)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('`owner-laptop`');
  });

  it('fails an Allow rule with no address to hold to infra/', () => {
    const tagged = { ...rule('cloudflare-tag', '', 'Allow', 130), ip_address: null, tag: 'ServiceTag' };
    expect(problemsOf(locked([tagged]))[0]).toContain('lists no IP address');
  });

  it('fails a lock that admits no Cloudflare range, which no visitor can get through', () => {
    const problems = problemsOf(locked([], []));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${RANGES.length} of the ${RANGES.length}`);
    expect(problems[0]).toContain('unreachable through Cloudflare');
  });

  it('fails a declared range that has lost its rule, naming the range', () => {
    const problems = problemsOf(locked([], RANGES.slice(1)));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(RANGES[0]);
  });

  it("tolerates another workflow's per-run window", () => {
    expect(problemsOf(locked([rule('ci-manifest-123', '198.51.100.4/32', 'Allow', 300)]))).toEqual([]);
  });

  it("fails when this run's own window is still there", () => {
    const doc = locked([rule('ci-smoke-77', '198.51.100.4/32', 'Allow', 300)]);
    expect(problemsOf(doc, { windowRule: 'ci-smoke-78' })).toEqual([]);
    expect(problemsOf(doc, { windowRule: 'ci-smoke-77' })[0]).toContain('ci-smoke-77');
  });
});

describe('report', () => {
  it('says enforcing, with what it read', () => {
    const { code, lines } = report(locked([rule('ci-manifest-9', '198.51.100.4/32', 'Allow', 300)]), {
      declaredRanges: RANGES,
    });
    expect(code).toBe(0);
    expect(lines[0]).toBe('✅ Origin lock: **enforcing**');
    expect(lines.join('\n')).toContain(`${RANGES.length} of ${RANGES.length} declared Cloudflare ranges admitted`);
    expect(lines.join('\n')).toContain('`ci-manifest-9`');
  });

  it('says NOT ENFORCING with each reason as a list item', () => {
    const { code, lines } = report(unlocked(), { declaredRanges: RANGES });
    expect(code).toBe(1);
    expect(lines[0]).toBe('❌ Origin lock: **NOT ENFORCING**');
    // The default action and the "Allow all" rule. The ranges no rule admits
    // are not listed while everything is admitted anyway.
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(2);
  });
});

describe('parseRestrictions and run', () => {
  it.each([
    ['not JSON', 'Forbidden'],
    ['an empty document', ''],
    ['a document without the main site rules', '{"scmIpSecurityRestrictions":[]}'],
  ])('exits 2 on %s rather than calling the lock open or closed', (_label, input) => {
    const got = run({ input, declaredRanges: RANGES });
    expect(got.code).toBe(2);
    expect(got.lines[0]).toContain('unreadable');
  });

  it('exits 2 when too few ranges were declared to hold the rules to', () => {
    const got = run({ input: JSON.stringify(locked()), declaredRanges: RANGES.slice(0, 2) });
    expect(got.code).toBe(2);
    expect(got.lines[0]).toContain('parse is broken');
  });

  it('reads the declared ranges from infra/ when none are passed', () => {
    expect(run({ input: JSON.stringify(locked()) }).code).toBe(0);
  });

  it('parses what the CLI prints', () => {
    expect(parseRestrictions(JSON.stringify(locked())).ipSecurityRestrictions).toHaveLength(RANGES.length + 2);
  });

  it('exits 2 on an argument it does not know, or a flag with no value', () => {
    expect(run({ args: ['--strict'], input: JSON.stringify(locked()), declaredRanges: RANGES }).code).toBe(2);
    expect(run({ args: ['--window-closed'], input: JSON.stringify(locked()), declaredRanges: RANGES }).code).toBe(2);
  });
});

describe('deploy-functions.yml asserts the lock from the control plane', () => {
  const text = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-functions.yml'), 'utf8');

  it('reads the access restriction and pipes it here, naming its own window only when it opened one', () => {
    expect(text).toMatch(/az functionapp config access-restriction show -n "\$APP" -g "\$RG" -o json/);
    expect(text).toMatch(/args=\(--window-closed "ci-smoke-\$\{GITHUB_RUN_ID\}"\)/);
    expect(text).toMatch(/node scripts\/assert-origin-lock\.mjs "\$\{args\[@\]\}"/);
    expect(text).toMatch(/WINDOW_OPENED: \$\{\{ steps\.appfw\.outputs\.runner_ip != '' \}\}/);
  });

  it('runs whenever the sign-in succeeded, not only when the origin window opened', () => {
    const at = text.indexOf('- name: Assert the origin lock is enforcing');
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(at, at + 200)).toMatch(/if: \$\{\{ !cancelled\(\) && steps\.login\.outcome == 'success' \}\}/);
    expect(text).toMatch(/^ {8}id: login$/m);
  });

  it('no longer judges the lock by what Cloudflare answers a runner', () => {
    expect(text).not.toMatch(/FUNCTIONS_URL\}\/health/);
    expect(text).not.toMatch(/unlisted caller/);
  });
});

describe('the CLI actually executes', () => {
  /** Run the script as the workflow does, from the repository root. */
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
