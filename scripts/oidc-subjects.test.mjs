/**
 * Every workflow that logs into Azure must present a subject some federated
 * credential actually trusts.
 *
 * This exists because that stopped being true and nothing noticed. `de99aa0`
 * put deploy-functions.yml behind `environment: production` to gate production
 * deploys — correct in itself, with a consequence nothing accounted for:
 * declaring an environment CHANGES the OIDC subject GitHub composes, from
 * repo:<org>/<repo>:ref:<ref> to repo:<org>/<repo>:environment:<name>. No
 * credential matched the new subject, so every production deploy failed at
 * azure/login with AADSTS700213.
 *
 * It stayed invisible for a day because no deploy ran in between. That is the
 * property worth defending against: the failure is silent until someone
 * deploys, and by then it reads as a permissions problem rather than as a
 * consequence of a workflow edit. A `terraform validate` cannot catch it —
 * both files are individually valid — and neither can any linter that looks at
 * one file at a time. The check has to be a cross-reference, which is what this
 * is.
 *
 * Deliberately regex-based rather than YAML/HCL parsed. Adding a parser
 * dependency to catch a two-line pattern costs more than it returns, and the
 * shapes matched here are the ones the repository actually writes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');

/** Subjects trusted by the deploy identity, as declared in infra/oidc.tf. */
function trustedSubjects() {
  const hcl = readFileSync(join(REPO, 'infra', 'oidc.tf'), 'utf8');
  return [...hcl.matchAll(/^\s*subject\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** Workflows that authenticate to Azure with OIDC, and the environment (if any) they name. */
function azureLoginWorkflows() {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({ file, text: readFileSync(join(WORKFLOWS, file), 'utf8') }))
    .filter(({ text }) => /uses:\s*azure\/login@/.test(text))
    .map(({ file, text }) => {
      const envs = [...text.matchAll(/^\s{4}environment:\s*([A-Za-z0-9._-]+)\s*$/gm)].map(
        (m) => m[1]
      );
      return { file, environments: [...new Set(envs)] };
    });
}

describe('OIDC federated credentials cover every Azure login', () => {
  const subjects = trustedSubjects();
  const workflows = azureLoginWorkflows();

  it('finds the workflows and the credentials at all', () => {
    // A silently empty scan would make every assertion below vacuously pass,
    // which is the way a cross-reference check rots.
    expect(workflows.length).toBeGreaterThan(0);
    expect(subjects.length).toBeGreaterThan(0);
  });

  it.each(workflows)('$file presents a trusted subject', ({ file, environments }) => {
    if (environments.length === 0) {
      // No environment named, so GitHub composes the ref form.
      const refSubjects = subjects.filter((s) => s.includes(':ref:'));
      expect(
        refSubjects.length,
        `${file} logs into Azure without an environment, so it presents a ` +
          `repo:<org>/<repo>:ref:<ref> subject, and infra/oidc.tf declares no ref credential.`
      ).toBeGreaterThan(0);
      return;
    }

    for (const env of environments) {
      const matching = subjects.filter((s) => s.endsWith(`:environment:${env}`));
      expect(
        matching.length,
        `${file} declares "environment: ${env}", so GitHub composes the subject ` +
          `repo:<org>/<repo>:environment:${env} — NOT the ref form. infra/oidc.tf ` +
          `trusts no such subject, so azure/login will fail with AADSTS700213. ` +
          `Add an azurerm_federated_identity_credential for it (both the name and ` +
          `immutable-ID forms).\nTrusted today:\n  ${subjects.join('\n  ')}`
      ).toBeGreaterThan(0);
    }
  });

  it('trusts each environment in both the name and immutable-ID forms', () => {
    // GitHub composes the subject with numeric org/repo IDs embedded; the
    // repository trusts both forms deliberately (see infra/oidc.tf). One
    // without the other is half a credential and fails on whichever form the
    // token happens to carry.
    const envNames = [
      ...new Set(
        subjects
          .map((s) => s.match(/:environment:(.+)$/))
          .filter(Boolean)
          .map((m) => m[1])
      ),
    ];
    for (const env of envNames) {
      const forms = subjects.filter((s) => s.endsWith(`:environment:${env}`));
      // The immutable form is written via the `github_immutable_prefix` local,
      // so the numeric IDs never appear in the literal here — matching on '@'
      // would report every immutable credential as missing. Match the prefix
      // expression instead, which is what the HCL actually contains.
      const immutable = forms.filter((s) => s.startsWith('${local.github_immutable_prefix}'));
      const named = forms.filter((s) => s.startsWith('repo:${var.github_org}'));
      expect(named.length, `environment:${env} has no name-form credential`).toBeGreaterThan(0);
      expect(
        immutable.length,
        `environment:${env} has no immutable-ID-form credential`
      ).toBeGreaterThan(0);
    }
  });
});
