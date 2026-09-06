/**
 * Mint a short-lived GitHub App installation token.
 *
 * ## Why this exists rather than `actions/create-github-app-token`
 *
 * T-726: `publish-content-manifest.yml` used to commit straight to `main`. The
 * ruleset refuses that — `pull_request` is one of its rules and it has no
 * bypass actors, verified 2026-08-31 against
 * /repos/HybridCloudWorks/HCW-HybridCloudWorks/rulesets/20680114 — so the push
 * had been failing since the ruleset was updated on 2026-08-25, unnoticed
 * because the manifest had not changed in that window. An App fixes it by
 * opening a pull request instead, and the checks run precisely because the pull
 * request is not opened with `GITHUB_TOKEN`.
 *
 * An earlier version of this header said the ruleset listed the Actions token
 * as a bypass actor and that this script retired that bypass. It did not; there
 * was none. Corrected here rather than deleted, because the wrong version is
 * what justified the stored private key below.
 *
 * The obvious way to get the token is the marketplace action. This repository
 * pins every action by commit SHA, and the SHA could not be resolved from the
 * environment this was written in — guessing one is not an option, and an
 * unpinned action in the job that holds the most powerful credential in the
 * pipeline is the wrong place to make an exception. Thirty lines of `node:crypto`
 * and two `fetch` calls need no pin, no dependency, and can be tested against a
 * key pair generated in the test itself.
 *
 * ## What it grants
 *
 * `contents: write` and `pull_requests: write` on ONE repository, for one hour.
 * It cannot merge past a check and it cannot push to `main`, because the
 * ruleset exempts nobody.
 *
 * This is a NEW stored credential, not a smaller replacement for an existing
 * one — the bypass it was said to replace does not exist. The honest case for
 * it is narrower: the nightly refresh has to reach `main` somehow, every route
 * to `main` goes through a pull request, and a pull request opened with
 * `GITHUB_TOKEN` runs no checks. The key is the price of that, and the
 * scoping below is what keeps the price small.
 *
 * ## Handling
 *
 * The token is printed on stdout and nothing else is, so the caller can capture
 * it. **The caller must mask it before doing anything else with it** — the
 * workflow does this with `::add-mask::` on the line after it is read.
 */
import { createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/**
 * What the manifest publisher's token carries, and the default when a caller
 * names nothing else. copilot-setup-steps.yml overrides it with a read-only set
 * through GITHUB_APP_PERMISSIONS, for the App Copilot code review reads GitHub
 * with — same minter, different App, different ceiling.
 */
export const DEFAULT_PERMISSIONS = Object.freeze({ contents: 'write', pull_requests: 'write' });

/**
 * A permissions object is `{ name: 'read' | 'write' | 'admin', ... }` and
 * nothing else. Anything looser is refused here rather than sent to GitHub,
 * whose 422 would name the App rather than the typo.
 *
 * The result is a null-prototype copy, never the parsed object itself:
 * JSON.parse happily produces keys named __proto__, constructor or prototype,
 * and an object carrying them is a prototype-pollution vector the moment
 * anything merges or walks it. Those three names match the permission-name
 * shape (lowercase and underscores), so they are refused by name as well.
 */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parsePermissions(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('GITHUB_APP_PERMISSIONS must be a JSON object such as {"contents":"read"}.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GITHUB_APP_PERMISSIONS must be a non-empty JSON object of permission names to levels.');
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error('GITHUB_APP_PERMISSIONS must be a non-empty JSON object of permission names to levels.');
  }
  const permissions = Object.create(null);
  for (const [name, level] of entries) {
    if (RESERVED_KEYS.has(name) || !/^[a-z_]+$/.test(name) || !['read', 'write', 'admin'].includes(level)) {
      throw new Error(`GITHUB_APP_PERMISSIONS: "${name}": "${level}" is not a permission name mapped to read, write or admin.`);
    }
    permissions[name] = level;
  }
  return permissions;
}

/** GitHub rejects a JWT with `exp` more than 10 minutes out. */
const JWT_LIFETIME_SECONDS = 540;

/**
 * Backdated by a minute against clock skew, which GitHub's own documentation
 * recommends: a JWT whose `iat` is even slightly in the future is refused, and
 * a runner's clock is not ours to trust.
 */
const JWT_BACKDATE_SECONDS = 60;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Build the RS256 JWT that authenticates as the App itself.
 *
 * Separate from the network calls so it can be verified rather than trusted:
 * the test signs with a key pair it generates and checks the signature back,
 * which is the only way to know the encoding is right without a real App.
 */
export function buildJwt({ appId, privateKey, nowSeconds }) {
  if (!appId) throw new Error('buildJwt needs an appId');
  if (!privateKey) throw new Error('buildJwt needs a privateKey');
  if (!Number.isFinite(nowSeconds)) throw new Error('buildJwt needs nowSeconds');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - JWT_BACKDATE_SECONDS,
      exp: nowSeconds + JWT_LIFETIME_SECONDS,
      iss: String(appId),
    })
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();

  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

/**
 * The installation id for this repository.
 *
 * Throws on a shape it cannot read rather than returning null, following
 * `check-unresolved-secrets.mjs`: "the App is not installed here" and "I could
 * not read the answer" are different facts, and the second reported as the
 * first sends someone to re-install an App that is already installed.
 */
export function parseInstallation(body) {
  const id = body?.id;
  if (!Number.isInteger(id)) {
    throw new Error(
      'GitHub returned an installation payload with no integer `id`. Expected the response of ' +
        'GET /repos/:owner/:repo/installation — this cannot be turned into a token.'
    );
  }
  return id;
}

/** Same discipline: a token response missing its token is a shape problem. */
export function parseTokenResponse(body) {
  const token = body?.token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      'GitHub returned an access-token payload with no `token` string. Expected the response of ' +
        'POST /app/installations/:id/access_tokens.'
    );
  }
  return { token, expiresAt: body.expires_at ?? null };
}

/**
 * `fetch` is a parameter so the flow above can be exercised without a network
 * or a real App — the same reason `edge/availability-probe` takes its fetch in.
 */
export async function mintInstallationToken({
  appId,
  privateKey,
  owner,
  repo,
  nowSeconds = Math.floor(Date.now() / 1000),
  fetchImpl = fetch,
  permissions = DEFAULT_PERMISSIONS,
}) {
  if (!owner || !repo) throw new Error('mintInstallationToken needs owner and repo');

  const jwt = buildJwt({ appId, privateKey, nowSeconds });
  const headers = {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const installationResponse = await fetchImpl(`${API}/repos/${owner}/${repo}/installation`, {
    headers,
  });
  if (!installationResponse.ok) {
    throw new Error(
      `GitHub answered ${installationResponse.status} looking up the installation for ` +
        `${owner}/${repo}. A 404 here usually means the App exists but is not installed on this ` +
        'repository; a 401 means the App id or private key is wrong.'
    );
  }
  const installationId = parseInstallation(await installationResponse.json());

  // Scoped down twice over: to the one repository, and to the permissions the
  // caller names — by default the two the manifest pull request needs. An
  // installation token defaults to everything the installation was granted,
  // which is more than any job here uses.
  const requested = Object.entries(permissions)
    .map(([name, level]) => `${name}: ${level}`)
    .join(', ');
  const tokenResponse = await fetchImpl(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repositories: [repo],
      permissions,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(
      `GitHub answered ${tokenResponse.status} minting an installation token. A 422 here usually ` +
        `means the App was not granted one of the permissions being requested (${requested}).`
    );
  }

  return parseTokenResponse(await tokenResponse.json());
}

async function main() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');

  if (!appId || !privateKey) {
    console.error(
      'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must both be set. The id is a repository ' +
        'variable; the key is a repository secret holding the PEM the App generated.'
    );
    return 2;
  }
  if (!owner || !repo) {
    console.error('GITHUB_REPOSITORY must be set to owner/repo.');
    return 2;
  }

  // Optional. Absent, the manifest publisher's two write permissions apply;
  // present, it must parse, so a malformed override fails here and not as a
  // token that quietly carries the default.
  const permissions = process.env.GITHUB_APP_PERMISSIONS
    ? parsePermissions(process.env.GITHUB_APP_PERMISSIONS)
    : DEFAULT_PERMISSIONS;

  const { token } = await mintInstallationToken({ appId, privateKey, owner, repo, permissions });

  // The ONLY thing on stdout, because the caller captures stdout as the token
  // and must mask it immediately.
  process.stdout.write(token);
  return 0;
}

// pathToFileURL, not string concatenation: it percent-encodes, and a path
// containing a space would otherwise never match, so the script would exit 0
// having minted nothing. That exact defect was found in review on
// check-unresolved-secrets.mjs and is not worth rediscovering here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n${error.message}`);
      process.exit(2);
    });
}
