/**
 * The registration check (PLAT-2, #962): a missing function is named, the
 * expected set is the one that is actually deployed, and "could not look" is
 * never reported as either healthy or down.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  compareRegistration,
  DEPLOY_STEP,
  DEPLOY_WORKFLOW,
  findDeployedCommit,
  formatNamed,
  INVENTORY_PATH,
  MAX_PAGES,
  MAX_RUNS,
  MIN_EXPECTED,
  parseInventory,
  parseLiveNames,
  run,
  TRIGGERS,
} from './check-registered-functions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(HERE, 'check-registered-functions.mjs');
const COMMITTED = readFileSync(join(ROOT, INVENTORY_PATH), 'utf8');
/** A workflow file's text, by file name. */
const workflow = (name) => readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');

/** An inventory with `http` names plus three timers, one queue and one feed. */
function inventoryDoc(httpCount = MIN_EXPECTED) {
  return {
    $comment: ['fixture'],
    http: Array.from({ length: httpCount }, (_, i) => `route${String(i).padStart(3, '0')}`),
    timer: ['syncRssFeeds', 'healthPulse', 'platformJobSweeper'],
    cosmosDB: ['processContentChanges'],
    storageQueue: ['platformJobWorker'],
  };
}
/** An inventory document as the file holds it. */
const inventoryText = (doc = inventoryDoc()) => JSON.stringify(doc);
/** Every function name an inventory document lists, in trigger order. */
const allNames = (doc = inventoryDoc()) => TRIGGERS.flatMap((t) => doc[t] ?? []);
/** As `az ... --query "[].name" -o tsv` prints them. */
const tsv = (names) => names.map((name) => `func-site-prod-cus-01/${name}`).join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'check-registered-functions-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/** An inventory document written to a scratch file, for run() to read. */
function inventoryFile(doc = inventoryDoc()) {
  const path = join(scratch, `inventory-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

describe('parseInventory', () => {
  it('reads every group, with each name tagged by its trigger', () => {
    const entries = parseInventory(inventoryText());
    expect(entries).toHaveLength(MIN_EXPECTED + 5);
    expect(entries).toContainEqual({ name: 'syncRssFeeds', trigger: 'timer' });
    expect(entries).toContainEqual({ name: 'platformJobWorker', trigger: 'storageQueue' });
  });

  it('reads an absent group as empty, so an inventory older than a group still reads', () => {
    const doc = inventoryDoc();
    delete doc.cosmosDB;
    expect(parseInventory(inventoryText(doc))).toHaveLength(MIN_EXPECTED + 4);
  });

  it('refuses a group it does not know, whose functions would otherwise go unchecked', () => {
    expect(() => parseInventory(inventoryText({ ...inventoryDoc(), serviceBusQueue: ['x'] }))).toThrow(
      /serviceBusQueue/
    );
  });

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['a group that is not a list', inventoryText({ ...inventoryDoc(), timer: 'syncRssFeeds' })],
    ['a name that is not a string', inventoryText({ ...inventoryDoc(), timer: [7] })],
    ['a blank name', inventoryText({ ...inventoryDoc(), timer: ['  '] })],
  ])('refuses %s', (_label, text) => {
    expect(() => parseInventory(text)).toThrow();
  });

  it('refuses a name listed twice, whatever its case, since the host treats them as one', () => {
    const doc = inventoryDoc();
    doc.timer.push('SYNCRSSFEEDS');
    expect(() => parseInventory(inventoryText(doc))).toThrow(/twice/);
  });

  it('refuses a file so small it would make any listing look complete', () => {
    expect(() => parseInventory(inventoryText(inventoryDoc(MIN_EXPECTED - 10)))).toThrow(/truncated/);
  });

  it('reads the committed inventory, above the floor', () => {
    // functions/src/functions/function-inventory.test.js holds this file to
    // the code; this holds it to the parser the workflows run.
    const entries = parseInventory(COMMITTED);
    expect(entries.length).toBeGreaterThanOrEqual(MIN_EXPECTED);
    for (const trigger of TRIGGERS) {
      expect(entries.some((e) => e.trigger === trigger), trigger).toBe(true);
    }
    expect(entries).toContainEqual({ name: 'healthCheck', trigger: 'http' });
    expect(entries).toContainEqual({ name: 'platformJobWorker', trigger: 'storageQueue' });
  });
});

describe('parseLiveNames', () => {
  it('takes the function from `<app>/<function>` and ignores blank lines and CRLF', () => {
    expect(parseLiveNames('func-site-prod-cus-01/healthCheck\r\n\n  func-site-prod-cus-01/aiProxy  \n')).toEqual([
      'healthCheck',
      'aiProxy',
    ]);
  });

  it('accepts a bare name', () => {
    expect(parseLiveNames('healthCheck')).toEqual(['healthCheck']);
  });

  it('reads nothing as nothing', () => {
    expect(parseLiveNames('')).toEqual([]);
    expect(parseLiveNames(undefined)).toEqual([]);
  });
});

describe('compareRegistration', () => {
  const expected = parseInventory(inventoryText());

  it('names the 2026-08-21 shape: most registered, three timers not', () => {
    // 83 deployed, 80 registered. A count above zero, or above one, passed it.
    const live = allNames().filter((n) => !['syncRssFeeds', 'healthPulse', 'platformJobSweeper'].includes(n));
    const result = compareRegistration(expected, live);
    expect(result.missing.map((m) => m.name).sort()).toEqual(['healthPulse', 'platformJobSweeper', 'syncRssFeeds']);
    expect(result.missing.every((m) => m.trigger === 'timer')).toBe(true);
    expect(result.present).toBe(result.expected - 3);
  });

  it('fails a single missing function', () => {
    const live = allNames().filter((n) => n !== 'route007');
    expect(compareRegistration(expected, live).missing).toEqual([{ name: 'route007', trigger: 'http' }]);
  });

  it('reports every expected function missing when nothing is registered, the 2026-08-20 shape', () => {
    expect(compareRegistration(expected, []).missing).toHaveLength(expected.length);
  });

  it('matches names case-insensitively, as the host does', () => {
    const live = allNames().map((n) => n.toUpperCase());
    expect(compareRegistration(expected, live).missing).toEqual([]);
  });

  it('reports an unexpected registration without failing on it', () => {
    const result = compareRegistration(expected, [...allNames(), 'leftoverFunction']);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual(['leftoverFunction']);
  });
});

describe('formatNamed', () => {
  const expected = parseInventory(inventoryText());

  it('puts a table-safe value on line 1 and every missing name, with its trigger, below', () => {
    const live = allNames().filter((n) => n !== 'syncRssFeeds' && n !== 'route001');
    const { code, lines } = formatNamed(compareRegistration(expected, live), 'the fixture');
    expect(code).toBe(1);
    expect(lines[0]).toBe(`${expected.length - 2} of ${expected.length}, 2 missing`);
    expect(lines[0]).not.toMatch(/[|\n]/);
    expect(lines).toContain('- `route001` (http)');
    expect(lines).toContain('- `syncRssFeeds` (timer)');
    expect(lines.join('\n')).toMatch(/fails silently/);
  });

  it('passes a complete listing', () => {
    const { code, lines } = formatNamed(compareRegistration(expected, allNames()), 'the fixture');
    expect(code).toBe(0);
    expect(lines[0]).toBe(`${expected.length} of ${expected.length}`);
  });
});

describe('run, against the inventory in the checkout (the deploy)', () => {
  it('passes when every expected function is listed', async () => {
    const got = await run({ input: tsv(allNames()), inventoryFile: inventoryFile() });
    expect(got.code).toBe(0);
  });

  it('fails naming the one that is not', async () => {
    const got = await run({
      input: tsv(allNames().filter((n) => n !== 'platformJobWorker')),
      inventoryFile: inventoryFile(),
    });
    expect(got.code).toBe(1);
    expect(got.lines).toContain('- `platformJobWorker` (storageQueue)');
  });

  it('exits 2, not 0 or 1, when the inventory cannot be read', async () => {
    const got = await run({ input: tsv(allNames()), inventoryFile: join(scratch, 'absent.json') });
    expect(got.code).toBe(2);
    expect(got.lines[0]).toBe('unreadable');
  });

  it('exits 2 on an argument it does not know', async () => {
    const got = await run({ args: ['--min', '1'], input: '' });
    expect(got.code).toBe(2);
  });
});

/**
 * A fake GitHub API: `runs` newest-created first, as the API orders them, and
 * `jobs` by run id. `inventories` maps a sha to the file's text, or to null for
 * a commit without it.
 */
function github({ runs = [], jobs = {}, inventories = {}, failAt = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const respond = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => body,
    });
    if (failAt && url.includes(failAt)) return respond(500, {});
    expect(init.headers.Authorization).toBe('Bearer t0ken');
    if (url.includes(`/workflows/${DEPLOY_WORKFLOW}/runs`)) {
      // As the API answers: newest first, `status=success` meaning the run's
      // conclusion, and no more than per_page.
      const perPage = Number(/per_page=(\d+)/.exec(url)?.[1] ?? 30);
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
      const pool = url.includes('status=success') ? runs.filter((r) => r.conclusion === 'success') : runs;
      return respond(200, { workflow_runs: pool.slice((page - 1) * perPage, page * perPage) });
    }
    const jobsMatch = /\/runs\/(\d+)\/jobs\?filter=all/.exec(url);
    if (jobsMatch) return respond(200, { jobs: jobs[jobsMatch[1]] ?? [] });
    const contents = /\/contents\/functions\/function-inventory\.json\?ref=([0-9a-f]+)$/.exec(url);
    if (contents) {
      expect(init.headers.Accept).toBe('application/vnd.github.raw+json');
      const text = inventories[contents[1]];
      return text === undefined || text === null ? respond(404, 'Not Found') : respond(200, text);
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { fetchImpl, calls };
}

/** A job step as the jobs API returns it. */
const step = (conclusion, completedAt, name = DEPLOY_STEP) => ({ name, conclusion, completed_at: completedAt });
/** A job as the jobs API returns it. */
const job = (...steps) => ({ name: 'Deploy to Azure Functions', steps });
const ENV = { GITHUB_TOKEN: 't0ken', GITHUB_REPOSITORY: 'saulpatinojr/HCW-HybridCloudWorks' };
const SHA_NEW = 'aaaaaaa1111111111111111111111111111111aa';
const SHA_OLD = 'bbbbbbb2222222222222222222222222222222bb';

describe('findDeployedCommit: the commit whose package is live', () => {
  it('takes the newest successful deploy step, even when that run failed a later check', async () => {
    const { fetchImpl } = github({
      runs: [
        { id: 2, run_number: 42, head_sha: SHA_NEW, conclusion: 'failure' },
        { id: 1, run_number: 41, head_sha: SHA_OLD, conclusion: 'success' },
      ],
      jobs: {
        2: [job(step('success', '2026-10-09T10:05:00Z'), step('failure', '2026-10-09T10:07:00Z', 'Assert AzureWebJobsStorage is absent, then sync triggers'))],
        1: [job(step('success', '2026-10-08T09:00:00Z'))],
      },
    });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found).toEqual({ sha: SHA_NEW, runNumber: 42, completedAt: '2026-10-09T10:05:00Z' });
  });

  it('skips a newer run that never got its package up', async () => {
    const { fetchImpl } = github({
      runs: [
        { id: 2, run_number: 42, head_sha: SHA_NEW },
        { id: 1, run_number: 41, head_sha: SHA_OLD },
      ],
      jobs: { 2: [job(step('skipped', null))], 1: [job(step('success', '2026-10-08T09:00:00Z'))] },
    });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found.sha).toBe(SHA_OLD);
  });

  it('counts an older run re-run later as the later upload it was', async () => {
    const { fetchImpl } = github({
      runs: [
        { id: 2, run_number: 42, head_sha: SHA_NEW },
        { id: 1, run_number: 41, head_sha: SHA_OLD },
      ],
      jobs: {
        2: [job(step('success', '2026-10-09T10:00:00Z'))],
        // Attempt 1 and its re-run, attempt 2, which uploaded after run 42.
        1: [job(step('failure', '2026-10-08T09:00:00Z')), job(step('success', '2026-10-09T11:00:00Z'))],
      },
    });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found.sha).toBe(SHA_OLD);
  });

  it('asks for the newest outright success, the last MAX_RUNS runs, and every attempt of each', async () => {
    const { fetchImpl, calls } = github({ runs: [{ id: 1, run_number: 1, head_sha: SHA_OLD }], jobs: {} });
    await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(calls.some((url) => url.includes('status=success&per_page=1'))).toBe(true);
    expect(calls.some((url) => url.endsWith(`/runs?per_page=${MAX_RUNS}&page=1`))).toBe(true);
    expect(calls.filter((url) => url.includes('/jobs?')).every((url) => url.includes('filter=all'))).toBe(true);
  });

  it('lists no more than MAX_PAGES pages of runs', async () => {
    const runs = Array.from({ length: MAX_RUNS * (MAX_PAGES + 2) }, (_, i) => ({ id: 1000 + i, run_number: i, head_sha: SHA_NEW }));
    const { fetchImpl, calls } = github({ runs, jobs: {} });
    await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(calls.filter((url) => /\/runs\?per_page=\d+&page=\d+$/.test(url))).toHaveLength(MAX_PAGES);
  });

  it('finds a run that uploaded and then failed a later check, behind more refused dispatches than a page', async () => {
    // Review's second case: the live package came from a run that failed
    // after its upload, and is neither in the first page nor an outright
    // success. The older outright success is NOT the live commit.
    const refused = Array.from({ length: MAX_RUNS + 2 }, (_, i) => ({
      id: 100 + i,
      run_number: 300 - i,
      head_sha: SHA_NEW,
      conclusion: 'failure',
      updated_at: `2026-10-09T12:${String(59 - i).padStart(2, '0')}:00Z`,
    }));
    const jobs = Object.fromEntries(refused.map((run) => [run.id, [job(step('skipped', null))]]));
    const SHA_MID = 'ccccccc3333333333333333333333333333333cc';
    jobs[50] = [job(step('success', '2026-10-09T10:05:00Z'), step('failure', '2026-10-09T10:08:00Z', 'Assert every expected function is registered'))];
    jobs[1] = [job(step('success', '2026-10-01T09:00:00Z'))];
    const { fetchImpl } = github({
      runs: [
        ...refused,
        { id: 50, run_number: 60, head_sha: SHA_MID, conclusion: 'failure', updated_at: '2026-10-09T10:10:00Z' },
        { id: 1, run_number: 41, head_sha: SHA_OLD, conclusion: 'success', updated_at: '2026-10-01T09:05:00Z' },
      ],
      jobs,
    });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found).toEqual({ sha: SHA_MID, runNumber: 60, completedAt: '2026-10-09T10:05:00Z' });
  });

  it('reads jobs only for runs active after the newest upload it has found', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({
      id: 500 + i,
      run_number: 500 - i,
      head_sha: i === 0 ? SHA_NEW : SHA_OLD,
      conclusion: 'success',
      updated_at: `2026-10-${String(29 - i).padStart(2, '0')}T10:10:00Z`,
    }));
    const jobs = Object.fromEntries(
      runs.map((run, i) => [run.id, [job(step('success', `2026-10-${String(29 - i).padStart(2, '0')}T10:05:00Z`))]])
    );
    const { fetchImpl, calls } = github({ runs, jobs });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found.sha).toBe(SHA_NEW);
    expect(calls.filter((url) => url.includes('/jobs?'))).toHaveLength(1);
  });

  it('finds the last outright success behind more failed dispatches than MAX_RUNS', async () => {
    // Review's case: a run of dispatches refused before the upload (wrong
    // ref, busy workspace, never approved) used to push the deployed run out
    // of the window and leave the monitor unarmed.
    const refused = Array.from({ length: MAX_RUNS + 2 }, (_, i) => ({
      id: 100 + i,
      run_number: 200 - i,
      head_sha: SHA_NEW,
      conclusion: 'failure',
    }));
    const jobs = Object.fromEntries(refused.map((run) => [run.id, [job(step('skipped', null))]]));
    jobs[1] = [job(step('success', '2026-10-01T09:00:00Z'))];
    const { fetchImpl } = github({
      runs: [...refused, { id: 1, run_number: 41, head_sha: SHA_OLD, conclusion: 'success' }],
      jobs,
    });
    const found = await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl });
    expect(found).toEqual({ sha: SHA_OLD, runNumber: 41, completedAt: '2026-10-01T09:00:00Z' });
  });

  it('returns null when no recent run uploaded a package', async () => {
    const { fetchImpl } = github({ runs: [{ id: 1, run_number: 1, head_sha: SHA_OLD }], jobs: { 1: [job(step('failure', '2026-10-08T09:00:00Z'))] } });
    expect(await findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl })).toBeNull();
  });

  it('throws on a payload it cannot read, rather than calling it "never deployed"', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ total_count: 0 }) });
    await expect(findDeployedCommit({ token: 't0ken', owner: 'o', repo: 'r', fetchImpl })).rejects.toThrow(
      /workflow_runs/
    );
  });
});

describe('run --deployed (the monitor)', () => {
  /** A GitHub whose one deploy run uploaded `sha`, with these inventories. */
  const deployedAt = (sha, inventories) =>
    github({
      runs: [{ id: 9, run_number: 77, head_sha: sha }],
      jobs: { 9: [job(step('success', '2026-10-09T10:00:00Z'))] },
      inventories,
    });

  it('compares against the inventory at the deployed commit, not the checkout', async () => {
    // The deployed commit's inventory lacks a function main has since added:
    // that function is not "missing", because it has not been deployed.
    const deployedDoc = inventoryDoc();
    const { fetchImpl } = deployedAt(SHA_NEW, { [SHA_NEW]: inventoryText(deployedDoc) });
    const got = await run({ args: ['--deployed'], input: tsv(allNames(deployedDoc)), env: ENV, fetchImpl });
    expect(got.code).toBe(0);
    expect(got.lines[1]).toContain('aaaaaaa');
    expect(got.lines[1]).toContain('#77');
  });

  it('names a function missing from the deployed set', async () => {
    const { fetchImpl } = deployedAt(SHA_NEW, { [SHA_NEW]: inventoryText() });
    const got = await run({
      args: ['--deployed'],
      input: tsv(allNames().filter((n) => n !== 'processContentChanges')),
      env: ENV,
      fetchImpl,
    });
    expect(got.code).toBe(1);
    expect(got.lines).toContain('- `processContentChanges` (cosmosDB)');
  });

  it('is not armed, and asserts only a non-zero count, when the deployed commit predates the inventory', async () => {
    const { fetchImpl } = deployedAt(SHA_OLD, { [SHA_OLD]: null });
    const got = await run({ args: ['--deployed'], input: tsv(['healthCheck', 'aiProxy']), env: ENV, fetchImpl });
    expect(got.code).toBe(0);
    expect(got.lines[0]).toBe('2 registered (not armed)');
    expect(got.lines[1]).toContain('predates');
  });

  it('still fails a host with nothing registered while not armed', async () => {
    const { fetchImpl } = deployedAt(SHA_OLD, { [SHA_OLD]: null });
    const got = await run({ args: ['--deployed'], input: '', env: ENV, fetchImpl });
    expect(got.code).toBe(1);
    expect(got.lines[0]).toBe('0 registered');
  });

  it('is not armed when no recent run uploaded a package', async () => {
    const { fetchImpl } = github({ runs: [], jobs: {} });
    const got = await run({ args: ['--deployed'], input: tsv(['healthCheck']), env: ENV, fetchImpl });
    expect(got.code).toBe(0);
    expect(got.lines[0]).toBe('1 registered (not armed)');
  });

  it('exits 2 when GitHub cannot be read, which is not a verdict on the Function App', async () => {
    const { fetchImpl } = github({ failAt: '/runs?' });
    const got = await run({ args: ['--deployed'], input: tsv(allNames()), env: ENV, fetchImpl });
    expect(got.code).toBe(2);
    expect(got.lines[0]).toBe('unreadable');
  });

  it('exits 2 without a token or a repository', async () => {
    const got = await run({ args: ['--deployed'], input: tsv(allNames()), env: {} });
    expect(got.code).toBe(2);
  });
});

describe('the workflows call it the way it is written', () => {
  it(`${DEPLOY_WORKFLOW} has the step this script looks for`, () => {
    // Renamed without this constant, the monitor would find no deploy and
    // quietly fall back to "not armed".
    const text = workflow(DEPLOY_WORKFLOW);
    const at = text.search(new RegExp(`^ {6}- name: ${DEPLOY_STEP}$`, 'm'));
    expect(at, `no step named "${DEPLOY_STEP}"`).toBeGreaterThan(-1);
    expect(text.slice(at, at + 400)).toMatch(/uses: Azure\/functions-action@/);
  });

  it('the deploy compares against its own checkout and has no count threshold left', () => {
    const text = workflow(DEPLOY_WORKFLOW);
    expect(text).toMatch(/\| node scripts\/check-registered-functions\.mjs\)/);
    expect(text).not.toMatch(/check-registered-functions\.mjs --deployed/);
    expect(text).not.toMatch(/\[ "\$count" -gt 0 \]/);
  });

  it('the monitor compares against the deployed commit and can read the run history to find it', () => {
    const text = workflow('monitor-functions-registered.yml');
    expect(text).toMatch(/node scripts\/check-registered-functions\.mjs --deployed/);
    expect(text).toMatch(/^ {6}actions: read\b/m);
    expect(text).toMatch(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
    expect(text).not.toMatch(/^\s*MIN:/m);
  });
});

describe('the CLI actually executes', () => {
  // Spawned for real: a guard that stops matching exits 0 having checked
  // nothing, which a monitor would read as healthy.
  const names = parseInventory(COMMITTED).map((e) => e.name);
  /** Run the script as the workflows do, from the repository root. */
  const spawn = (args, input) => {
    try {
      return { code: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', cwd: ROOT }) };
    } catch (err) {
      return { code: err.status, stdout: err.stdout ?? '' };
    }
  };

  it('exits 0 for a complete listing of the committed inventory', () => {
    const got = spawn([], tsv(names));
    expect(got.code).toBe(0);
    expect(got.stdout.split('\n')[0]).toBe(`${names.length} of ${names.length}`);
  });

  it('exits 1 naming the one function left out', () => {
    const got = spawn([], tsv(names.filter((n) => n !== 'healthCheck')));
    expect(got.code).toBe(1);
    expect(got.stdout).toContain('- `healthCheck` (http)');
  });

  it('exits 1 on an empty listing, which is zero registered, not unreadable', () => {
    expect(spawn([], '').code).toBe(1);
  });

  it('exits 2 on an unknown argument', () => {
    expect(spawn(['--bogus'], '').code).toBe(2);
  });
});
