/**
 * Are the functions the deployed code declares actually registered? (PLAT-2, #962)
 *
 * ## What this replaced
 *
 * Both automated detectors for the failure behind three recorded incidents
 * asked a count question. `deploy-functions.yml` checked that more than zero
 * functions were registered after SyncTriggers; `monitor-functions-registered.yml`
 * checked a minimum of one. The 2026-08-21 incident was 83 deployed and 80
 * registered, with three timers silently down, and it passes both. So does
 * any partial registration short of total failure.
 *
 * This compares the live listing with the expected SET and names every
 * expected function that is missing, with its trigger. A missing timer,
 * queue trigger or change feed is the variant that never 404s: nothing
 * answers wrong, the work just stops happening.
 *
 * ## The expected set
 *
 * `functions/function-inventory.json`, every function `src/functions/index.js`
 * registers, grouped by trigger. It is one file because the deploy and the
 * monitor must compare against the same thing, and it is checked rather than
 * inferred: `functions/src/functions/function-inventory.test.js` enumerates
 * the registrations the way route-inventory.test.js does and fails, naming
 * each name, when the file and the code disagree. A file read here is a file
 * CI has already held to the code.
 *
 * ## Which commit's inventory
 *
 * The deploy compares against the inventory in its own checkout, the commit
 * it has just deployed. That is the default.
 *
 * The monitor must NOT compare against `main`. Deploys are dispatch-only, so
 * a function merged this morning is in `main` and not on the host until the
 * owner deploys, and comparing against `main` would page "missing" for every
 * function merged and not yet shipped. `--deployed` reads the inventory at the
 * commit whose package is live: the newest successful `Deploy to Azure
 * Functions` step among the newest run of `deploy-functions.yml` that
 * succeeded outright and its last ten runs of any outcome. The STEP, not the
 * run: a run that uploads and then fails a later check has still replaced the
 * package, so its commit is the one running. Re-run attempts are included
 * (`filter=all`), and "newest" is the step's completion time, so an old run
 * re-run later counts as the later upload it was. The outright success is
 * asked for on its own, so later dispatches that never reached the upload
 * cannot push it out of view.
 *
 * When no such run is found, or the deployed commit predates the inventory
 * file, there is no expected set to compare with. That is reported as "not
 * armed" and only a non-zero count is asserted, which is exactly what the
 * monitor checked before this file existed. The first deploy that carries the
 * inventory arms it.
 *
 * ## Output contract, which both workflows rely on
 *
 * stdout line 1 is a short value for a table cell: `248 of 248`,
 * `245 of 248, 3 missing`, `121 registered (not armed)`, `unreadable`.
 * Every following line is Markdown detail. Nothing goes to stderr on a
 * verdict, so a caller capturing stdout has the whole answer.
 *
 * Exit 0: every expected function is registered (or, not armed, at least one
 * is). Exit 1: at least one expected function is missing (or, not armed, none
 * is registered). Exit 2: the check could not run (unreadable inventory,
 * GitHub unreachable, bad arguments), which is NOT a statement about the
 * Function App.
 *
 * EMPTY INPUT IS ZERO REGISTERED FUNCTIONS, the 2026-08-20 outage, not "could
 * not read". A caller whose listing failed must not pipe into this; both
 * workflows check the `az` call's own exit status first.
 *
 * ## Usage
 *
 *     az functionapp function list -n APP -g RG --query "[].name" -o tsv \
 *       | node scripts/check-registered-functions.mjs
 *
 *     az functionapp function list -n APP -g RG --query "[].name" -o tsv \
 *       | GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo \
 *         node scripts/check-registered-functions.mjs --deployed
 *
 * `az` prints each name as `<app>/<function>`; the prefix is ignored, as is
 * case, because the host treats function names case-insensitively.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/** The trigger groups the inventory may hold, in the order they are reported. */
export const TRIGGERS = Object.freeze(['http', 'timer', 'cosmosDB', 'storageQueue']);

/** Repository-relative, because the monitor reads it at other commits by this path. */
export const INVENTORY_PATH = 'functions/function-inventory.json';

/**
 * Fewer expected functions than this means the file is truncated or emptied,
 * not that the API shrank. route-inventory.test.js asserts more than 50 HTTP
 * registrations; a floor weaker than that would let an emptied file make every
 * live listing look complete, which is the failure this script exists to end.
 */
export const MIN_EXPECTED = 51;

export const DEPLOY_WORKFLOW = 'deploy-functions.yml';

/**
 * The step in `deploy-functions.yml` that replaces the live package. Renaming
 * that step without changing this would leave the monitor unable to find a
 * deploy and quietly disarmed; check-registered-functions.test.mjs reads the
 * workflow and fails first.
 */
export const DEPLOY_STEP = 'Deploy to Azure Functions';

/** How many recent deploy runs are searched for the live package's commit. */
export const MAX_RUNS = 10;

const DEFAULT_INVENTORY = join(fileURLToPath(new URL('..', import.meta.url)), INVENTORY_PATH);

/**
 * The expected functions, as `{ name, trigger }`.
 *
 * Throws on anything it cannot read with certainty. An absent trigger group is
 * an empty one, so an inventory from before a group existed still reads; an
 * unknown group is refused, because its functions would otherwise go
 * unchecked.
 *
 * @param {string} text - the inventory file's contents
 * @returns {{ name: string, trigger: string }[]}
 */
export function parseInventory(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`${INVENTORY_PATH} is not valid JSON.`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${INVENTORY_PATH} is not an object of trigger groups.`);
  }
  const unknown = Object.keys(doc).filter((key) => key !== '$comment' && !TRIGGERS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${INVENTORY_PATH} has trigger group(s) this script does not know: ${unknown.join(', ')}. ` +
        'Add them to TRIGGERS, or their functions go unchecked.'
    );
  }

  const entries = [];
  const seen = new Set();
  for (const trigger of TRIGGERS) {
    const names = doc[trigger] ?? [];
    if (!Array.isArray(names)) throw new Error(`${INVENTORY_PATH}: "${trigger}" is not a list.`);
    for (const name of names) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error(`${INVENTORY_PATH}: "${trigger}" holds an entry that is not a function name.`);
      }
      const key = name.toLowerCase();
      if (seen.has(key)) throw new Error(`${INVENTORY_PATH} lists ${name} twice.`);
      seen.add(key);
      entries.push({ name, trigger });
    }
  }

  if (entries.length < MIN_EXPECTED) {
    throw new Error(
      `${INVENTORY_PATH} lists ${entries.length} functions, fewer than the ${MIN_EXPECTED} that ` +
        'would mean a truncated file rather than a smaller API. Comparing against it would ' +
        'pass while checking almost nothing.'
    );
  }
  return entries;
}

/**
 * Function names from `az functionapp function list --query "[].name" -o tsv`.
 * Each arrives as `<app>/<function>`; only the part after the last `/` is the
 * function. Blank lines and stray whitespace are tolerated.
 */
export function parseLiveNames(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(line.lastIndexOf('/') + 1))
    .filter(Boolean);
}

/**
 * Expected against live.
 *
 * @returns {{ expected: number, present: number, missing: {name: string, trigger: string}[],
 *             extra: string[] }}
 *   `extra` is registered but not expected: reported, never a failure, since
 *   the deployed code is what decides what should exist.
 */
export function compareRegistration(expected, liveNames) {
  const live = new Map(liveNames.map((name) => [name.toLowerCase(), name]));
  const missing = expected.filter((entry) => !live.has(entry.name.toLowerCase()));
  const wanted = new Set(expected.map((entry) => entry.name.toLowerCase()));
  const extra = [...live]
    .filter(([key]) => !wanted.has(key))
    .map(([, name]) => name)
    .sort();
  return { expected: expected.length, present: expected.length - missing.length, missing, extra };
}

/** The verdict against an expected set: exit code and output lines. */
export function formatNamed(result, source) {
  const lines = [];
  let code;
  if (result.missing.length === 0) {
    code = 0;
    lines.push(`${result.present} of ${result.expected}`);
    lines.push(`All ${result.expected} expected functions are registered (expected set: ${source}).`);
  } else {
    code = 1;
    lines.push(`${result.present} of ${result.expected}, ${result.missing.length} missing`);
    lines.push(
      `**${result.missing.length} of ${result.expected} expected functions are not registered** ` +
        `(expected set: ${source}):`
    );
    lines.push('');
    for (const trigger of TRIGGERS) {
      for (const entry of result.missing.filter((m) => m.trigger === trigger)) {
        lines.push(`- \`${entry.name}\` (${entry.trigger})`);
      }
    }
    if (result.missing.some((m) => m.trigger !== 'http')) {
      lines.push('');
      lines.push(
        'A missing timer, queue or change-feed trigger fails silently: nothing returns an error, ' +
          'the work just stops. That is the 2026-08-21 shape (83 deployed, 80 registered).'
      );
    }
  }
  if (result.extra.length > 0) {
    lines.push('');
    lines.push(
      `Registered but not in the expected set, not counted as a failure: ` +
        `${result.extra.map((name) => `\`${name}\``).join(', ')}.`
    );
  }
  return { code, lines };
}

/** The verdict when no expected set exists: only a non-zero count is asserted. */
export function formatNotArmed(liveCount, reason) {
  if (liveCount > 0) {
    return {
      code: 0,
      lines: [
        `${liveCount} registered (not armed)`,
        `${reason} So there is no expected set to name missing functions against, and only a ` +
          'non-zero count is asserted, which is all this check did before PLAT-2. The first ' +
          'deploy that carries the inventory arms it.',
      ],
    };
  }
  return {
    code: 1,
    lines: [
      '0 registered',
      '**No function is registered.** Every route answers 404 and no timer runs: the ' +
        `2026-08-20 condition. (${reason})`,
    ],
  };
}

/** The verdict when the check itself could not run. */
export function formatUnreadable(reason) {
  return {
    code: 2,
    lines: [
      'unreadable',
      `This check could not run, which says nothing about the Function App: ${reason}`,
    ],
  };
}

/** A GitHub REST request with the token and API version every call here sends. */
async function ghFetch(fetchImpl, url, token, accept = 'application/vnd.github+json') {
  return fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

/** A GitHub REST response body, or an error naming the status and URL. */
async function ghJson(fetchImpl, url, token) {
  const res = await ghFetch(fetchImpl, url, token);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
  return res.json();
}

/** The `workflow_runs` array of a runs payload, or an error saying it is not one. */
function runsOf(body) {
  const runs = body?.workflow_runs;
  if (!Array.isArray(runs)) {
    throw new Error(
      'GitHub returned a workflow-runs payload without a `workflow_runs` array. Expected the ' +
        `response of GET /repos/:owner/:repo/actions/workflows/${DEPLOY_WORKFLOW}/runs.`
    );
  }
  return runs;
}

/**
 * The commit whose package is live: the newest successful `DEPLOY_STEP`
 * among the newest run that succeeded outright and the last `MAX_RUNS` runs
 * of any outcome, every attempt of each.
 *
 * The run that succeeded is asked for separately (`status=success`) so that
 * a string of later dispatches that never reached the upload (refused on the
 * ref, on a busy workspace, or never approved) cannot push it out of the
 * window and leave the monitor unarmed. The recent runs of any outcome are
 * there for the case a successful run cannot show: one that uploaded and
 * then failed a later check, or is still running, and so is the package
 * that is live.
 *
 * @returns {Promise<{ sha: string, runNumber: number|null, completedAt: string } | null>}
 *   null when no run has ever uploaded a package that this can find.
 */
export async function findDeployedCommit({ token, owner, repo, fetchImpl = fetch }) {
  const base = `${API}/repos/${owner}/${repo}/actions`;
  const succeeded = runsOf(
    await ghJson(fetchImpl, `${base}/workflows/${DEPLOY_WORKFLOW}/runs?status=success&per_page=1`, token)
  );
  const recent = runsOf(await ghJson(fetchImpl, `${base}/workflows/${DEPLOY_WORKFLOW}/runs?per_page=${MAX_RUNS}`, token));
  const candidates = new Map();
  for (const run of [...recent.slice(0, MAX_RUNS), ...succeeded.slice(0, 1)]) candidates.set(run?.id, run);

  let best = null;
  for (const run of candidates.values()) {
    if (typeof run?.id !== 'number' || typeof run.head_sha !== 'string' || !run.head_sha) {
      throw new Error('A deploy run came back without an id or a head_sha, so nothing can be compared.');
    }
    const jobsBody = await ghJson(fetchImpl, `${base}/runs/${run.id}/jobs?filter=all&per_page=100`, token);
    if (!Array.isArray(jobsBody?.jobs)) {
      throw new Error(`GitHub returned a jobs payload without a \`jobs\` array for run ${run.id}.`);
    }
    for (const job of jobsBody.jobs) {
      for (const step of job?.steps ?? []) {
        if (step?.name !== DEPLOY_STEP || step.conclusion !== 'success') continue;
        const at = Date.parse(step.completed_at);
        if (!Number.isFinite(at)) continue;
        if (!best || at > best.at) {
          best = { at, sha: run.head_sha, runNumber: run.run_number ?? null, completedAt: step.completed_at };
        }
      }
    }
  }
  if (!best) return null;
  return { sha: best.sha, runNumber: best.runNumber, completedAt: best.completedAt };
}

/** The inventory's text at a commit, or null when the file did not exist there. */
export async function fetchInventoryAt({ token, owner, repo, sha, fetchImpl = fetch }) {
  const url = `${API}/repos/${owner}/${repo}/contents/${INVENTORY_PATH}?ref=${encodeURIComponent(sha)}`;
  const res = await ghFetch(fetchImpl, url, token, 'application/vnd.github.raw+json');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
  return res.text();
}

export const USAGE =
  'usage: <live function names on stdin> | node scripts/check-registered-functions.mjs [--deployed]\n' +
  '  names: az functionapp function list -n APP -g RG --query "[].name" -o tsv\n' +
  '  --deployed  compare with the inventory at the commit last deployed (needs GITHUB_TOKEN, GITHUB_REPOSITORY)';

/**
 * Everything but the process: arguments, stdin text and environment in,
 * exit code and stdout lines out.
 */
export async function run({ args = [], input = '', env = {}, fetchImpl = fetch, inventoryFile = DEFAULT_INVENTORY }) {
  const unknown = args.filter((arg) => arg !== '--deployed');
  if (unknown.length > 0) return formatUnreadable(`unknown argument(s) ${unknown.join(' ')}. ${USAGE}`);
  const live = parseLiveNames(input);

  if (!args.includes('--deployed')) {
    let expected;
    try {
      expected = parseInventory(readFileSync(inventoryFile, 'utf8'));
    } catch (error) {
      return formatUnreadable(error.message);
    }
    return formatNamed(compareRegistration(expected, live), `\`${INVENTORY_PATH}\` in this checkout`);
  }

  const token = env.GITHUB_TOKEN;
  const [owner, repo] = String(env.GITHUB_REPOSITORY ?? '').split('/');
  if (!token || !owner || !repo) {
    return formatUnreadable('--deployed needs GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) to find the commit last deployed.');
  }

  let deployed;
  let text;
  try {
    deployed = await findDeployedCommit({ token, owner, repo, fetchImpl });
    if (deployed) text = await fetchInventoryAt({ token, owner, repo, sha: deployed.sha, fetchImpl });
  } catch (error) {
    return formatUnreadable(`the commit last deployed could not be read from GitHub: ${error.message}`);
  }

  if (!deployed) {
    return formatNotArmed(
      new Set(live.map((name) => name.toLowerCase())).size,
      `No run of \`${DEPLOY_WORKFLOW}\` has succeeded, and none of its last ${MAX_RUNS} completed its ` +
        `\`${DEPLOY_STEP}\` step, so which commit is live is not known.`
    );
  }
  const short = deployed.sha.slice(0, 7);
  const runLabel = deployed.runNumber === null ? 'a deploy run' : `deploy run #${deployed.runNumber}`;
  if (text === null) {
    return formatNotArmed(
      new Set(live.map((name) => name.toLowerCase())).size,
      `The commit live on the host (\`${short}\`, ${runLabel}) predates \`${INVENTORY_PATH}\`.`
    );
  }

  let expected;
  try {
    expected = parseInventory(text);
  } catch (error) {
    return formatUnreadable(`the inventory at \`${short}\`: ${error.message}`);
  }
  return formatNamed(
    compareRegistration(expected, live),
    `\`${INVENTORY_PATH}\` at \`${short}\`, the commit ${runLabel} put on the host`
  );
}

/** All of stdin, as text. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readStdin()
    .then((input) => run({ args: process.argv.slice(2), input, env: process.env }))
    .then(({ code, lines }) => {
      process.stdout.write(`${lines.join('\n')}\n`);
      process.exitCode = code;
    })
    .catch((error) => {
      process.stdout.write(`${formatUnreadable(error?.message || String(error)).lines.join('\n')}\n`);
      process.exitCode = 2;
    });
}
