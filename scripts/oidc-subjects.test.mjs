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
 *
 * ## Per identity since T-728
 *
 * This used to collect every `subject = "..."` in oidc.tf into one pool and ask
 * whether SOMETHING trusted the form a workflow presents. That was sound while
 * one identity served every workflow. It stopped being sound the moment a second
 * one appeared: a reader workflow that sends READER_CLIENT_ID needs a credential
 * on the READER identity, and a pooled check would have been satisfied by the
 * deploy identity's ref credential — passing green while every monitor failed at
 * azure/login with AADSTS700213.
 *
 * So credentials are attributed to the identity their
 * `user_assigned_identity_id` names, workflows are attributed to the identity
 * whose client-id variable they send, and the two are matched up. Both identities
 * happen to trust the same ref subject today, which is exactly why the pooled
 * version would have looked fine.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');

/**
 * Subjects trusted by each identity, keyed by the identity's Terraform label.
 *
 * Matched as whole `azurerm_federated_identity_credential` blocks so `subject`
 * and `user_assigned_identity_id` stay associated. Reading them as two flat
 * lists would pair them by position, which is right until someone reorders the
 * attributes inside one block.
 */
function trustedSubjectsByIdentity() {
  const hcl = readFileSync(join(REPO, 'infra', 'oidc.tf'), 'utf8');
  const blocks = [
    ...hcl.matchAll(/resource\s+"azurerm_federated_identity_credential"\s+"\w+"\s*\{([\s\S]*?)\n\}/g),
  ];
  const byIdentity = {};
  for (const [, body] of blocks) {
    const subject = body.match(/^\s*subject\s*=\s*"([^"]+)"/m)?.[1];
    const identity = body.match(
      /^\s*user_assigned_identity_id\s*=\s*azurerm_user_assigned_identity\.(\w+)\.id/m
    )?.[1];
    if (!subject || !identity) continue;
    (byIdentity[identity] ??= []).push(subject);
  }
  return byIdentity;
}

/**
 * Which identity a workflow authenticates as, from the client-id variable it
 * sends. The variable name is the only thing that decides it — both identities
 * trust the same ref subject, so the subject cannot tell them apart.
 */
const IDENTITY_BY_CLIENT_ID_VAR = {
  CLIENT_ID: 'github_deploy',
  READER_CLIENT_ID: 'github_reader',
};

/** Workflows that authenticate to Azure with OIDC: the identity they use, and the environment (if any) they name. */
function azureLoginWorkflows() {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({ file, text: readFileSync(join(WORKFLOWS, file), 'utf8') }))
    .filter(({ text }) => /uses:\s*azure\/login@/.test(text))
    .map(({ file, text }) => {
      const envs = [...text.matchAll(/^\s{4}environment:\s*([A-Za-z0-9._-]+)\s*$/gm)].map(
        (m) => m[1]
      );
      const vars = [
        ...new Set(
          [...text.matchAll(/client-id:\s*\$\{\{\s*vars\.([A-Z0-9_]+)\s*\}\}/g)].map((m) => m[1])
        ),
      ];
      return { file, environments: [...new Set(envs)], clientIdVars: vars };
    });
}

describe('OIDC federated credentials cover every Azure login', () => {
  const byIdentity = trustedSubjectsByIdentity();
  const workflows = azureLoginWorkflows();
  const allSubjects = Object.values(byIdentity).flat();

  it('finds the workflows and the credentials at all', () => {
    // A silently empty scan would make every assertion below vacuously pass,
    // which is the way a cross-reference check rots.
    expect(workflows.length).toBeGreaterThan(0);
    expect(allSubjects.length).toBeGreaterThan(0);
    expect(Object.keys(byIdentity).length).toBeGreaterThan(0);
  });

  it.each(workflows)('$file names exactly one known client-id variable', ({ file, clientIdVars }) => {
    // Two would mean two jobs authenticating as different identities in one
    // file, which nothing here does and which the per-workflow checks below
    // would then only half cover. An unknown one means a variable this test
    // cannot attribute to an identity — it would silently check nothing.
    expect(clientIdVars.length, `${file} sends ${clientIdVars.length} client-id variables`).toBe(1);
    expect(
      IDENTITY_BY_CLIENT_ID_VAR[clientIdVars[0]],
      `${file} authenticates with vars.${clientIdVars[0]}, which this test cannot map to an ` +
        `identity in infra/oidc.tf. Add it to IDENTITY_BY_CLIENT_ID_VAR, or the workflow's ` +
        'credentials go unchecked.'
    ).toBeDefined();
  });

  it.each(workflows)(
    '$file presents a subject its own identity trusts',
    ({ file, environments, clientIdVars }) => {
      const identity = IDENTITY_BY_CLIENT_ID_VAR[clientIdVars[0]];
      const subjects = byIdentity[identity] ?? [];
      const held = `Trusted by ${identity} today:\n  ${subjects.join('\n  ') || '(none)'}`;

      if (environments.length === 0) {
        // No environment named, so GitHub composes the ref form.
        expect(
          subjects.filter((s) => s.includes(':ref:')).length,
          `${file} logs into Azure as ${identity} without an environment, so it presents a ` +
            `repo:<org>/<repo>:ref:<ref> subject, and that identity has no ref credential.\n${held}`
        ).toBeGreaterThan(0);
        return;
      }

      for (const env of environments) {
        expect(
          subjects.filter((s) => s.endsWith(`:environment:${env}`)).length,
          `${file} declares "environment: ${env}", so GitHub composes the subject ` +
            `repo:<org>/<repo>:environment:${env} — NOT the ref form. Identity ${identity} ` +
            `trusts no such subject, so azure/login will fail with AADSTS700213. Add an ` +
            `azurerm_federated_identity_credential for it on THAT identity (both the name and ` +
            `immutable-ID forms).\n${held}`
        ).toBeGreaterThan(0);
      }
    }
  );

  it('trusts each subject in both the name and immutable-ID forms, per identity', () => {
    // GitHub composes the subject with numeric org/repo IDs embedded; the
    // repository trusts both forms deliberately (see infra/oidc.tf). One
    // without the other is half a credential and fails on whichever form the
    // token happens to carry.
    //
    // Per identity, and covering the ref form too: the reader identity's only
    // credentials are a ref pair, so an environment-only check would have said
    // nothing about it at all.
    const missing = [];
    for (const [identity, subjects] of Object.entries(byIdentity)) {
      const suffixes = [
        ...new Set(subjects.map((s) => s.replace(/^repo:\$\{var\.github_org\}[^:]*|^\$\{local\.github_immutable_prefix\}/, ''))),
      ];
      for (const suffix of suffixes) {
        const forms = subjects.filter((s) => s.endsWith(suffix));
        // The immutable form is written via the `github_immutable_prefix` local,
        // so the numeric IDs never appear in the literal here — matching on '@'
        // would report every immutable credential as missing. Match the prefix
        // expression instead, which is what the HCL actually contains.
        if (!forms.some((s) => s.startsWith('${local.github_immutable_prefix}'))) {
          missing.push(`${identity} ${suffix}: no immutable-ID-form credential`);
        }
        if (!forms.some((s) => s.startsWith('repo:${var.github_org}'))) {
          missing.push(`${identity} ${suffix}: no name-form credential`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
