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
 *      it implies (proposeFloors, below, which is pure and tested).
 *   3. Writes version-floors.json when any value moved, and prints a Markdown
 *      summary: each kind's old → new, and every pin in the tree that the new
 *      floors leave behind. The pull request the workflow opens carries that
 *      summary; its CI then fails on exactly those pins, which is the point.
 *
 * Exit 0 and no write when nothing moved: `checkedOn` moves only with its
 * entry, the same convention as AVM_VERIFIED_ON, so a quiet week is not a
 * pull request. `--dry-run` prints without writing; `--summary <path>` also
 * writes the summary to a file.
 *
 * WHAT IT REFUSES. A source that cannot be fetched or does not have the shape
 * below, a newest line OLDER than the one recorded, or a newest release older
 * than the recorded one on the same line ends the run with exit code 1 and one
 * sentence, and nothing is written: a floor that moves backwards is a source
 * problem, never a release.
 *
 * THE FUNCTIONS CEILING is read from the Learn page's "Supported language
 * stack versions" table, the one place Microsoft states it for Flex. When the
 * table cannot be found or read, the ceiling is left where it is and the
 * summary says so in a line the workflow raises as a warning; the rest of the
 * run still completes. The machine-readable source,
 * `az functionapp list-flexconsumption-runtimes`, needs an Azure sign-in, and
 * a scheduled job that opens pull requests should not hold one.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseArgs } from './lib/cli.mjs';
import {
  ENGINES_EXEMPT,
  collectPins,
  compareVersions,
  findViolations,
  minorFloor,
  parseVersion,
  patchFloor,
} from './version-floors.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_PATH = path.join(ROOT, 'scripts', 'version-floors.json');
const USAGE = 'Usage: node scripts/update-version-floors.mjs [--dry-run] [--summary <path>]';
const USER_AGENT = 'HCW-HybridCloudWorks update-version-floors (+https://github.com/HybridCloudWorks/HCW-HybridCloudWorks)';

export const PRODUCTS = { python: 'python', node: 'nodejs', ubuntu: 'ubuntu', debian: 'debian', terraform: 'terraform' };
export const eolUrl = (product) => `https://endoflife.date/api/v1/products/${product}/`;
export const FLEX_URL = 'https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan';

export class SourceError extends Error {}

/** The releases array of an endoflife.date v1 product document, validated. */
export function releasesOf(doc, product) {
  const releases = doc?.result?.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new SourceError(`endoflife.date ${product}: no result.releases array`);
  }
  for (const r of releases) {
    if (typeof r?.name !== 'string') throw new SourceError(`endoflife.date ${product}: a release has no name`);
  }
  return releases;
}

const released = (r, today) => !r.releaseDate || r.releaseDate <= today;
const byCycleDesc = (a, b) => compareVersions(b.name, a.name);

/**
 * The newest line that has shipped its N-2 release. A line is adopted once
 * its latest release is two steps past .0 at the rule's precision (3.15.2
 * for Python, 28.2.0 for Node.js), so the floor names a release two behind
 * rather than the first one out (#714: "after its N-2 patch exists"). Until
 * then the previous line stays, and its own newest release still counts.
 */
export function adoptLine(releases, { today, step, eligible = () => true, product }) {
  const index = step === 'patch' ? 2 : 1;
  const candidates = releases
    .filter((r) => released(r, today) && eligible(r) && parseVersion(r.name))
    .sort(byCycleDesc);
  for (const r of candidates) {
    const latest = parseVersion(r.latest?.name);
    if (!latest || latest.length !== 3) {
      throw new SourceError(`endoflife.date ${product}: ${r.name} has no MAJOR.MINOR.PATCH latest release`);
    }
    if (latest[index] >= 2) return { line: r.name, newest: r.latest.name };
  }
  throw new SourceError(`endoflife.date ${product}: no released line has reached its N-2 release`);
}

function cycle(releases, name, product) {
  const r = releases.find((x) => x.name === name);
  const latest = parseVersion(r?.latest?.name);
  if (!latest || latest.length !== 3) throw new SourceError(`endoflife.date ${product}: no latest release for line ${name}`);
  return r.latest.name;
}

const codenameOf = (r) => String(r.codename ?? '').trim().split(/\s+/)[0].toLowerCase();

/**
 * The Node.js lines the Flex Consumption table lists, or null when the table
 * or its Node.js row cannot be found. Entries marked preview are not GA and
 * are skipped.
 */
export function readFlexNodeLines(html) {
  const text = String(html ?? '');
  const start = text.indexOf('id="supported-language-stack-versions"');
  if (start === -1) return null;
  const end = text.indexOf('</table>', start);
  if (end === -1) return null;
  const table = text.slice(start, end);
  const row = /<tr>\s*<td[^>]*>\s*Node\.js\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>/i.exec(table);
  if (!row) return null;
  const lines = row[1]
    .split(',')
    .filter((entry) => !/preview/i.test(entry))
    .map((entry) => /Node\.js\s+(\d+)/i.exec(entry)?.[1])
    .filter(Boolean)
    .map(Number);
  return lines.length ? lines : null;
}

function refuseBackwards(kind, field, from, to) {
  if (from && to && compareVersions(to, from) < 0) {
    throw new SourceError(`${kind}: the source's ${field} ${to} is older than the recorded ${from}; not believed, nothing written`);
  }
}

/**
 * The floors the sources imply. Pure: `current` is the parsed floors file,
 * `sources.eol` maps each kind to its endoflife.date document, and
 * `sources.flexNodeLines` is readFlexNodeLines' result. Returns the next file
 * content, the list of moved values and the notes for the summary.
 */
export function proposeFloors(current, sources, today) {
  const next = structuredClone(current);
  const changes = [];
  const notes = [];
  const set = (kind, entry, field, value, label = kind) => {
    if (entry[field] === value) return;
    changes.push({ kind: label, field, from: entry[field], to: value });
    entry[field] = value;
    entry.checkedOn = today;
  };

  // Python and Terraform: newest line, N-2 patches.
  for (const kind of ['python', 'terraform']) {
    const entry = next.kinds[kind];
    const picked = adoptLine(releasesOf(sources.eol[kind], PRODUCTS[kind]), { today, step: 'patch', product: PRODUCTS[kind] });
    refuseBackwards(kind, 'line', entry.line, picked.line);
    if (picked.line === entry.line) refuseBackwards(kind, 'newest release', entry.newest, picked.newest);
    set(kind, entry, 'line', picked.line);
    set(kind, entry, 'newest', picked.newest);
    set(kind, entry, 'floor', patchFloor(picked.newest));
  }

  // Node.js: the newest line that is or will become LTS (a line with no
  // ltsFrom never gets long-term support and is skipped), N-2 minors.
  const nodeReleases = releasesOf(sources.eol.node, PRODUCTS.node);
  const node = next.kinds.node;
  const pickedNode = adoptLine(nodeReleases, {
    today,
    step: 'minor',
    eligible: (r) => r.isLts === true || Boolean(r.ltsFrom),
    product: PRODUCTS.node,
  });
  refuseBackwards('node', 'line', node.line, pickedNode.line);
  if (pickedNode.line === node.line) refuseBackwards('node', 'newest release', node.newest, pickedNode.newest);
  set('node', node, 'line', pickedNode.line);
  set('node', node, 'newest', pickedNode.newest);
  set('node', node, 'floor', minorFloor(pickedNode.newest));

  for (const [component, ceiling] of Object.entries(node.platformCeilings ?? {})) {
    const label = `node (${component} ceiling)`;
    let line = ceiling.line;
    const offered = component === 'functions' ? sources.flexNodeLines : null;
    if (!offered) {
      notes.push(
        `The ${ceiling.platform} table could not be read, so the ${component} ceiling stays at Node.js ${ceiling.line}; check ${ceiling.source} by hand.`
      );
    } else {
      const top = Math.max(...offered);
      if (top < Number(ceiling.line)) {
        notes.push(`${ceiling.platform} now lists Node.js ${offered.join(', ')}, below the recorded ceiling ${ceiling.line}; left unchanged for a human to read.`);
      } else if (top > Number(ceiling.line)) {
        line = String(Math.min(top, Number(node.line)));
        notes.push(`${ceiling.platform} now lists Node.js ${offered.join(', ')}: the ${component} ceiling moves to ${line}. Every pin it governs, and runtime_version in infra/functionapp.tf, moves with it; that is a production runtime change and a Terraform apply.`);
      }
    }
    set(label, ceiling, 'line', line);
    const newest = cycle(nodeReleases, line, PRODUCTS.node);
    if (line === current.kinds.node.platformCeilings[component].line) {
      refuseBackwards(label, 'newest release', current.kinds.node.platformCeilings[component].newest, newest);
    }
    set(label, ceiling, 'newest', newest);
    set(label, ceiling, 'floor', minorFloor(newest));
  }

  // Ubuntu: the newest LTS. Debian: the newest stable major.
  const ubuntu = next.kinds.ubuntu;
  const lts = releasesOf(sources.eol.ubuntu, PRODUCTS.ubuntu)
    .filter((r) => r.isLts === true && released(r, today) && /^\d+\.04$/.test(r.name))
    .sort(byCycleDesc)[0];
  if (!lts) throw new SourceError('endoflife.date ubuntu: no released LTS');
  refuseBackwards('ubuntu', 'newest LTS', ubuntu.newest, lts.name);
  set('ubuntu', ubuntu, 'newest', lts.name);
  set('ubuntu', ubuntu, 'floor', lts.name);
  const ubuntuCodename = codenameOf(lts);
  if (ubuntuCodename && ubuntu.codenames[ubuntuCodename] !== lts.name) {
    changes.push({ kind: 'ubuntu', field: `codenames.${ubuntuCodename}`, from: ubuntu.codenames[ubuntuCodename], to: lts.name });
    ubuntu.codenames[ubuntuCodename] = lts.name;
    ubuntu.checkedOn = today;
  }

  const debian = next.kinds.debian;
  const stable = releasesOf(sources.eol.debian, PRODUCTS.debian)
    .filter((r) => released(r, today) && /^\d+$/.test(r.name))
    .sort(byCycleDesc)[0];
  if (!stable) throw new SourceError('endoflife.date debian: no released major');
  refuseBackwards('debian', 'newest major', debian.newest, stable.name);
  set('debian', debian, 'newest', stable.name);
  set('debian', debian, 'floor', stable.name);
  const debianCodename = codenameOf(stable);
  if (debianCodename && debian.codenames[debianCodename] !== stable.name) {
    changes.push({ kind: 'debian', field: `codenames.${debianCodename}`, from: debian.codenames[debianCodename], to: stable.name });
    debian.codenames[debianCodename] = stable.name;
    debian.checkedOn = today;
  }

  return { next, changes, notes };
}

/** The file form the floors are kept in: two-space JSON and a final newline. */
export const serialise = (floors) => `${JSON.stringify(floors, null, 2)}\n`;

/** The Markdown the workflow puts in the step summary and the pull request body. */
export function renderSummary({ changes, notes, behind, today }) {
  const out = [`### Version floors, checked ${today}`, ''];
  if (changes.length === 0) {
    out.push('No floor moved.');
  } else {
    out.push('| Kind | Field | Was | Now |', '| --- | --- | --- | --- |');
    for (const c of changes) out.push(`| ${c.kind} | ${c.field} | ${c.from ?? '(none)'} | ${c.to} |`);
  }
  if (notes.length) {
    out.push('', '#### Notes', '');
    for (const n of notes) out.push(`- ${n}`);
  }
  out.push('', `#### Pins behind the ${changes.length ? 'new ' : ''}floors`, '');
  if (behind.length === 0) out.push('None.');
  else for (const f of behind) out.push(`- \`${f.file}${f.line ? `:${f.line}` : ''}\` (${f.where}): ${f.message}`);
  return `${out.join('\n')}\n`;
}

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

  const today = new Date().toISOString().slice(0, 10);
  const current = JSON.parse(await fs.readFile(FLOORS_PATH, 'utf8'));
  let proposal;
  try {
    const eol = {};
    for (const [kind, product] of Object.entries(PRODUCTS)) eol[kind] = await fetchJson(eolUrl(product));
    let flexNodeLines = null;
    try {
      flexNodeLines = readFlexNodeLines(await fetchText(FLEX_URL));
    } catch (err) {
      console.error(`::warning::${err.message}`);
    }
    proposal = proposeFloors(current, { eol, flexNodeLines }, today);
  } catch (err) {
    if (err instanceof SourceError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }

  const behind = findViolations(proposal.next, collectPins(ROOT, proposal.next), { enginesExempt: ENGINES_EXEMPT });
  const summary = renderSummary({ ...proposal, behind, today });
  process.stdout.write(summary);
  for (const note of proposal.notes) if (/could not be read/.test(note)) console.error(`::warning::${note}`);
  if (args.options.summary) await fs.writeFile(args.options.summary, summary);
  if (proposal.changes.length && !args.flags['dry-run']) await fs.writeFile(FLOORS_PATH, serialise(proposal.next));
  return 0;
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
