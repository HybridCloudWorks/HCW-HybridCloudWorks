/**
 * Which floors the sources imply (#715): the decisions behind
 * scripts/update-version-floors.mjs, which owns the network, the filesystem
 * and the clock and re-exports everything here. The same split as
 * frontend/scripts/avm-versions-edits.mjs and update-avm-versions.mjs.
 *
 * Every rule here is stated in scripts/version-floors.json, per kind, in the
 * entry's `rule`. What this adds is what the updater refuses to believe: a
 * source without the v1 shape, or a newest line or release older than the
 * one recorded. A floor that moves backwards is a source problem, never a
 * release, and it ends the run with nothing written.
 */
import { compareVersions, majorMinorFloor, minorFloor, parseVersion, patchFloor } from './version-math.mjs';

export const PRODUCTS = {
  python: 'python',
  node: 'nodejs',
  ubuntu: 'ubuntu',
  debian: 'debian',
  terraform: 'terraform',
  postgresql: 'postgresql',
  vault: 'hashicorp-vault',
};

export class SourceError extends Error {}

/** The releases array of an endoflife.date v1 product document, validated. */
export function releasesOf(doc, product) {
  const releases = doc?.result?.releases;
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new SourceError(`endoflife.date ${product}: no result.releases array`);
  }
  if (releases.some((r) => typeof r?.name !== 'string')) throw new SourceError(`endoflife.date ${product}: a release has no name`);
  return releases;
}

const released = (r, today) => !r.releaseDate || r.releaseDate <= today;
const byCycleDesc = (a, b) => compareVersions(b.name, a.name);
const codenameOf = (r) => String(r.codename ?? '').trim().split(/\s+/)[0].toLowerCase();

/** A cycle's latest release as MAJOR.MINOR.PATCH, or a SourceError naming the line. */
function latestOf(r, product) {
  const latest = parseVersion(r?.latest?.name);
  if (!latest || latest.length !== 3) throw new SourceError(`endoflife.date ${product}: ${r?.name} has no MAJOR.MINOR.PATCH latest release`);
  return latest;
}

/**
 * The newest line that has shipped its N-2 release. A line is adopted once
 * its latest release is two steps past .0 at the rule's precision (3.15.2
 * for Python, 28.2.0 for Node.js), so the floor names a release two behind
 * rather than the first one out (#714: "after its N-2 patch exists"). Until
 * then the previous line stays, and its own newest release still counts.
 */
export function adoptLine(releases, { today, step, eligible = () => true, product }) {
  const index = step === 'patch' ? 2 : 1;
  const candidates = releases.filter((r) => released(r, today) && eligible(r) && parseVersion(r.name)).sort(byCycleDesc);
  const adopted = candidates.find((r) => latestOf(r, product)[index] >= 2);
  if (!adopted) throw new SourceError(`endoflife.date ${product}: no released line has reached its N-2 release`);
  return { line: adopted.name, newest: adopted.latest.name };
}

/** The latest release of one named line. */
function cycleNewest(releases, name, product) {
  const r = releases.find((x) => x.name === name);
  if (!r) throw new SourceError(`endoflife.date ${product}: no line ${name}`);
  latestOf(r, product);
  return r.latest.name;
}

/**
 * The Node.js lines the Flex Consumption table lists, or null when the table
 * or its Node.js row cannot be found. Entries marked preview are not GA and
 * are skipped.
 */
export function readFlexNodeLines(html) {
  const text = String(html ?? '');
  const start = text.indexOf('id="supported-language-stack-versions"');
  const end = start === -1 ? -1 : text.indexOf('</table>', start);
  const row = end === -1 ? null : /<tr>\s*<td[^>]*>\s*Node\.js\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>/i.exec(text.slice(start, end));
  const lines = (row?.[1] ?? '')
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

/** Records each moved value and dates the entry it moved in. */
function recorder(today) {
  const changes = [];
  const set = (label, entry, field, value) => {
    if (entry[field] === value) return;
    changes.push({ kind: label, field, from: entry[field], to: value });
    entry[field] = value;
    entry.checkedOn = today;
  };
  return { changes, set, today };
}

/** A line pick applied to an entry: never an older line, never an older release on the same line. */
function applyLine(record, label, entry, picked, floorOf) {
  refuseBackwards(label, 'line', entry.line, picked.line);
  if (picked.line === entry.line) refuseBackwards(label, 'newest release', entry.newest, picked.newest);
  record.set(label, entry, 'line', picked.line);
  record.set(label, entry, 'newest', picked.newest);
  record.set(label, entry, 'floor', floorOf(picked.newest));
}

/** Python and Terraform: newest line, N-2 patches. */
function proposePatchKind(run, kind) {
  const product = PRODUCTS[kind];
  const picked = adoptLine(releasesOf(run.sources.eol[kind], product), { today: run.today, step: 'patch', product });
  applyLine(run.record, kind, run.next.kinds[kind], picked, patchFloor);
}

/**
 * PostgreSQL: the newest major that has shipped its N-2 minor release, N-2
 * minors, general releases only. endoflife.date lists a major from its
 * general release, and a major whose latest release is not MAJOR.MINOR
 * (19beta4, 19rc1) is skipped here as well, so a pre-release can never be
 * proposed however the source changes. Until a new major reaches .2, the
 * previous one stays and its own newest release still counts.
 */
function proposePostgresql(run) {
  const product = PRODUCTS.postgresql;
  const general = (r) => /^\d+$/.test(r.name) && /^\d+\.\d+$/.test(String(r.latest?.name ?? ''));
  const adopted = releasesOf(run.sources.eol.postgresql, product)
    .filter((r) => released(r, run.today) && general(r))
    .sort(byCycleDesc)
    .find((r) => parseVersion(r.latest.name)[1] >= 2);
  if (!adopted) throw new SourceError(`endoflife.date ${product}: no released major has reached its N-2 minor release`);
  applyLine(run.record, 'postgresql', run.next.kinds.postgresql, { line: adopted.name, newest: adopted.latest.name }, majorMinorFloor);
}

/**
 * HashiCorp Vault: the newest released line, N-2 patches, adopted the day it
 * is released. There is no N-2 wait as for Python, because HashiCorp ends the
 * previous community line that day (endoflife.date dates 2.0's end of life
 * 2026-08-31, the date it gives for 2.1's release), so waiting would hold the
 * pin on an unsupported line. A line whose latest release is not
 * MAJOR.MINOR.PATCH (a release candidate) is skipped.
 */
function proposeVault(run) {
  const product = PRODUCTS.vault;
  const newest = releasesOf(run.sources.eol.vault, product)
    .filter((r) => released(r, run.today) && /^\d+\.\d+$/.test(r.name) && /^\d+\.\d+\.\d+$/.test(String(r.latest?.name ?? '')))
    .sort(byCycleDesc)[0];
  if (!newest) throw new SourceError(`endoflife.date ${product}: no released line with a MAJOR.MINOR.PATCH release`);
  applyLine(run.record, 'vault', run.next.kinds.vault, { line: newest.name, newest: newest.latest.name }, patchFloor);
}

/**
 * Node.js: the newest line that is or will become LTS (a line with no
 * ltsFrom never gets long-term support and is skipped), N-2 minors.
 */
function proposeNode(run) {
  const picked = adoptLine(run.nodeReleases, {
    today: run.today,
    step: 'minor',
    eligible: (r) => r.isLts === true || Boolean(r.ltsFrom),
    product: PRODUCTS.node,
  });
  applyLine(run.record, 'node', run.next.kinds.node, picked, minorFloor);
}

/**
 * The line a platform ceiling moves to, and the note that explains it. It
 * never moves down, and never past the newest line the rule allows.
 */
function ceilingLine(ceiling, component, offered, nodeLine) {
  if (!offered) {
    return {
      line: ceiling.line,
      note: `The ${ceiling.platform} table could not be read, so the ${component} ceiling stays at Node.js ${ceiling.line}; check ${ceiling.source} by hand.`,
    };
  }
  const top = Math.max(...offered);
  if (top < Number(ceiling.line)) {
    return {
      line: ceiling.line,
      note: `${ceiling.platform} now lists Node.js ${offered.join(', ')}, below the recorded ceiling ${ceiling.line}; left unchanged for a human to read.`,
    };
  }
  if (top === Number(ceiling.line)) return { line: ceiling.line, note: null };
  const line = String(Math.min(top, Number(nodeLine)));
  return {
    line,
    note: `${ceiling.platform} now lists Node.js ${offered.join(', ')}: the ${component} ceiling moves to ${line}. Every pin it governs, and runtime_version in infra/functionapp.tf, moves with it; that is a production runtime change and a Terraform apply.`,
  };
}

/** Each platform ceiling: its line from the platform's own table, its newest and floor from endoflife.date. */
function proposeCeilings(run) {
  const { next, current, record } = run;
  for (const [component, ceiling] of Object.entries(next.kinds.node.platformCeilings ?? {})) {
    const label = `node (${component} ceiling)`;
    const offered = component === 'functions' ? run.sources.flexNodeLines : null;
    const { line, note } = ceilingLine(ceiling, component, offered, next.kinds.node.line);
    if (note) run.notes.push(note);
    const before = current.kinds.node.platformCeilings[component];
    const newest = cycleNewest(run.nodeReleases, line, PRODUCTS.node);
    if (line === before.line) refuseBackwards(label, 'newest release', before.newest, newest);
    record.set(label, ceiling, 'line', line);
    record.set(label, ceiling, 'newest', newest);
    record.set(label, ceiling, 'floor', minorFloor(newest));
  }
}

/** Adds the release's codename to the entry's map, so a FROM line naming it can be read. */
function learnCodename(record, kind, entry, pick) {
  const codename = codenameOf(pick);
  if (!codename || entry.codenames[codename] === pick.name) return;
  record.changes.push({ kind, field: `codenames.${codename}`, from: entry.codenames[codename], to: pick.name });
  entry.codenames[codename] = pick.name;
  entry.checkedOn = record.today;
}

/** Ubuntu's newest LTS or Debian's newest major, as newest and floor both, and its codename learned. */
function proposeDistribution(run, kind, pick) {
  const { record } = run;
  const entry = run.next.kinds[kind];
  refuseBackwards(kind, 'newest release', entry.newest, pick.name);
  record.set(kind, entry, 'newest', pick.name);
  record.set(kind, entry, 'floor', pick.name);
  learnCodename(record, kind, entry, pick);
}

function newestLts(sources, today) {
  const lts = releasesOf(sources.eol.ubuntu, PRODUCTS.ubuntu)
    .filter((r) => r.isLts === true && released(r, today) && /^\d+\.04$/.test(r.name))
    .sort(byCycleDesc)[0];
  if (!lts) throw new SourceError('endoflife.date ubuntu: no released LTS');
  return lts;
}

function newestStable(sources, today) {
  const stable = releasesOf(sources.eol.debian, PRODUCTS.debian)
    .filter((r) => released(r, today) && /^\d+$/.test(r.name))
    .sort(byCycleDesc)[0];
  if (!stable) throw new SourceError('endoflife.date debian: no released major');
  return stable;
}

/**
 * The floors the sources imply. Pure: `current` is the parsed floors file,
 * `sources.eol` maps each kind to its endoflife.date document, and
 * `sources.flexNodeLines` is readFlexNodeLines' result. Returns the next file
 * content, the list of moved values and the notes for the summary.
 */
export function proposeFloors(current, sources, today) {
  // One run: what was read, what is being built, and what moved.
  const run = {
    current,
    sources,
    today,
    next: structuredClone(current),
    record: recorder(today),
    notes: [],
    nodeReleases: releasesOf(sources.eol.node, PRODUCTS.node),
  };
  proposePatchKind(run, 'python');
  proposePatchKind(run, 'terraform');
  proposeNode(run);
  proposeCeilings(run);
  proposeDistribution(run, 'ubuntu', newestLts(sources, today));
  proposeDistribution(run, 'debian', newestStable(sources, today));
  proposePostgresql(run);
  proposeVault(run);
  return { next: run.next, changes: run.record.changes, notes: run.notes };
}

/** The file form the floors are kept in: two-space JSON and a final newline. */
export const serialise = (floors) => `${JSON.stringify(floors, null, 2)}\n`;

/** The Markdown the workflow puts in the step summary and the pull request body. */
export function renderSummary({ changes, notes, behind, today }) {
  const table = changes.length
    ? ['| Kind | Field | Was | Now |', '| --- | --- | --- | --- |', ...changes.map((c) => `| ${c.kind} | ${c.field} | ${c.from ?? '(none)'} | ${c.to} |`)]
    : ['No floor moved.'];
  const noteLines = notes.length ? ['', '#### Notes', '', ...notes.map((n) => `- ${n}`)] : [];
  const pins = behind.length
    ? behind.map((f) => `- \`${f.file}${f.line ? `:${f.line}` : ''}\` (${f.where}): ${f.message}`)
    : ['None.'];
  const heading = `#### Pins behind the ${changes.length ? 'new ' : ''}floors`;
  return `${[`### Version floors, checked ${today}`, '', ...table, ...noteLines, '', heading, '', ...pins].join('\n')}\n`;
}
