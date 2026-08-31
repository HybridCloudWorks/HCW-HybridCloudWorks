#!/usr/bin/env node
/**
 * Fetch the latest HCP Terraform plan and assert it carries ONLY the known
 * permanent diff.
 *
 * ## Why this exists
 *
 * `assert-expected-plan.mjs` has been the check since T-724, and it is good.
 * What nobody had automated was getting a plan INTO a file to feed it — four
 * chained HCP Terraform API calls — so it was run by hand or not at all.
 *
 * ## Why Node and not PowerShell
 *
 * This replaced `scripts/cutover/07-check-plan.ps1`, which lived for about an
 * hour on 2026-08-29. The cutover scripts are PowerShell because they drive the
 * Azure CLI from an operator's Windows desktop. This one only feeds a Node
 * script, and its endgame is T-724's remaining half: running inside
 * `iac-validate.yml`, on `ubuntu-latest`. A `.ps1` bound for a Linux runner is
 * the wrong language, and it also failed the simpler test of being runnable
 * from the bash prompt the owner was actually sitting at.
 *
 * Calling `checkPlan` directly rather than shelling out removes three problems
 * the PowerShell version had to handle: no temp file (so the plan's sensitive
 * variable values and state copies never touch disk), no deletion path to get
 * wrong, and no native exit-code trap — the checker exits 1 to mean "unexpected
 * plan", which PowerShell 7.4+ turns into a thrown error under
 * `$ErrorActionPreference = 'Stop'`.
 *
 * ## Usage
 *
 *     TFC_TOKEN=... node scripts/check-tfc-plan.mjs
 *     TFC_TOKEN=... node scripts/check-tfc-plan.mjs --run run-AbCdEf1234567890
 *
 * The token must be a HCP Terraform **user** or **team** token with admin
 * access to the workspace:
 *
 *     https://app.terraform.io/app/settings/tokens
 *
 * Two token failures, kept apart because they read very differently:
 *
 *   - **403, observed.** An invalid or revoked token is refused here. Confirmed
 *     by running this against a junk token, not assumed.
 *   - **404, documented.** HashiCorp's `/plans` reference says `json-output`
 *     "cannot be accessed with organization tokens" and needs admin-level
 *     workspace access. An under-privileged token gets 404 rather than 403,
 *     which reads like a missing plan rather than a permissions problem. Not
 *     reproduced here — no organization token to hand — so it is handled from
 *     the documentation and labelled as such.
 *
 * Exit codes match `assert-expected-plan.mjs`: 0 expected, 1 unexpected,
 * 2 could not be read.
 */

import { pathToFileURL } from 'node:url';

import { EXPECTED, checkPlan } from './assert-expected-plan.mjs';

const API = 'https://app.terraform.io/api/v2';
const ORGANIZATION = 'hcw';
const WORKSPACE = 'hcw-azure';

/**
 * Run states where a human decision is still outstanding — the case this tool
 * exists for.
 *
 * HashiCorp's run states are documented at
 * developer.hashicorp.com/terraform/cloud-docs/run/states; this is the subset
 * where the run is parked waiting on someone, not a claim to enumerate them all.
 * An unrecognised state therefore reads as "not awaiting", which errs toward
 * printing the caveat rather than silently omitting it.
 */
export const AWAITING_DECISION = new Set(['planned', 'cost_estimated', 'policy_checked', 'policy_override']);

/**
 * Run states that are over.
 *
 * Kept SEPARATE from the complement of AWAITING_DECISION, because those are not
 * the same thing and the first draft of this treated them as though they were.
 * `planning`, `applying`, `cost_estimating` and `apply_queued` are neither
 * awaiting a decision nor finished — they are running. Saying "already
 * finished" of a run that is applying right now is false in the direction that
 * matters, since the operator would read it as settled while ARM is mid-change.
 * Caught in review on 2026-08-30.
 *
 * A state in neither set is in progress as far as the caveat is concerned,
 * which is the safe reading: it claims less.
 */
export const FINISHED = new Set([
  'applied',
  'discarded',
  'errored',
  'canceled',
  'force_canceled',
  'planned_and_finished',
]);

/**
 * Accept a run id with or without its `run-` prefix.
 *
 * HCP Terraform prints run ids prefixed, but the bare suffix is what you get
 * from a hasty copy out of the URL bar or off the run header, and that is what
 * an operator pasted into the workflow's input on 2026-08-30. The bare form
 * 404s, and the 404 handler blamed the token.
 *
 * Prefixing is announced rather than silent: the caller should learn the shape
 * for next time. Anything that is not recognisably an id is refused here, with
 * the expected shape, rather than being sent to the API to come back as a 404
 * that reads like a permissions problem.
 *
 * BLANK IS DECIDED AFTER TRIMMING. The workflow tests its input with
 * `[ -n "$RUN_ID" ]`, and a whitespace-only value passes that — so "   " used
 * to arrive here and throw, when the operator plainly meant "use the latest".
 *
 * The SAME minimum length applies to both forms. It used to be eight for a
 * bare id and one for a prefixed one, so `run-a` passed validation and 404d
 * anyway, reproducing the identifier-versus-token confusion this function
 * exists to end. The bound is deliberately a minimum rather than the sixteen
 * characters HCP Terraform issues today: refusing a valid id because HashiCorp
 * changed its id length would break the tool outright, which is worse than one
 * confusing 404.
 */
const RUN_ID_BODY = /^[A-Za-z0-9]{8,}$/;

export function normaliseRunId(raw) {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('run-')) {
    const body = value.slice(4);
    if (RUN_ID_BODY.test(body)) return value;
  } else if (RUN_ID_BODY.test(value)) {
    console.log(`(read "${value}" as "run-${value}" — run ids carry a run- prefix)`);
    return `run-${value}`;
  }
  throw new Error(
    `"${raw}" is not a run id. Expected the identifier shown on the run page in HCP Terraform, ` +
      'such as run-KqAcgGBXrFkcYP76 — the run- prefix is optional here. Leave it blank to check ' +
      'the workspace latest.'
  );
}

/**
 * Find the run HCP Terraform planned for one commit.
 *
 * WHY THIS EXISTS. Without it this tool resolves the workspace's LATEST run,
 * which is whatever ran last and is usually not the pull request in front of
 * you — `tfc-plan-check.yml` refuses to run on every pull request for exactly
 * that reason, because a check that is green about someone else's run is worse
 * than no check. Selecting by commit is what makes the check mean what its
 * name says.
 *
 * SHAPE. `/workspaces/:id/runs?include=configuration_version.ingress_attributes`
 * answers JSON:API: the run carries a `configuration-version` relationship, the
 * configuration version carries an `ingress-attributes` relationship, and the
 * ingress attributes carry `commit-sha`. Both hops are resolved through
 * `included`, which is why the caller must fetch this raw rather than through
 * the `.data` unwrapping the other calls use.
 *
 * UNRECOGNISED SHAPES THROW rather than returning null, following
 * `check-unresolved-secrets.mjs`: "no run for this commit" and "I could not
 * read the answer" are different facts, and reporting the second as the first
 * is how a check reports health it cannot vouch for. A run with no
 * configuration version is not an unrecognised shape — CLI-driven runs have
 * none — so those are skipped rather than thrown on.
 *
 * Returns the newest matching run, or null when the payload was readable and
 * nothing matched.
 */
export function selectRunForCommit(payload, sha) {
  const wanted = String(sha ?? '').trim().toLowerCase();
  if (!wanted) throw new Error('selectRunForCommit needs a commit sha');

  if (!payload || !Array.isArray(payload.data)) {
    throw new Error(
      'HCP Terraform returned a runs payload with no `data` array. Expected JSON:API from ' +
        '/workspaces/:id/runs — this tool cannot tell whether a run exists for the commit.'
    );
  }
  if (!Array.isArray(payload.included)) {
    throw new Error(
      'HCP Terraform returned no `included` section, so configuration versions and their ' +
        'commit shas could not be resolved. The request must carry ' +
        'include=configuration_version.ingress_attributes.'
    );
  }

  const byId = new Map();
  for (const resource of payload.included) {
    if (resource?.id) byId.set(`${resource.type}:${resource.id}`, resource);
  }

  const matches = [];
  for (const run of payload.data) {
    const cvRef = run?.relationships?.['configuration-version']?.data;
    // CLI-driven runs carry no configuration version. Not a shape problem.
    if (!cvRef?.id) continue;

    const cv = byId.get(`${cvRef.type ?? 'configuration-versions'}:${cvRef.id}`);
    if (!cv) continue;

    const iaRef = cv.relationships?.['ingress-attributes']?.data;
    if (!iaRef?.id) continue;

    const ia = byId.get(`${iaRef.type ?? 'ingress-attributes'}:${iaRef.id}`);
    const commit = ia?.attributes?.['commit-sha'];
    if (typeof commit !== 'string') continue;

    if (commit.toLowerCase() === wanted) matches.push(run);
  }

  if (matches.length === 0) return null;

  // Newest first. A pull request head is usually planned once, but a re-run or
  // a retried plan gives the same commit two runs and the later one is the one
  // a reviewer is looking at.
  matches.sort((a, b) =>
    String(b.attributes?.['created-at'] ?? '').localeCompare(String(a.attributes?.['created-at'] ?? ''))
  );
  return matches[0];
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

async function tfc(token, path, { raw = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' },
    // `json-output` answers 307 to a short-lived archivist URL; fetch follows
    // redirects by default, which is what we want.
  });

  // 401 and 403 both mean "the token is the problem", and HCP Terraform picks
  // between them by case rather than by convention: an invalid or revoked token
  // answers 403 here, which was confirmed by running this against a junk token
  // rather than assumed. Handling only 401 would have left the common case
  // falling through to a bare status code.
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `HCP Terraform refused the token (${response.status}) on ${path}. It is invalid, revoked, ` +
        `or has no access to ${ORGANIZATION}/${WORKSPACE}. Mint a user token at ` +
        'https://app.terraform.io/app/settings/tokens'
    );
  }
  if (response.status === 404) {
    // Two causes, and the message used to assert only the second. On
    // 2026-08-30 an operator passed a run id without its `run-` prefix and was
    // told the TOKEN lacked admin access — which would have sent them
    // regenerating a token that was fine. The permissions cause is real and
    // subtle enough to be worth explaining, but it is not the FIRST thing to
    // suspect when the caller supplied an identifier.
    throw new Error(
      `404 on ${path}.\n\n` +
        'Most likely the identifier is wrong — check it character for character against the ' +
        'HCP Terraform URL, including its `run-` prefix.\n\n' +
        `Failing that, the token may lack ADMIN access to ${ORGANIZATION}/${WORKSPACE}: this ` +
        'endpoint answers 404 rather than 403 for an under-privileged token, and an ' +
        'organization token always lands here. Use a user or team token from ' +
        'https://app.terraform.io/app/settings/tokens'
    );
  }
  if (!response.ok) {
    throw new Error(`HCP Terraform returned ${response.status} on ${path}`);
  }
  return raw ? response.json() : (await response.json()).data;
}

async function main() {
  const token = process.env.TFC_TOKEN ?? arg('token');
  if (!token) {
    console.error(
      'No token. Set TFC_TOKEN, or pass --token, using a USER or TEAM token from\n' +
        'https://app.terraform.io/app/settings/tokens — an organization token cannot read\n' +
        'json-output and fails with 404, which reads like a missing plan.'
    );
    return 2;
  }

  let run;
  const runId = normaliseRunId(arg('run'));
  const commit = (arg('commit') ?? '').trim();

  if (runId && commit) {
    console.error('Pass --run or --commit, not both: they select the same thing two ways.');
    return 2;
  }

  if (runId) {
    run = await tfc(token, `/runs/${runId}`);
  } else if (commit) {
    const workspace = await tfc(token, `/organizations/${ORGANIZATION}/workspaces/${WORKSPACE}`);
    // 50 rather than 1: the commit's run is not necessarily the newest, and
    // this window has to span whatever else ran alongside it.
    const payload = await tfc(
      token,
      `/workspaces/${workspace.id}/runs?page%5Bsize%5D=50&include=configuration_version.ingress_attributes`,
      { raw: true }
    );
    run = selectRunForCommit(payload, commit);
    if (!run) {
      // NOT 0. "I found no run for this commit" is not "the plan is boring",
      // and answering the second question when asked the first is how a check
      // goes green without checking anything.
      console.error(
        `\nNo run in the last 50 for commit ${commit}.\n\n` +
          'Either HCP Terraform has not planned it yet — a speculative plan lags the push by a ' +
          'minute or two — or the commit never reached the workspace. Re-run once the run ' +
          `appears at https://app.terraform.io/app/${ORGANIZATION}/workspaces/${WORKSPACE}/runs`
      );
      return 2;
    }
  } else {
    const workspace = await tfc(token, `/organizations/${ORGANIZATION}/workspaces/${WORKSPACE}`);
    const runs = await tfc(token, `/workspaces/${workspace.id}/runs?page%5Bsize%5D=1`);
    if (!runs?.length) throw new Error(`No runs found in ${ORGANIZATION}/${WORKSPACE}.`);
    run = runs[0];
  }

  console.log(`run     : ${run.id}`);
  console.log(`status  : ${run.attributes.status}`);
  console.log(`message : ${run.attributes.message ?? ''}`);
  console.log(`created : ${run.attributes['created-at']}`);

  // The question this tool is dispatched to answer is "is the plan I am about
  // to confirm boring?". Without --run it resolves the workspace's LATEST run,
  // which is whatever ran last — and on 2026-08-30 that was an apply from
  // seventeen hours earlier. It reported UNEXPECTED, correctly, about history,
  // in the same voice it would use for a plan awaiting a decision.
  //
  // The status line above was already printed and was already easy to miss, so
  // the distinction is stated rather than left to be inferred. It is
  // deliberately NOT an error — reading an applied run is a legitimate thing to
  // do, and refusing would remove the only way to ask "what did we actually
  // apply?".
  const status = run.attributes.status;
  const awaiting = AWAITING_DECISION.has(status);

  // A stable, machine-readable line for the workflow, which decides whether an
  // UNEXPECTED verdict should turn the job red. It should not, on a run nobody
  // is being asked to confirm: this tool exists to gate a decision, and when
  // there is no decision to gate, red is a claim it has not earned. A red that
  // means nothing is how a check stops being read.
  console.log(`awaiting-decision: ${awaiting ? 'yes' : 'no'}`);

  if (!awaiting) {
    console.log('');
    console.log(`NOTE: this run is ${status} — not a plan awaiting your decision.`);
    console.log(
      FINISHED.has(status)
        ? '      It already finished, so the verdict below describes history.'
        : '      It is still running, so the verdict below is not final.'
    );
    console.log('      Pass --run <id> to check a specific run.');
  }

  const planId = run.relationships?.plan?.data?.id;
  if (!planId) {
    console.error(`\nRun ${run.id} has no plan yet (status ${run.attributes.status}).`);
    return 2;
  }

  const plan = await tfc(token, `/plans/${planId}`);
  const a = plan.attributes;
  console.log(
    `\nsummary : ${a['resource-additions']} to add, ${a['resource-changes']} to change, ` +
      `${a['resource-destructions']} to destroy`
  );
  // Said out loud because the summary is the thing people approve on, and it
  // cannot answer the question. The azapi read-then-strip pair working around
  // azurerm#29149 means every plan reports a diff; three DIFFERENT replacements
  // would produce the same three numbers as the expected ones.
  console.log('          (the counts are not the check — the addresses are)');

  const json = await tfc(token, `/plans/${planId}/json-output`, { raw: true });

  let result;
  try {
    result = checkPlan(json);
  } catch (error) {
    console.error(`\nmalformed plan: ${error.message}`);
    return 2;
  }

  if (result.ok) {
    console.log('\nOK — the plan carries the known permanent diff and nothing else:');
    for (const address of EXPECTED.replaced) console.log(`     replace  ${address}`);
    for (const { address, attribute } of EXPECTED.updated) {
      console.log(`     update   ${address} (${attribute})`);
    }
    return 0;
  }

  console.error('');
  for (const line of result.unexpected) console.error(`UNEXPECTED  ${line}`);
  for (const address of result.missing) {
    console.error(
      `MISSING     ${address}: expected to be replaced every apply. If #29149 has closed, ` +
        'remove the azapi pair and assert-expected-plan.mjs together.'
    );
  }
  console.error('\nDo not approve this plan on the shape of the summary line. Read each change.');
  return 1;
}

// Guarded so the module can be IMPORTED without running. Unguarded, importing
// it to read an export fired main(), which reached for the network and then
// called process.exit — inside a test runner that traps process.exit and
// reports an unhandled rejection. Surfaced by check-tfc-plan.test.mjs on
// 2026-08-30, the first time anything imported this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n${error.message}`);
      process.exit(2);
    });
}
