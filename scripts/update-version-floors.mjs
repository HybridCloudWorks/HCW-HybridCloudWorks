/**
 * Move the floors in scripts/version-floors.json when a newer release ships
 * (#715, #714).
 *
 * What it does, in order:
 *
 *   1. Reads https://endoflife.date/api/v1/products/<name>/ for python,
 *      nodejs, ubuntu, debian and terraform, and the Azure Functions Flex
 *      Consumption page on Microsoft Learn for the Node.js lines Flex offers.
 *   2. Works out, per kind, the newest release the rule allows and the floor
 *      it implies (lib/version-floor-proposals.mjs, pure and tested).
 *   3. Writes version-floors.json when any value moved, and prints a Markdown
 *      summary: each kind's old → new, and every pin in the tree that the new
 *      floors leave behind. The pull request the workflow opens carries that
 *      summary; its CI then fails on exactly those pins, which is the point.
 *
 * Exit 0 and no write when nothing moved: `checkedOn` moves only with its
 * entry, the same convention as AVM_VERIFIED_ON, so a quiet week is not a
 * pull request. `--dry-run` prints without writing; `--summary <path>` also
 * writes the summary to a file. Exit 1 and one sentence, with nothing
 * written, when a source cannot be read or goes backwards; exit 2 on a bad
 * argument.
 *
 * THE FUNCTIONS CEILING is read from the Learn page's "Supported language
 * stack versions" table, the one place Microsoft states it for Flex. When the
 * table cannot be found or read, the ceiling is left where it is and the
 * summary says so in a line raised as a warning; the rest of the run still
 * completes. The machine-readable source,
 * `az functionapp list-flexconsumption-runtimes`, needs an Azure sign-in, and
 * a scheduled job that opens pull requests should not hold one.
 *
 * TWO FILES. This one owns everything that touches the network, the
 * filesystem or the clock; lib/version-floor-proposals.mjs owns the decisions
 * and is re-exported here so a test imports from one place.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseArgs } from './lib/cli.mjs';
import { PRODUCTS, SourceError, proposeFloors, readFlexNodeLines, renderSummary, serialise } from './lib/version-floor-proposals.mjs';
import { ENGINES_EXEMPT, collectPins, findViolations } from './version-floors.mjs';

export * from './lib/version-floor-proposals.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_PATH = path.join(ROOT, 'scripts', 'version-floors.json');
const USAGE = 'Usage: node scripts/update-version-floors.mjs [--dry-run] [--summary <path>]';
const USER_AGENT = 'HCW-HybridCloudWorks update-version-floors (+https://github.com/HybridCloudWorks/HCW-HybridCloudWorks)';

export const eolUrl = (product) => `https://endoflife.date/api/v1/products/${product}/`;
export const FLEX_URL = 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan';

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    throw new SourceError(`${url}: ${err.message}`);
  }
  if (!response.ok) throw new SourceError(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError(`${url}: not JSON`);
  }
}

/** Every source, read. The Learn table may fail on its own without failing the run. */
async function readSources() {
  const eol = {};
  for (const [kind, product] of Object.entries(PRODUCTS)) eol[kind] = await fetchJson(eolUrl(product));
  let flexNodeLines = null;
  try {
    flexNodeLines = readFlexNodeLines(await fetchText(FLEX_URL));
  } catch (err) {
    console.error(`::warning::${err.message}`);
  }
  return { eol, flexNodeLines };
}

async function run(args) {
  const today = new Date().toISOString().slice(0, 10);
  const current = JSON.parse(await fs.readFile(FLOORS_PATH, 'utf8'));
  const proposal = proposeFloors(current, await readSources(), today);
  const behind = findViolations(proposal.next, collectPins(ROOT, proposal.next), { enginesExempt: ENGINES_EXEMPT });
  const summary = renderSummary({ ...proposal, behind, today });
  process.stdout.write(summary);
  for (const note of proposal.notes.filter((n) => /could not be read/.test(n))) console.error(`::warning::${note}`);
  if (args.options.summary) await fs.writeFile(args.options.summary, summary);
  if (proposal.changes.length && !args.flags['dry-run']) await fs.writeFile(FLOORS_PATH, serialise(proposal.next));
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv, { flags: ['dry-run', 'help'], options: ['summary'] });
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (args.flags.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    await run(args);
    return 0;
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    console.error(err.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
