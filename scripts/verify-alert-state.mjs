#!/usr/bin/env node
/**
 * Compare every alert rule `infra/` declares with the rules Azure holds, and
 * fail naming each one that is missing, disabled or not wired to its action
 * group (PLAT-4, #964). `.github/workflows/verify-alert-state.yml` runs this
 * weekly as `github_reader`.
 *
 * ## What it reads, and from where
 *
 * The expected inventory comes from the repository: `lib/alert-declarations.mjs`
 * reads every `.tf` file as one module and resolves each rule's Azure name,
 * resource group, subscription and action group. Nothing here lists a rule by
 * name, so a rule added to `infra/` is checked from the commit that adds it.
 *
 * The live inventory comes from Azure Resource Manager: one token from
 * `az account get-access-token`, then plain GETs, per resource group the
 * declarations name, of the three alert rule types, and a GET of each action
 * group. The subscription IDs are not in the configuration (the variables are
 * sensitive); each subscription's display name is, and `GET /subscriptions`
 * maps one to the other. A subscription the identity holds no role in is
 * absent from that list, which is reported as exactly that.
 *
 * ## What it decides
 *
 *   OK              present, enabled, wired to the declared action group, and
 *                   auto-resolution as declared.
 *   MISSING         declared, not live. When `assert-expected-plan.mjs`
 *                   declares the rule's create, the line says it is waiting
 *                   for an apply rather than gone, which is the opposite
 *                   repair.
 *   DISABLED        live with `enabled: false`.
 *   NOT WIRED       live, but its actions do not name the declared group.
 *   DRIFT           `autoMitigate` differs from the declaration. The one
 *                   attribute that decides whether a firing rule mails once
 *                   or every evaluation (ADR 0022 decision 6), and the reason
 *                   this workflow was first written.
 *   NOT AUTHORIZED  the identity may not read the group. Never collapsed
 *                   into MISSING: one means the alert fabric is gone, the
 *                   other that this check's own grant is.
 *   GATED OFF       a `count`-gated rule whose gate GATES records as off,
 *                   and absent. Not a failure.
 *
 * Every one of those but OK and GATED OFF fails the run. A live rule that no
 * declaration names is listed and does not fail it: it pages, so it is worth
 * seeing, and deleting it is a decision rather than a repair.
 *
 * The action group is read too. It must exist, be enabled and have at least
 * one receiver whose status is Enabled. Receiver NAMES and statuses are
 * printed; the address and number ARM returns beside them are not, because
 * this report is published on a public repository.
 *
 * ## Usage
 *
 *     node scripts/verify-alert-state.mjs                 # live check, needs az login
 *     node scripts/verify-alert-state.mjs --list          # the declared inventory, no Azure
 *     node scripts/verify-alert-state.mjs --summary FILE  # also append the report to FILE
 *
 * Exit 0 when every expected rule is OK, 1 when any is not, 2 when the check
 * could not run at all (no token, an unreadable configuration). Exit 2 is never
 * reported as health.
 */
import { appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { DECLARED } from './assert-expected-plan.mjs';
import { parseArgs } from './lib/cli.mjs';
import { declaredAlertRules, environmentSuffix, shortName } from './lib/alert-declarations.mjs';
import { redact } from './lib/plan-report.mjs';
import { terraformSource } from './terraform-source.mjs';

export const ARM = 'https://management.azure.com';

/** api-version per ARM read, each the GA version its REST reference documents. */
export const API_VERSIONS = {
  'Microsoft.Insights/scheduledQueryRules': '2021-08-01',
  'Microsoft.Insights/metricAlerts': '2018-03-01',
  'Microsoft.Insights/activityLogAlerts': '2020-10-01',
  actionGroups: '2021-09-01',
  subscriptions: '2022-12-01',
};

/**
 * What each `count` gate is set to in the hcw-azure workspace, and the record
 * that says so.
 *
 * The workspace variables are not readable from here, and github_reader holds
 * no HCP Terraform token, so a gated rule's expected state is recorded rather
 * than read. That record can go stale, and the check says so when it does: a
 * rule present while its gate is recorded off is listed against this table,
 * and one absent while recorded on fails as MISSING. Every gate a declared
 * rule uses must have an entry, which the test suite enforces; an
 * unrecorded gate reports its rule as unknown rather than guessing.
 */
export const GATES = {
  availability_probe_alert_enabled: {
    armed: true,
    record: 'applied 2026-09-01 when T-519 closed (CHANGELOG.md, "T-519 closed: the reachability alert is armed")',
  },
  cosmos_export_enabled: {
    armed: true,
    record: 'exporter armed and its daily alert live since 2026-09-09 (docs/runbooks/cosmos-restore.md)',
  },
  availability_test_enabled: {
    armed: false,
    record: 'off: Bot Fight Mode answers Azure availability agents with a 403; the edge probe is the armed path (ADR 0024)',
  },
};

/** The plan checker's declared creates, by address: rules waiting for an apply. */
export function pendingCreates(declared = DECLARED) {
  return new Map(declared.filter((d) => d.action === 'create').map((d) => [d.address, d.reason]));
}

/**
 * Whether a declared rule should be live.
 *
 * @returns {{expected: 'present'|'absent'|'unknown', why: string}}
 */
export function expectation(rule, gates = GATES) {
  if (!rule.gate) return { expected: 'present', why: '' };
  if (rule.gate.expression) return { expected: 'unknown', why: `count = ${rule.gate.expression}` };
  const gate = gates[rule.gate.variable];
  if (!gate) return { expected: 'unknown', why: `gated on var.${rule.gate.variable}, which GATES does not record` };
  return {
    expected: gate.armed ? 'present' : 'absent',
    why: `var.${rule.gate.variable} ${gate.armed ? 'on' : 'off'}: ${gate.record}`,
  };
}

// ---------------------------------------------------------------------------
// Live reads
// ---------------------------------------------------------------------------

/** Turn an ARM error response into a classified, publishable reason. */
export function classifyError(status, body) {
  const code = body?.error?.code ?? body?.code ?? '';
  const message = body?.error?.message ?? body?.message ?? '';
  const reason = redact(`HTTP ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`).slice(0, 300);
  if (status === 401) return { status: 'unauthenticated', reason };
  if (status === 403 || /AuthorizationFailed/i.test(code)) return { status: 'denied', reason };
  if (status === 404 && /ResourceGroupNotFound/i.test(code)) return { status: 'group-not-found', reason };
  if (status === 404) return { status: 'not-found', reason };
  return { status: 'failed', reason };
}

/**
 * GET an ARM URL, following `nextLink` while it stays on the ARM host.
 *
 * The host check is not decoration: the next page is requested with the
 * same bearer token, and a link that pointed anywhere else would hand it
 * over. A link that leaves ARM ends the read as a failure.
 */
export async function armGet(path, { token, fetchImpl = fetch, list = false }) {
  let url = `${ARM}${path}`;
  const rows = [];
  for (let page = 0; url; page += 1) {
    if (page >= 50) return { status: 'failed', reason: 'more than 50 pages; refusing to keep paging' };
    if (!url.startsWith(`${ARM}/`)) return { status: 'failed', reason: 'nextLink left management.azure.com' };
    let res;
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      return { status: 'failed', reason: redact(`request failed: ${err?.message ?? err}`) };
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) return classifyError(res.status, body);
    if (!list) return { status: 'ok', body };
    if (!Array.isArray(body?.value)) return { status: 'failed', reason: 'response carried no value array' };
    rows.push(...body.value);
    url = body.nextLink ?? null;
  }
  return { status: 'ok', rows };
}

/** One live rule, normalised across the three ARM shapes. */
export function normaliseRule(armType, row) {
  const p = row?.properties ?? {};
  let actionGroupIds;
  if (armType === 'Microsoft.Insights/scheduledQueryRules') {
    actionGroupIds = p.actions?.actionGroups ?? [];
  } else if (armType === 'Microsoft.Insights/metricAlerts') {
    actionGroupIds = (p.actions ?? []).map((a) => a.actionGroupId);
  } else {
    actionGroupIds = (p.actions?.actionGroups ?? []).map((a) => a.actionGroupId);
  }
  return {
    name: row?.name ?? '(unnamed)',
    armType,
    enabled: p.enabled,
    autoMitigate: p.autoMitigate,
    actionGroupIds: actionGroupIds.filter((id) => typeof id === 'string'),
    severity: p.severity,
    evaluationFrequency: p.evaluationFrequency,
    windowSize: p.windowSize,
    muteActionsDuration: p.muteActionsDuration,
  };
}

/** A token for ARM from the signed-in az session. Throws when there is none. */
export function azAccessToken(exec = execSync) {
  // A fixed command with no interpolated value, so the shell execSync uses
  // (needed on Windows, where az is az.cmd) has nothing to misread.
  const out = exec('az account get-access-token --resource https://management.azure.com/ -o json --only-show-errors', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const token = JSON.parse(out).accessToken;
  if (!token) throw new Error('az returned no accessToken');
  return token;
}

/**
 * Read everything the declared rules need: the subscriptions, each
 * (subscription, resource group, rule type) list, and each action group.
 */
export async function readLive(rules, { token, fetchImpl = fetch }) {
  const subs = await armGet(`/subscriptions?api-version=${API_VERSIONS.subscriptions}`, {
    token,
    fetchImpl,
    list: true,
  });
  if (subs.status !== 'ok') return { subscriptionsRead: subs, ids: new Map(), lists: new Map(), actionGroups: new Map() };
  const ids = new Map(subs.rows.map((s) => [s.displayName, s.subscriptionId]));

  const lists = new Map();
  const wanted = new Map();
  for (const rule of rules) {
    wanted.set(listKey(rule.subscription, rule.resourceGroup, rule.armType), rule);
  }
  for (const [key, rule] of wanted) {
    const id = ids.get(rule.subscription);
    if (!id) {
      lists.set(key, {
        status: 'not-visible',
        reason: `${rule.subscription} is not among the subscriptions this identity can see; it holds no role there`,
      });
      continue;
    }
    const path =
      `/subscriptions/${id}/resourceGroups/${rule.resourceGroup}/providers/${rule.armType}` +
      `?api-version=${API_VERSIONS[rule.armType]}`;
    const read = await armGet(path, { token, fetchImpl, list: true });
    if (read.status === 'ok') {
      read.rules = new Map(read.rows.map((row) => normaliseRule(rule.armType, row)).map((r) => [r.name.toLowerCase(), r]));
      delete read.rows;
    }
    lists.set(key, read);
  }

  const actionGroups = new Map();
  for (const group of uniqueActionGroups(rules)) {
    const id = ids.get(group.subscription);
    if (!id) {
      actionGroups.set(group.address, { status: 'not-visible', reason: `${group.subscription} is not visible to this identity` });
      continue;
    }
    const path =
      `/subscriptions/${id}/resourceGroups/${group.resourceGroup}/providers/Microsoft.Insights/actionGroups/` +
      `${group.name}?api-version=${API_VERSIONS.actionGroups}`;
    const read = await armGet(path, { token, fetchImpl });
    actionGroups.set(group.address, read.status === 'ok' ? summariseActionGroup(read.body) : read);
  }
  return { subscriptionsRead: subs, ids, lists, actionGroups };
}

const listKey = (subscription, group, armType) => `${subscription}|${group.toLowerCase()}|${armType}`;

function uniqueActionGroups(rules) {
  const byAddress = new Map();
  for (const rule of rules) for (const g of rule.actionGroups) byAddress.set(g.address, g);
  return [...byAddress.values()];
}

/** Names and statuses only. The address and phone number are dropped here. */
export function summariseActionGroup(body) {
  const p = body?.properties ?? {};
  const receivers = [
    ...(p.emailReceivers ?? []).map((r) => ({ kind: 'email', name: r.name, status: r.status })),
    ...(p.smsReceivers ?? []).map((r) => ({ kind: 'sms', name: r.name, status: r.status })),
  ];
  return { status: 'ok', enabled: p.enabled !== false, receivers };
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

const FAILING = new Set(['MISSING', 'DISABLED', 'NOT WIRED', 'DRIFT', 'NOT AUTHORIZED', 'READ FAILED']);

function readFailureLabel(read) {
  return read.status === 'denied' || read.status === 'not-visible' || read.status === 'unauthenticated'
    ? 'NOT AUTHORIZED'
    : 'READ FAILED';
}

/** Whether a live rule's actions name the declared action group. */
export function wiredTo(live, group, ids) {
  const suffix = `/resourcegroups/${group.resourceGroup}/providers/microsoft.insights/actiongroups/${group.name}`.toLowerCase();
  const id = ids.get(group.subscription);
  return live.actionGroupIds.some((raw) => {
    const candidate = raw.toLowerCase();
    if (!candidate.endsWith(suffix)) return false;
    return !id || candidate === `/subscriptions/${id}${suffix}`.toLowerCase();
  });
}

/** One verdict per declared rule. */
export function compare(rules, live, { gates = GATES, pending = pendingCreates() } = {}) {
  return rules.map((rule) => {
    const expect = expectation(rule, gates);
    const read = live.lists.get(listKey(rule.subscription, rule.resourceGroup, rule.armType)) ?? {
      status: 'failed',
      reason: 'not read',
    };
    const base = { rule, expect, live: null, problems: [], notes: [] };
    if (expect.why) base.notes.push(expect.why);

    if (read.status !== 'ok') {
      return { ...base, state: readFailureLabel(read), problems: [read.reason] };
    }
    const found = read.rules.get(rule.name.toLowerCase()) ?? null;
    if (!found) {
      if (expect.expected === 'absent') return { ...base, state: 'GATED OFF' };
      if (expect.expected === 'unknown') return { ...base, state: 'ABSENT', notes: [...base.notes, 'gate state unknown'] };
      const waiting = pending.get(rule.address);
      const problems = waiting
        ? [`create declared in scripts/assert-expected-plan.mjs and waiting for an apply: ${waiting}`]
        : ['not in Azure'];
      return { ...base, state: 'MISSING', problems };
    }

    const verdict = { ...base, live: found };
    if (expect.expected === 'absent') {
      verdict.notes.push(`live although GATES records var.${rule.gate.variable} as off; correct the record`);
    }
    if (found.enabled === false && rule.enabled !== false) verdict.problems.push(['DISABLED', 'enabled is false']);
    for (const group of rule.actionGroups) {
      if (!wiredTo(found, group, live.ids)) {
        verdict.problems.push(['NOT WIRED', `actions do not name ${group.name} in ${group.resourceGroup}`]);
      }
    }
    if (rule.actionGroups.length === 0) verdict.problems.push(['NOT WIRED', 'no action group is declared']);
    if (rule.autoMitigate !== null && typeof found.autoMitigate === 'boolean' && found.autoMitigate !== rule.autoMitigate) {
      verdict.problems.push(['DRIFT', `autoMitigate is ${found.autoMitigate}, declared ${rule.autoMitigate}`]);
    }
    if (verdict.problems.length === 0) return { ...verdict, state: 'OK' };
    return { ...verdict, state: verdict.problems[0][0], problems: verdict.problems.map(([, text]) => text) };
  });
}

/** Live rules in the groups read that no declaration names. */
export function undeclared(rules, live) {
  const declared = new Set(rules.map((r) => `${listKey(r.subscription, r.resourceGroup, r.armType)}|${r.name.toLowerCase()}`));
  const out = [];
  for (const [key, read] of live.lists) {
    if (read.status !== 'ok') continue;
    for (const [name, rule] of read.rules) {
      if (!declared.has(`${key}|${name}`)) out.push({ key, rule });
    }
  }
  return out;
}

/** Problems with the action groups themselves. */
export function actionGroupProblems(rules, live) {
  return uniqueActionGroups(rules).map((group) => {
    const read = live.actionGroups.get(group.address) ?? { status: 'failed', reason: 'not read' };
    if (read.status !== 'ok') return { group, state: readFailureLabel(read), problems: [read.reason], read };
    const problems = [];
    if (!read.enabled) problems.push('the action group is disabled');
    if (!read.receivers.some((r) => r.status === 'Enabled')) problems.push('no receiver has status Enabled');
    return { group, state: problems.length ? 'BROKEN' : 'OK', problems, read };
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const cell = (value) => (value === undefined || value === null || value === '' ? '—' : `\`${value}\``);

export function renderReport({ rules, verdicts, extra, groups, when, subscriptionsRead }) {
  const lines = ['## Alert rule state', ''];
  const where = new Set(rules.map((r) => `\`${r.resourceGroup}\` (${r.subscription})`));
  lines.push(
    `Read ${when}. ${rules.length} rules are declared in \`infra/\`, across ${[...where].join(' and ')}. ` +
      'The list is derived from the configuration on every run, so a rule added there is checked here from the commit that adds it.',
    ''
  );
  if (subscriptionsRead && subscriptionsRead.status !== 'ok') {
    lines.push(`**The subscription list could not be read** (${subscriptionsRead.reason}), so nothing below is known.`, '');
  }
  lines.push('| Rule | Resource group | State | Enabled | autoMitigate | Every | Window | Sev | Detail |');
  lines.push('| --- | --- | --- | :---: | :---: | --- | --- | :---: | --- |');
  for (const v of verdicts) {
    const l = v.live ?? {};
    const detail = [...v.problems, ...v.notes].join('; ').replace(/\|/g, '\\|');
    lines.push(
      `| \`${v.rule.name}\` | \`${v.rule.resourceGroup}\` | **${v.state}** | ${cell(l.enabled)} | ${cell(l.autoMitigate)} | ` +
        `${cell(l.evaluationFrequency)} | ${cell(l.windowSize)} | ${cell(l.severity)} | ${detail || ''} |`
    );
  }
  lines.push('', '### Action groups', '', '| Action group | Resource group | State | Receivers | Detail |', '| --- | --- | --- | --- | --- |');
  for (const g of groups) {
    const receivers = g.read?.receivers?.map((r) => `${r.kind} \`${r.name}\` ${r.status}`).join(', ') ?? '—';
    lines.push(`| \`${g.group.name}\` | \`${g.group.resourceGroup}\` | **${g.state}** | ${receivers} | ${g.problems.join('; ').replace(/\|/g, '\\|')} |`);
  }
  if (extra.length > 0) {
    lines.push('', '### Live rules no declaration names', '');
    lines.push('These page if they fire, and nothing in `infra/` manages them. Not a failure; delete or declare them.', '');
    for (const { rule } of extra) lines.push(`- \`${rule.name}\` (${rule.armType}, enabled ${rule.enabled})`);
  }
  lines.push('');
  const failing = verdicts.filter((v) => FAILING.has(v.state)).length + groups.filter((g) => g.state !== 'OK').length;
  const denied = verdicts.some((v) => v.state === 'NOT AUTHORIZED') || groups.some((g) => g.state === 'NOT AUTHORIZED');
  if (failing === 0) {
    lines.push('**Every expected rule is live, enabled and wired to its action group.**');
  } else {
    lines.push(`**${failing} finding(s).** Each is named in the State column above.`);
    if (denied) {
      lines.push(
        '',
        '`NOT AUTHORIZED` means this identity could not read that resource group, so the state of the rules in it ' +
          'is unknown; it is not the same finding as `MISSING`. The Detail column says why, and `infra/oidc.tf` ' +
          'holds the grants of `github_reader`, the identity this workflow signs in as.'
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The declared inventory as a table, for --list. */
export function renderInventory(rules, suffix) {
  const lines = ['| Rule | Kind | Resource group | Subscription | Gate | Action group |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of rules) {
    const gate = r.gate ? (r.gate.variable ? `var.${r.gate.variable}` : r.gate.expression) : '';
    lines.push(
      `| \`${shortName(r, suffix)}\` | ${r.kind} | \`${r.resourceGroup}\` | \`${r.subscription}\` | ${gate} | ` +
        `${r.actionGroups.map((g) => `\`${g.name}\``).join(', ')} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------

const USAGE = `Usage: node scripts/verify-alert-state.mjs [--list] [--summary <file>]

  (no flags)        read the live rules through ARM (needs az login) and compare
  --list            print the rules infra/ declares and exit; no Azure call
  --summary <file>  also append the report to <file> (the job summary in CI)

exit 0  every expected rule is live, enabled and wired
exit 1  at least one finding, named in the report
exit 2  the check could not run`;

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv, { flags: ['list', 'help'], options: ['summary'] });
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 2;
  }
  if (args.flags.help) {
    console.log(USAGE);
    return 0;
  }

  let rules;
  let suffix;
  try {
    const source = terraformSource();
    rules = declaredAlertRules(source);
    suffix = environmentSuffix(source);
  } catch (err) {
    console.error(`Could not read the declared alert rules from infra/: ${err.message}`);
    return 2;
  }

  if (args.flags.list) {
    process.stdout.write(renderInventory(rules, suffix));
    return 0;
  }

  let token;
  try {
    token = azAccessToken();
  } catch (err) {
    console.error(`No ARM token from az, so nothing was read: ${redact(String(err?.message ?? err)).slice(0, 300)}`);
    return 2;
  }

  const live = await readLive(rules, { token });
  const verdicts = compare(rules, live);
  const groups = actionGroupProblems(rules, live);
  const extra = undeclared(rules, live);
  const when = new Date().toISOString().replace(/:\d\d\.\d+Z$/, ' UTC').replace('T', ' ');
  const report = renderReport({ rules, verdicts, extra, groups, when, subscriptionsRead: live.subscriptionsRead });

  // Both destinations, as before: the summary for a person on a phone, stdout
  // for the logs API, which does not expose the summary.
  process.stdout.write(report);
  if (args.options.summary) appendFileSync(args.options.summary, report);

  if (live.subscriptionsRead.status !== 'ok') return 1;
  const failing = verdicts.some((v) => FAILING.has(v.state)) || groups.some((g) => g.state !== 'OK');
  return failing ? 1 : 0;
}

// pathToFileURL, not a `file://` template: see entrypoint-guards.test.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
