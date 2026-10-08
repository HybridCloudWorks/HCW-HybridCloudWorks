/**
 * The owner and the two numeric IDs every OIDC subject in infra/oidc.tf is
 * built from, checked against the repository a GitHub Actions run is in.
 *
 * scripts/oidc-subjects.test.mjs proves that workflows and credentials agree
 * with EACH OTHER. It cannot see both of them going stale together, and that
 * is what a transfer does: on 2026-10-07 the repository moved from the
 * HybridCloudWorks organisation (owner ID 312844660) to the personal account
 * saulpatinojr (34853639). Every file stayed consistent, every test stayed
 * green, and every azure/login failed with AADSTS700213 from the next
 * scheduled run, because GitHub now presented an owner nothing trusted.
 *
 * GitHub hands every job the values it composes the subject from
 * (GITHUB_REPOSITORY, GITHUB_REPOSITORY_OWNER_ID, GITHUB_REPOSITORY_ID), so CI
 * can compare them with oidc.tf directly.
 *
 * Dependency-free and runnable on its own because a transfer changes no file.
 * The scripts row in ci.yml runs its test suite only when its path filter
 * matches, so the pull request that should catch a transfer, a docs-only one
 * say, would skip the suite. ci.yml therefore runs this file on every pull
 * request, and the test imports the same functions, so there is one
 * implementation and two ways in (Copilot review on #1001).
 *
 * A push CI run inside a fork fails it, correctly: a fork's tokens match none
 * of these credentials either. A pull request from a fork runs in this
 * repository's context and passes.
 *
 *   node scripts/check-oidc-owner.mjs
 *
 * Off Actions it checks the files against each other only, and says so.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What infra/ and the lab image workflow say the repository is.
 *
 * @param {string} [root] repository root
 * @returns {{ owner?: string, ownerId?: string, repo?: string, repoId?: string, expectedRule?: string }}
 */
export function readOidcIdentity(root = REPO) {
  const hcl = readFileSync(join(root, 'infra', 'oidc.tf'), 'utf8');
  const variables = readFileSync(join(root, 'infra', 'variables.tf'), 'utf8');
  const lab = readFileSync(join(root, '.github', 'workflows', 'publish-lab-image.yml'), 'utf8');

  const prefix = hcl.match(
    /github_immutable_prefix\s*=\s*"repo:\$\{var\.github_org\}@(\d+)\/\$\{var\.github_repo\}@(\d+)"/
  );
  const defaultOf = (name) =>
    variables.match(new RegExp(String.raw`variable\s+"${name}"\s*\{[\s\S]*?default\s*=\s*"([^"]+)"`))?.[1];

  return {
    owner: defaultOf('github_org'),
    ownerId: prefix?.[1],
    repo: defaultOf('github_repo'),
    repoId: prefix?.[2],
    expectedRule: lab.match(/^\s*EXPECTED_RULE:\s*(\S+)/m)?.[1],
  };
}

/** The subject a job on `main` with no environment presents. */
export function mainSubject({ owner, ownerId, repo, repoId }) {
  return `repo:${owner}@${ownerId}/${repo}@${repoId}:ref:refs/heads/main`;
}

/**
 * Every disagreement, as a sentence naming the file to change. Empty when the
 * files agree with each other and, given an Actions environment, with the run.
 *
 * @param {ReturnType<typeof readOidcIdentity>} identity
 * @param {Record<string, string | undefined>} [env] process.env on Actions; omit to skip the run comparison
 * @returns {string[]}
 */
export function identityMismatches(identity, env) {
  const problems = [];
  if (!identity.ownerId || !identity.repoId) {
    problems.push('github_immutable_prefix in infra/oidc.tf no longer has the shape repo:${var.github_org}@<id>/${var.github_repo}@<id>.');
  }
  if (!identity.owner || !identity.repo) {
    problems.push('infra/variables.tf has no default for github_org or github_repo.');
  }
  // Docker Home holds the real rule, out of reach of any check. This is the
  // copy publish-lab-image.yml prints beside a refused exchange, and the
  // runbook's rule; if it drifts from oidc.tf the diagnosis points the owner
  // at the wrong string.
  if (identity.expectedRule !== mainSubject(identity)) {
    problems.push(
      `EXPECTED_RULE in .github/workflows/publish-lab-image.yml is ${identity.expectedRule}, but infra/oidc.tf builds ${mainSubject(identity)}.`
    );
  }
  if (env) {
    const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
    const run = { owner, ownerId: env.GITHUB_REPOSITORY_OWNER_ID, repo, repoId: env.GITHUB_REPOSITORY_ID };
    const where = {
      owner: 'the github_org default in infra/variables.tf',
      ownerId: 'the owner ID in github_immutable_prefix, infra/oidc.tf',
      repo: 'the github_repo default in infra/variables.tf',
      repoId: 'the repository ID in github_immutable_prefix, infra/oidc.tf',
    };
    for (const key of Object.keys(where)) {
      if (identity[key] !== run[key]) {
        problems.push(`${where[key]} is ${identity[key]}, but this run's repository has ${run[key]}. Every azure/login fails with AADSTS700213 until they match.`);
      }
    }
  }
  return problems;
}

/** True on a GitHub Actions runner that provides the repository IDs. */
export function onActions(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' && Boolean(env.GITHUB_REPOSITORY_OWNER_ID);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const identity = readOidcIdentity();
  const actions = onActions();
  const problems = identityMismatches(identity, actions ? process.env : undefined);
  for (const problem of problems) {
    console.log(actions ? `::error::${problem}` : `FAIL ${problem}`);
  }
  if (problems.length === 0) {
    console.log(`OK ${mainSubject(identity)}`);
    if (!actions) console.log('Not on GitHub Actions: checked the files against each other, not against a run.');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
