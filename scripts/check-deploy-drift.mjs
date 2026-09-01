/**
 * How long production has been behind `main`, per deployed service.
 *
 * ## The gap this closes
 *
 * `deploy-functions.yml` and `deploy-azure-frontend.yml` are both
 * workflow_dispatch only, by a recorded decision: enabling a workflow and
 * enabling auto-deploy-on-merge are separate choices, and only the first was
 * made. Merging therefore deploys nothing, and NOTHING SAID SO.
 *
 * That single gap produced both of 2026-08-31's incidents, hours apart and both
 * found by accident:
 *
 *   - The manifest route merged at 2026-08-30 02:45 UTC against a Function App
 *     last deployed at 01:21. `publish-content-manifest.yml` then failed with a
 *     404 for two nights, and the failure message blamed the app.
 *   - The frontend was 35 commits behind, discovered only because someone
 *     deployed it for an unrelated reason.
 *
 * ## WHY AGE AND NOT COMMIT COUNT
 *
 * The obvious check is "how many commits behind". It cannot separate these two:
 * the 404 was **one** commit behind, the frontend **thirty-five**. Any threshold
 * that catches the first fires on every ordinary merge, and any threshold that
 * tolerates ordinary merges misses the outage.
 *
 * What the two share is TIME. Both sat undeployed for days. Drift measured in
 * hours tolerates the normal merge-then-deploy gap — which is the whole point of
 * dispatch-only releases — and still catches a change that was merged and
 * forgotten. So this reports the age of the OLDEST undeployed commit touching a
 * service's own paths, and fails past a threshold.
 *
 * ## Paths, not commits
 *
 * A service is only "behind" when something it ships has changed. Thirty commits
 * touching only `wiki/` leave the Function App exactly as correct as it was.
 * Each service therefore declares the paths it deploys, and drift is measured
 * over commits touching those.
 *
 * ## On running this from a schedule GitHub delivers unreliably
 *
 * `monitor-functions-registered.yml` is documented as hourly and is delivered
 * about 22% of the time, a median 36 minutes late, with a 12.7-hour worst-case
 * gap (measured 2026-08-31). That is a real problem for an outage detector and
 * is NOT one here: this watches a condition measured in days, against a
 * threshold measured in hours. A check that lands every 4.6 hours on average is
 * ample for a 24-hour threshold, and saying so is better than pretending the
 * cron is honoured.
 */
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/**
 * What each deployable service is, and what it ships.
 *
 * `paths` are prefixes matched against the repository-relative paths the GitHub
 * commits API is filtered by. Adding a service here is the only change a new
 * deploy target needs.
 */
export const SERVICES = Object.freeze([
  Object.freeze({
    name: 'Function App',
    workflow: 'deploy-functions.yml',
    paths: Object.freeze(['functions']),
  }),
  Object.freeze({
    name: 'Static Web App',
    workflow: 'deploy-azure-frontend.yml',
    paths: Object.freeze(['frontend']),
  }),
]);

/** Hours of drift tolerated before this is called stale. */
export const DEFAULT_THRESHOLD_HOURS = 24;

/**
 * The last run of a workflow that actually deployed.
 *
 * Throws on a shape it cannot read rather than returning null, following
 * check-unresolved-secrets.mjs: "this service has never deployed" and "I could
 * not read the answer" are different facts, and reporting the second as the
 * first would announce drift against a baseline that does not exist.
 *
 * A workflow with no successful run at all returns null, which IS the first
 * fact and is reported as its own case.
 */
export function parseLastSuccessfulRun(body) {
  const runs = body?.workflow_runs;
  if (!Array.isArray(runs)) {
    throw new Error(
      'GitHub returned a workflow-runs payload without a `workflow_runs` array. Expected the ' +
        'response of GET /repos/:owner/:repo/actions/workflows/:file/runs.'
    );
  }
  if (runs.length === 0) return null;

  const [run] = runs;
  if (typeof run.head_sha !== 'string' || !run.head_sha) {
    throw new Error('A workflow run came back with no `head_sha`, so nothing can be compared.');
  }
  return { sha: run.head_sha, runNumber: run.run_number ?? null, at: run.created_at ?? null };
}

/** The commit date of a single commit payload, as an ISO string. */
export function parseCommitDate(body) {
  const date = body?.commit?.committer?.date || body?.commit?.author?.date;
  if (typeof date !== 'string' || !date) {
    throw new Error(
      'GitHub returned a commit payload with no committer or author date. Expected the response ' +
        'of GET /repos/:owner/:repo/commits/:sha.'
    );
  }
  return date;
}

/**
 * The oldest commit in a newest-first list, or null for an empty list.
 *
 * The GitHub commits API returns newest first, so the oldest undeployed commit
 * is the LAST element — which is the one whose age is the drift. Taking the
 * first would report how recently someone merged, which is nearly the opposite
 * question and would read as healthy right after a merge.
 */
export function oldestCommit(commits) {
  if (!Array.isArray(commits) || commits.length === 0) return null;
  const last = commits[commits.length - 1];
  return {
    sha: last?.sha ?? null,
    date: last?.commit?.committer?.date || last?.commit?.author?.date || null,
    message: String(last?.commit?.message ?? '').split('\n')[0],
  };
}

/** Whole hours between an ISO timestamp and now, floored, never negative. */
export function ageHours(isoDate, nowMs) {
  const then = Date.parse(isoDate);
  if (!Number.isFinite(then)) throw new Error(`Not a date: ${isoDate}`);
  return Math.max(0, Math.floor((nowMs - then) / 3_600_000));
}

/**
 * Whether a service's drift is stale.
 *
 * `>=` rather than `>`: a threshold of 24 should fire at 24 hours, not at 25.
 * Written out because an off-by-one here is a day of silence.
 */
export function isStale(hours, thresholdHours) {
  return hours >= thresholdHours;
}

/** The job-summary table, and whether anything in it is stale. */
export function formatReport(results, thresholdHours) {
  const rows = results.map((r) => {
    if (r.error) return `| ${r.name} | ⚠️ | ${r.error} |`;
    if (r.neverDeployed) return `| ${r.name} | ❌ | never deployed |`;
    if (!r.oldest) return `| ${r.name} | ✅ | up to date |`;
    const stale = isStale(r.hours, thresholdHours);
    return `| ${r.name} | ${stale ? '❌' : '✅'} | ${r.count} commit(s), oldest ${r.hours}h — ${r.oldest.message} |`;
  });

  const failed = results.some(
    (r) => r.error || r.neverDeployed || (r.oldest && isStale(r.hours, thresholdHours))
  );

  return {
    failed,
    text: [
      '## Deployment drift',
      '',
      `Threshold: **${thresholdHours}h**. Measured against \`main\`.`,
      '',
      '| Service | | Behind by |',
      '| --- | :---: | --- |',
      ...rows,
      '',
      failed
        ? '**Deploy the service(s) marked ❌.** Both deploys are dispatch-only by ' +
          'design, so merging does not ship them — this is the thing that says so. ' +
          'A ⚠️ means the check could not read the answer, which is not the same as drift.'
        : 'Every service is within the threshold.',
    ].join('\n'),
  };
}

async function ghJson(fetchImpl, url, token) {
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`);
  return res.json();
}

/** Drift for one service. Never throws: a failure is reported as its own row. */
export async function driftFor(service, { token, owner, repo, nowMs, fetchImpl = fetch }) {
  try {
    const runs = await ghJson(
      fetchImpl,
      `${API}/repos/${owner}/${repo}/actions/workflows/${service.workflow}/runs?status=success&per_page=1`,
      token
    );
    const last = parseLastSuccessfulRun(runs);
    if (!last) return { name: service.name, neverDeployed: true };

    const deployed = await ghJson(
      fetchImpl,
      `${API}/repos/${owner}/${repo}/commits/${last.sha}`,
      token
    );
    const since = parseCommitDate(deployed);

    let commits = [];
    for (const path of service.paths) {
      const page = await ghJson(
        fetchImpl,
        `${API}/repos/${owner}/${repo}/commits?sha=main&path=${encodeURIComponent(path)}` +
          `&since=${encodeURIComponent(since)}&per_page=100`,
        token
      );
      // `since` is inclusive of the boundary commit, which is the deployed one
      // when it touched this path. Excluding it by sha keeps a just-deployed
      // service from reporting itself as one commit behind.
      commits = commits.concat(
        (Array.isArray(page) ? page : []).filter((c) => c?.sha !== last.sha)
      );
    }

    const oldest = oldestCommit(commits);
    return {
      name: service.name,
      deployedSha: last.sha,
      count: commits.length,
      oldest,
      hours: oldest?.date ? ageHours(oldest.date, nowMs) : 0,
    };
  } catch (error) {
    return { name: service.name, error: error?.message || String(error) };
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const thresholdHours = Number(process.env.DRIFT_THRESHOLD_HOURS || DEFAULT_THRESHOLD_HOURS);

  if (!token) {
    console.error('GITHUB_TOKEN must be set.');
    return 2;
  }
  if (!owner || !repo) {
    console.error('GITHUB_REPOSITORY must be set to owner/repo.');
    return 2;
  }
  if (!Number.isFinite(thresholdHours) || thresholdHours <= 0) {
    console.error(`DRIFT_THRESHOLD_HOURS must be a positive number, got ${thresholdHours}.`);
    return 2;
  }

  const nowMs = Date.now();
  const results = [];
  for (const service of SERVICES) {
    results.push(await driftFor(service, { token, owner, repo, nowMs }));
  }

  const { failed, text } = formatReport(results, thresholdHours);
  console.log(text);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`\n${error.message}`);
      process.exit(2);
    });
}
