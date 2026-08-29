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

import { EXPECTED, checkPlan } from './assert-expected-plan.mjs';

const API = 'https://app.terraform.io/api/v2';
const ORGANIZATION = 'hcw';
const WORKSPACE = 'hcw-azure';

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
    throw new Error(
      `404 on ${path}. Either the path is wrong, or the token lacks ADMIN access to ` +
        `${ORGANIZATION}/${WORKSPACE}. This endpoint answers 404 rather than 403 for an ` +
        'under-privileged token, and an organization token always lands here — use a user or ' +
        'team token from https://app.terraform.io/app/settings/tokens'
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
  const runId = arg('run');
  if (runId) {
    run = await tfc(token, `/runs/${runId}`);
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

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(2);
  });
