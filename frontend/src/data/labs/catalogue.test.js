/**
 * The lab catalogue is data the page trusts without checking, so this is
 * where it is checked (#681): every row has every field with the right shape,
 * ids are unique and usable as a Coder parameter, tools come from the image's
 * toolchain, and the deep link carries the row's own id.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CODER_APPS_ORIGIN,
  CODER_GITHUB_SIGN_IN_PATH,
  CODER_ORIGIN,
  LAB_FIELDS,
  LAB_TEMPLATE,
  LAB_TOOLS,
  RUN_LOCALLY_COMMANDS,
  coderSignInUrl,
  coderWorkspaceUrl,
  labById,
  labPanePath,
  labs,
} from './catalogue';

describe('lab catalogue', () => {
  it('has the three first labs', () => {
    expect(labs.map((lab) => lab.id)).toEqual([
      'landing-zone-builder-output',
      'terraform-validate-walkthrough',
      'ansible-syntax-check-walkthrough',
    ]);
  });

  it.each(labs.map((lab) => [lab.id, lab]))('%s carries every field', (id, lab) => {
    for (const field of LAB_FIELDS) {
      expect(lab, `${id} is missing ${field}`).toHaveProperty(field);
    }
    expect(Object.keys(lab).sort()).toEqual([...LAB_FIELDS].sort());

    expect(lab.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(lab.title.trim().length).toBeGreaterThan(0);
    expect(lab.summary.trim().length).toBeGreaterThan(40);
    expect(lab.tools.length).toBeGreaterThan(0);
    for (const tool of lab.tools) {
      expect(LAB_TOOLS, `${id} names a tool the image does not ship: ${tool}`).toContain(tool);
    }
    expect(lab.template).toBe(LAB_TEMPLATE);
    expect(lab.params).toEqual({ lab: id });
    expect(Array.isArray(lab.articleSlugs)).toBe(true);
    expect(Number.isInteger(lab.estimatedMinutes)).toBe(true);
    expect(lab.estimatedMinutes).toBeGreaterThan(0);
  });

  it('gives no two labs the same id', () => {
    const ids = labs.map((lab) => lab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is frozen, rows included', () => {
    expect(Object.isFrozen(labs)).toBe(true);
    for (const lab of labs) {
      expect(Object.isFrozen(lab), `${lab.id} is mutable`).toBe(true);
      expect(Object.isFrozen(lab.tools)).toBe(true);
      expect(Object.isFrozen(lab.params)).toBe(true);
    }
  });
});

describe('coderWorkspaceUrl', () => {
  it('deep-links every lab to its own workspace parameter', () => {
    for (const lab of labs) {
      expect(coderWorkspaceUrl(lab)).toBe(
        `${CODER_ORIGIN}/templates/hcw-lab/workspace?mode=auto&param.lab=${lab.id}`
      );
    }
  });

  it('encodes a template or id that is not a plain path segment', () => {
    const url = coderWorkspaceUrl({ template: 'a b', params: { lab: 'x&y' } });
    expect(url).toBe(`${CODER_ORIGIN}/templates/a%20b/workspace?mode=auto&param.lab=x%26y`);
  });
});

describe('the pane page and its sign-in (#751)', () => {
  it('gives every lab a pane page under /education/labs', () => {
    for (const lab of labs) {
      expect(labPanePath(lab.id)).toBe(`/education/labs/${lab.id}`);
    }
    expect(labPanePath('a/b?c')).toBe('/education/labs/a%2Fb%3Fc');
  });

  it('finds a lab by id, and nothing for an id the catalogue does not have', () => {
    for (const lab of labs) expect(labById(lab.id)).toBe(lab);
    expect(labById('no-such-lab')).toBeNull();
    expect(labById(undefined)).toBeNull();
  });

  it('starts GitHub sign-in at the one path #750 lets through at the top level', () => {
    expect(CODER_GITHUB_SIGN_IN_PATH).toBe('/api/v2/users/oauth2/github/callback');
    expect(coderSignInUrl()).toBe(
      'https://coder.lab.hybridcloudworks.com/api/v2/users/oauth2/github/callback?redirect=%2F'
    );
  });

  it('keeps the sign-in path in step with the Caddy exemption it relies on', () => {
    // #750's exemption is lab-host's to change; if it moves, this page's
    // sign-in tab would be redirected before GitHub is ever reached.
    const caddy = readFileSync(
      join(process.cwd(), '..', 'lab-host/ansible/roles/coder/templates/10-coder.caddy.j2'),
      'utf8'
    );
    expect(caddy).toContain(`path ${CODER_GITHUB_SIGN_IN_PATH}\n`);
  });

  it('names the apps origin one label below Coder, and nothing broader', () => {
    expect(CODER_APPS_ORIGIN).toBe(CODER_ORIGIN.replace('https://', 'https://*.'));
  });
});

describe('RUN_LOCALLY_COMMANDS', () => {
  it('is PowerShell then bash, with the exact lines the page prints', () => {
    expect(RUN_LOCALLY_COMMANDS.map((entry) => entry.shell)).toEqual(['PowerShell', 'bash']);
    expect(RUN_LOCALLY_COMMANDS[0].command).toBe(
      'docker run --rm -it -v ${PWD}:/workspace ghcr.io/hybridcloudworks/hcw-lab:latest'
    );
    expect(RUN_LOCALLY_COMMANDS[1].command).toBe(
      'docker run --rm -it -v "$PWD":/workspace ghcr.io/hybridcloudworks/hcw-lab:latest'
    );
  });

  it('carries no comment inside a command', () => {
    for (const { command } of RUN_LOCALLY_COMMANDS) {
      expect(command).not.toMatch(/#/);
      expect(command).not.toMatch(/\n/);
    }
  });
});
