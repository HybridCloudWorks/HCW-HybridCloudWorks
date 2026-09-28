/**
 * The visitor report for a public "Validate on the lab" job (owner request
 * 2026-09-28). The fixtures in ./fixtures are the owner's first public run,
 * from the Landing Zone Builder's default build, as the job log recorded it:
 *
 *   validate-valid.log     the run as it was: the image pull, six module
 *                          rewrites, init, "Success! The configuration is
 *                          valid."
 *   validate-invalid.log   the same run with Terraform errors injected into
 *                          the validate section: two in the learner's files
 *                          and one inside the lab's copy of a module.
 *   validate-not-run.log   a job that failed before Terraform ran: the image
 *                          could not be pulled.
 *
 * What must hold: the verdict comes first in plain words, Terraform's own
 * errors keep the learner's file names and line numbers, the modules are
 * `name@version` without paths, the providers lose "(unauthenticated)", and
 * nothing in the report names the runner, its image, its paths or the host,
 * whatever else the log carries.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  LAB_INTERNALS,
  MAX_REPORTED_ERRORS,
  REPORT_LINES,
  buildVisitorReport,
  labInternalsIn,
  parseValidateOutput,
} from './visitor-report.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const VALID_LOG = fixture('validate-valid.log');
const INVALID_LOG = fixture('validate-invalid.log');
const NOT_RUN_LOG = fixture('validate-not-run.log');

const MODULES = [
  'avm-ptn-alz@0.21.0',
  'avm-res-network-virtualnetwork@0.22.2',
  'avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5',
  'avm-ptn-alz-management@0.9.0',
];
const PROVIDERS = [
  'azure/azapi v2.12.0',
  'hashicorp/azurerm v4.81.0',
  'azure/modtm v0.4.0',
  'hashicorp/random v3.9.1',
  'hashicorp/time v0.14.2',
  'azure/alz v0.22.0',
];

/** Everything the owner found on the page that a visitor must not read. */
function expectNothingInternal(report) {
  const text = JSON.stringify(report);
  expect(labInternalsIn(text)).toEqual([]);
  expect(text).not.toContain('(unauthenticated)');
  expect(text).not.toMatch(/Pulling|Digest|Status: Downloaded|Already exists/);
}

describe('the owner’s run', () => {
  it('reads as valid, with the modules and providers the lab used and nothing else', () => {
    const report = buildVisitorReport({ status: 'succeeded', exitCode: 0, output: VALID_LOG });
    expect(report).toEqual({
      verdict: 'valid',
      headline: REPORT_LINES.valid,
      errors: [],
      modules: MODULES,
      modulesNote: REPORT_LINES.modulesNote,
      providers: PROVIDERS,
    });
    expectNothingInternal(report);
  });

  it('with errors injected, reads as invalid with Terraform’s own words, the learner’s files kept', () => {
    const report = buildVisitorReport({ status: 'failed', exitCode: 1, output: INVALID_LOG });
    expect(report.verdict).toBe('invalid');
    expect(report.headline).toBe(REPORT_LINES.invalidMany);
    expect(report.errors).toEqual([
      [
        'Error: Unsupported argument',
        '',
        '  on alz.tf line 14, in module "alz":',
        '  14:   enable_telemetry_typo = var.enable_telemetry',
        '',
        'An argument named "enable_telemetry_typo" is not expected here.',
      ].join('\n'),
      [
        'Error: Reference to undeclared input variable',
        '',
        '  on management.tf line 9, in module "management":',
        '   9:   location = var.primary_locaton',
        '',
        'An input variable with the name "primary_locaton" has not been declared. This',
        'variable can be declared with a variable "primary_locaton" {} block.',
      ].join('\n'),
      [
        'Error: Unsupported argument',
        '',
        '  on avm-ptn-alz-management@0.9.0/main.tf line 40, in resource "azurerm_log_analytics_workspace" "this":',
        '  40:   daily_quota_gb_typo = var.log_analytics_workspace_daily_quota_gb',
        '',
        'An argument named "daily_quota_gb_typo" is not expected here.',
      ].join('\n'),
    ]);
    expect(report.modules).toEqual(MODULES);
    expect(report.providers).toEqual(PROVIDERS);
    expectNothingInternal(report);
  });

  it('failing before Terraform ran, says the lab could not run the check and shows none of the log', () => {
    const report = buildVisitorReport({ status: 'failed', exitCode: 125, output: NOT_RUN_LOG });
    expect(report).toEqual({
      verdict: 'error',
      headline: REPORT_LINES.notRun,
      errors: [],
      modules: [],
      modulesNote: null,
      providers: [],
    });
    expectNothingInternal(report);
  });
});

describe('the verdict', () => {
  it.each(['queued', 'claimed', 'running', undefined, 'odd'])(
    'is not given for a job that is %s',
    (status) => {
      expect(buildVisitorReport({ status, output: VALID_LOG })).toBeNull();
    }
  );

  it('trusts the exit code: succeeded is valid even when the log says nothing', () => {
    expect(buildVisitorReport({ status: 'succeeded', exitCode: 0, output: null })).toMatchObject({
      verdict: 'valid',
      errors: [],
      modules: [],
      modulesNote: null,
      providers: [],
    });
  });

  it('keeps a valid run valid when Terraform warns, and shows no warning', () => {
    const output = VALID_LOG.replace(
      'Success! The configuration is valid.',
      [
        '',
        'Warning: Argument is deprecated',
        '',
        '  on ../../../opt/avm/avm-ptn-alz@0.21.0/main.tf line 3:',
        '',
        'Use something else.',
        '',
        'Success! The configuration is valid, but there were some validation warnings as shown above.',
      ].join('\n')
    );
    const report = buildVisitorReport({ status: 'succeeded', exitCode: 0, output });
    expect(report.verdict).toBe('valid');
    expect(report.errors).toEqual([]);
    expectNothingInternal(report);
  });

  it.each([
    ['timeout', REPORT_LINES.timeout],
    ['cancelled', REPORT_LINES.cancelled],
  ])('words a job that ended as %s', (status, headline) => {
    expect(buildVisitorReport({ status, output: VALID_LOG })).toMatchObject({
      verdict: 'error',
      headline,
      errors: [],
    });
  });

  it('says one error in the singular', () => {
    const one = INVALID_LOG.split('\nError: Reference to undeclared input variable')[0];
    const report = buildVisitorReport({ status: 'failed', exitCode: 1, output: one });
    expect(report.errors).toHaveLength(1);
    expect(report.headline).toBe(REPORT_LINES.invalidOne);
  });

  it('carries at most MAX_REPORTED_ERRORS errors', () => {
    const many = Array.from(
      { length: MAX_REPORTED_ERRORS + 5 },
      (_, i) => `\nError: Unsupported argument\n\n  on main.tf line ${i + 1}:\n\nNot expected here.\n`
    ).join('');
    const report = buildVisitorReport({
      status: 'failed',
      output: `== terraform validate\n${many}`,
    });
    expect(report.errors).toHaveLength(MAX_REPORTED_ERRORS);
    expect(report.errors[0]).toContain('on main.tf line 1:');
  });
});

describe('Terraform stopping for the lab, not the configuration', () => {
  const INIT_FAILED = [
    '== module sources (1 registry module block(s) in the payload)',
    '  left    module "x" (Azure/avm-res-storage-storageaccount/azurerm ~> 9.0): no vendored version satisfies it (have: none vendored)',
    '',
    '== terraform init -backend=false',
    'Initializing the backend...',
    'Initializing modules...',
    'Downloading registry.terraform.io/Azure/avm-res-storage-storageaccount/azurerm 9.0.0 for x...',
    '',
    'Error: Failed to download module',
    '',
    '  on main.tf line 1:',
    '   1: module "x" {',
    '',
    'Could not download module "x" (main.tf:1) source code from',
    '"https://registry.terraform.io/v1/modules/Azure/avm-res-storage-storageaccount/azurerm/9.0.0/download":',
    'Get "https://registry.terraform.io/.well-known/terraform.json": dial tcp: lookup',
    'registry.terraform.io on 127.0.0.11:53: no such host.',
  ].join('\n');

  it('drops an init error that can only be told with the lab’s hosts, and says what it means', () => {
    const report = buildVisitorReport({ status: 'failed', exitCode: 1, output: INIT_FAILED });
    expect(report).toEqual({
      verdict: 'error',
      headline: REPORT_LINES.initStopped,
      errors: [],
      modules: [],
      modulesNote: null,
      providers: [],
    });
    expectNothingInternal(report);
  });

  it('shows the errors it can, and says when some could not be shown', () => {
    const output = `${INIT_FAILED}\n\nError: Unsupported block type\n\n  on main.tf line 9:\n\nBlocks of type "bogus" are not expected here.\n`;
    const report = buildVisitorReport({ status: 'failed', exitCode: 1, output });
    expect(report.verdict).toBe('invalid');
    expect(report.errors).toEqual([
      'Error: Unsupported block type\n\n  on main.tf line 9:\n\nBlocks of type "bogus" are not expected here.',
    ]);
    expect(report.headline).toBe(`${REPORT_LINES.invalidOne} ${REPORT_LINES.hidden}`);
    expectNothingInternal(report);
  });

  it('says Terraform stopped when validate failed with nothing it could show', () => {
    const output = '== terraform init -backend=false\n== terraform validate\nPanic: something\n';
    expect(buildVisitorReport({ status: 'failed', output }).headline).toBe(
      REPORT_LINES.validateStopped
    );
  });
});

describe('reading the log', () => {
  it('takes only rewrite lines for the modules, never a module left alone or a path', () => {
    const { modules } = parseValidateOutput(
      [
        '== module sources (3 registry module block(s) in the payload)',
        '  rewrote module "a" (Azure/avm-ptn-alz/azurerm ~> 0.21) -> ../../../opt/avm/avm-ptn-alz@0.21.0',
        '  rewrote module "b" (Azure/avm-ptn-alz/azurerm//modules/sub 0.21.0) -> ../../../opt/avm/avm-ptn-alz@0.21.0/modules/sub',
        '  left    module "c" (Azure/avm-foo/azurerm ~> 9.0): no vendored version satisfies it (have: 0.1.0)',
        '  none; nothing rewritten',
      ].join('\n')
    );
    expect(modules).toEqual(['avm-ptn-alz@0.21.0']);
  });

  it('reads a framed diagnostic as well as a plain one', () => {
    const output = [
      '== terraform validate',
      '╷',
      '│ Error: Unsupported argument',
      '│ ',
      '│   on main.tf line 2:',
      '│    2:   bogus = 1',
      '│ ',
      '│ An argument named "bogus" is not expected here.',
      '╵',
      'trailing noise from somewhere',
    ].join('\n');
    expect(buildVisitorReport({ status: 'failed', output }).errors).toEqual([
      'Error: Unsupported argument\n\n  on main.tf line 2:\n   2:   bogus = 1\n\nAn argument named "bogus" is not expected here.',
    ]);
  });

  it('cuts the provider registry’s host out of a provider address', () => {
    const output = [
      '== terraform validate',
      '',
      'Error: Missing required argument',
      '',
      '  with provider["registry.terraform.io/hashicorp/azurerm"],',
      '  on providers.tf line 1:',
      '',
      'The argument "features" is required.',
    ].join('\n');
    const [error] = buildVisitorReport({ status: 'failed', output }).errors;
    expect(error).toContain('provider["hashicorp/azurerm"]');
    expectNothingInternal({ error });
  });

  it('ignores an "Error:" that is not Terraform’s, and reads CRLF and a truncated log', () => {
    const output = [
      'agent error: Error: tar payload: truncated archive',
      'Error: not a Terraform diagnostic, before any section',
      '== terraform validate',
      'Error: Unsupported argument',
      '',
      '  on main.tf line 3:',
      '[output truncated at 64KB]',
    ].join('\r\n');
    expect(buildVisitorReport({ status: 'failed', output }).errors).toEqual([
      'Error: Unsupported argument\n\n  on main.tf line 3:',
    ]);
  });

  it('never lets noise nobody has seen yet through, wherever it lands', () => {
    const noise = [
      'hcw-lab-runner on srv939861 (vps-hostinger-01): layer sha256:abc Pulling from ghcr.io',
      'docker: moved /opt/avm to ../../../opt/avm/x@1.0.0 on the image registry',
    ];
    const lines = INVALID_LOG.split('\n');
    for (const [index] of lines.entries()) {
      for (const line of noise) {
        const output = [...lines.slice(0, index), line, ...lines.slice(index)].join('\n');
        const report = buildVisitorReport({ status: 'failed', exitCode: 1, output });
        expect(labInternalsIn(JSON.stringify(report)), `noise at line ${index}`).toEqual([]);
      }
    }
  });
});

describe('LAB_INTERNALS', () => {
  it.each([
    "Unable to find image 'ghcr.io/hybridcloudworks/hcw-lab-runner:x@sha256:y' locally",
    '7c1f5b8e3a92: Pulling fs layer',
    '- connectivity in ../../../opt/avm/avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5',
    'docker: Error response from daemon',
    'the lab host vps-hostinger-01',
    'srv939861',
    'registry.terraform.io',
  ])('catches %j', (text) => {
    expect(labInternalsIn(text)).not.toEqual([]);
  });

  it.each([
    'avm-ptn-alz@0.21.0',
    'hashicorp/azurerm v4.81.0',
    '  on alz.tf line 14, in module "alz":',
    'source_image_reference and azurerm_container_registry are resource names, not the runner',
    REPORT_LINES.modulesNote,
  ])('passes %j', (text) => {
    expect(labInternalsIn(text)).toEqual([]);
  });

  it('gives every term a reason', () => {
    for (const [why, pattern] of LAB_INTERNALS) {
      expect(why.length).toBeGreaterThan(5);
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});
