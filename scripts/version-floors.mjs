/**
 * Version floors: every runtime, OS and base image this repository chooses is
 * on its newest supported release, with one tolerance per kind (#715, #714).
 *
 * The floors live in scripts/version-floors.json, one entry per kind, each
 * with the newest release, the floor derived from it, the date it was read and
 * the URL it was read from. This module is the other half: it reads every pin
 * the repository actually carries and says which are below their floor.
 *
 *   - version-floors.test.mjs runs it against the real tree, so a pin that
 *     falls behind fails CI naming the file, the pin and the floor.
 *   - update-version-floors.mjs moves the floors when endoflife.date lists a
 *     newer release; the pull request it opens then goes red on exactly the
 *     pins that are now behind. That red is the point, not a defect.
 *
 * WHERE A PIN IS READ, and why each reader is a text scan rather than a
 * parse: nothing in this repository parses YAML or HCL, `scripts/` carries
 * two runtime dependencies on purpose, and workflow-write-permissions.test.mjs
 * set the precedent. Each reader over-reports rather than under-reports: a
 * value it cannot read is a finding ("cannot verify"), never a silent pass.
 *
 * This file owns no network, clock or process state. Reading the tree is the
 * only I/O, and `collectPins` takes the root so a test can point it at a
 * fixture.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

/**
 * Packages with no engines.node, each with the reason. A package.json that
 * has no engines and no entry here is a finding, so a new package cannot
 * arrive without a floor by accident.
 */
export const ENGINES_EXEMPT = {
  'edge/availability-probe/package.json':
    'A Cloudflare Worker: it runs on workerd, not Node.js, so an engines.node range would describe nothing that runs in production. Its node:test suite runs on the CI row, whose node-version this check governs.',
};

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** `26`, `26.10`, `26.10.0` → [26], [26, 10], [26, 10, 0]; anything else → null. */
export function parseVersion(text) {
  const value = String(text ?? '').trim();
  if (!/^\d+(\.\d+){0,2}$/.test(value)) return null;
  return value.split('.').map(Number);
}

/** Numeric comparison, shorter versions padded with zeros. */
export function compareVersions(a, b) {
  const x = Array.isArray(a) ? a : parseVersion(a);
  const y = Array.isArray(b) ? b : parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Does `pin` meet `floor`? A pin less precise than the floor floats: `3.14`
 * in `actions/setup-python` and `26` in `actions/setup-node` resolve to the
 * newest release on that line when the job runs, so they are compared at
 * their own precision (`3.14` against `3.14`, not against `3.14.5`).
 */
export function meetsFloor(pin, floor) {
  const p = parseVersion(pin);
  const f = parseVersion(floor);
  if (!p || !f) throw new Error(`not a version: ${!p ? pin : floor}`);
  return compareVersions(p, f.slice(0, Math.max(p.length, 1))) >= 0;
}

/** Newest release N at MAJOR.MINOR.PATCH → the floor two patch releases behind it. */
export function patchFloor(newest) {
  const [major, minor, patch] = parseVersion(newest) ?? [];
  if (patch === undefined) throw new Error(`patchFloor needs MAJOR.MINOR.PATCH, got ${newest}`);
  return `${major}.${minor}.${Math.max(patch - 2, 0)}`;
}

/** Newest release N at MAJOR.MINOR.PATCH → the floor two minor releases behind it. */
export function minorFloor(newest) {
  const [major, minor, patch] = parseVersion(newest) ?? [];
  if (patch === undefined) throw new Error(`minorFloor needs MAJOR.MINOR.PATCH, got ${newest}`);
  return `${major}.${Math.max(minor - 2, 0)}.0`;
}

// ---------------------------------------------------------------------------
// npm `engines` ranges — the subset package.json files actually use
// ---------------------------------------------------------------------------

function full(parts) {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function bump(parts, index) {
  const out = full(parts);
  out[index] += 1;
  for (let i = index + 1; i < 3; i += 1) out[i] = 0;
  return out;
}

/** One comparator token → primitive comparators ({ op, v }) over full versions. */
function expandComparator(token) {
  const m = /^(>=|<=|>|<|=|\^|~)?v?(\*|x|\d+(?:\.(?:\d+|x|\*)){0,2})$/i.exec(token);
  if (!m) throw new Error(`unsupported range token "${token}"`);
  const op = m[1] ?? '';
  const raw = m[2].toLowerCase();
  if (raw === '*' || raw === 'x') return op === '' || op === '>=' ? [] : [{ op: '<', v: [0, 0, 0] }];
  const parts = [];
  for (const piece of raw.split('.')) {
    if (piece === 'x' || piece === '*') break;
    parts.push(Number(piece));
  }
  const n = parts.length;
  const lo = full(parts);
  switch (op) {
    case '>=':
      return [{ op: '>=', v: lo }];
    case '>':
      return [{ op: '>=', v: n === 3 ? bump(lo, 2) : bump(lo, n - 1) }];
    case '<':
      return [{ op: '<', v: lo }];
    case '<=':
      return n === 3 ? [{ op: '<=', v: lo }] : [{ op: '<', v: bump(lo, n - 1) }];
    case '^': {
      const at = lo[0] > 0 || n === 1 ? 0 : lo[1] > 0 || n === 2 ? 1 : 2;
      return [
        { op: '>=', v: lo },
        { op: '<', v: bump(lo, at) },
      ];
    }
    case '~':
      return [
        { op: '>=', v: lo },
        { op: '<', v: bump(lo, n === 1 ? 0 : 1) },
      ];
    default:
      return n === 3
        ? [{ op: '=', v: lo }]
        : [
            { op: '>=', v: lo },
            { op: '<', v: bump(lo, n - 1) },
          ];
  }
}

/** `^24.19.0 || >=26.8.0` → [[comparators], [comparators]]. Throws on syntax it does not know. */
export function parseNpmRange(range) {
  const text = String(range ?? '').trim();
  if (!text) throw new Error('empty range');
  return text.split('||').map((alternative) => {
    const set = alternative.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    if (set === '') return [];
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(set);
    if (hyphen) return [...expandComparator(`>=${hyphen[1]}`), ...expandComparator(`<=${hyphen[2]}`)];
    return set.split(/\s+/).flatMap(expandComparator);
  });
}

function passes(version, { op, v }) {
  const d = compareVersions(version, v);
  if (op === '>=') return d >= 0;
  if (op === '<=') return d <= 0;
  if (op === '<') return d < 0;
  return d === 0;
}

/** Does the npm range admit this exact version? */
export function npmRangeAdmits(range, version) {
  const v = full(parseVersion(version) ?? []);
  return parseNpmRange(range).some((set) => set.every((c) => passes(v, c)));
}

/** The lowest version the npm range admits, as MAJOR.MINOR.PATCH, or null when it admits none. */
export function npmRangeMinimum(range) {
  let best = null;
  for (const set of parseNpmRange(range)) {
    let lo = [0, 0, 0];
    for (const c of set) if ((c.op === '>=' || c.op === '=') && compareVersions(c.v, lo) > 0) lo = c.v;
    if (!set.every((c) => passes(lo, c))) continue;
    if (!best || compareVersions(lo, best) < 0) best = lo;
  }
  return best ? best.join('.') : null;
}

// ---------------------------------------------------------------------------
// Terraform `required_version` constraints
// ---------------------------------------------------------------------------

/** Does a Terraform version constraint (`~> 1.6`, `>= 1.12, < 2.0`) admit this version? */
export function terraformConstraintAdmits(constraint, version) {
  const v = full(parseVersion(version) ?? []);
  return String(constraint)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .every((part) => {
      const m = /^(=|!=|>=|<=|>|<|~>)?\s*v?(\d+(?:\.\d+){0,2})$/.exec(part);
      if (!m) throw new Error(`unsupported Terraform constraint "${part}"`);
      const op = m[1] ?? '=';
      const parts = parseVersion(m[2]);
      const lo = full(parts);
      const d = compareVersions(v, lo);
      switch (op) {
        case '=':
          return d === 0;
        case '!=':
          return d !== 0;
        case '>=':
          return d >= 0;
        case '>':
          return d > 0;
        case '<=':
          return d <= 0;
        case '<':
          return d < 0;
        default: {
          // ~> increments the second-to-last given component: ~> 1.6 is
          // >= 1.6, < 2.0; ~> 1.6.2 is >= 1.6.2, < 1.7.0.
          const upper = bump(lo, Math.max(parts.length - 2, 0));
          return d >= 0 && compareVersions(v, upper) < 0;
        }
      }
    });
}

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

function trackedFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    // A fixture directory that is not a repository: walk it instead.
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (['node_modules', '.git', '.terraform'].includes(entry.name)) continue;
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(rel);
        else out.push(rel);
      }
    };
    walk('');
    return out;
  }
}

function read(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}

/** A YAML scalar with any trailing ` # comment` removed (quoted values keep their `#`). */
function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith("'") || v.startsWith('"')) {
    const q = v[0];
    const end = v.indexOf(q, 1);
    return end === -1 ? v : v.slice(0, end + 1);
  }
  return v.replace(/\s+#.*$/, '').trim();
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The label of the YAML sequence item that holds line `at`: the nearest
 * preceding `- ` line indented less than it, named by its `name:` (a step or
 * a matrix row) or, failing that, by its `uses:` without the ref.
 */
function itemLabel(lines, at, stopAt) {
  const indent = indentOf(lines[at]);
  for (let i = at - 1; i > stopAt; i -= 1) {
    const line = lines[i];
    if (!/^\s*- /.test(line) || indentOf(line) >= indent) continue;
    const dash = indentOf(line);
    const own = /^\s*-\s+name:\s*(.+)$/.exec(line);
    if (own) return unquote(scalar(own[1]));
    for (let j = i + 1; j < at; j += 1) {
      if (indentOf(lines[j]) !== dash + 2) continue;
      const named = /^\s*name:\s*(.+)$/.exec(lines[j]);
      if (named) return unquote(scalar(named[1]));
    }
    const uses = /^\s*-\s+uses:\s*([^@\s]+)/.exec(line);
    return uses ? `uses ${uses[1]}` : `item at line ${i + 1}`;
  }
  return null;
}

/**
 * Every Node.js, Python and Terraform version a workflow pins.
 *
 * `node-version:` is read as a literal, as a matrix row's literal, or as
 * `${{ matrix.node-version || 'N' }}`, whose default is itself a pin (it is
 * what a row without its own value gets). Any other expression, and any
 * `node-version-file:`, is reported as unverifiable rather than passed. A
 * setup-node or setup-python step naming no version at all is reported too:
 * it runs whatever the runner image ships.
 */
export function readWorkflow(file, source) {
  const lines = source.split(/\r?\n/);
  const pins = [];
  const problems = [];
  let inJobs = false;
  let job = null;
  let jobLine = -1;

  const where = (i) => [file, job, itemLabel(lines, i, jobLine)].filter(Boolean).join(' > ');

  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (/^jobs:\s*(#.*)?$/.test(line)) {
      inJobs = true;
      return;
    }
    if (/^\S/.test(line)) inJobs = false;
    const jobMatch = inJobs && /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (jobMatch) {
      job = jobMatch[1];
      jobLine = i;
      return;
    }

    const key = /^\s*(node-version|node-version-file|python-version|python-version-file|terraform_version):\s*(.*)$/.exec(line);
    if (key) {
      const [, name, rest] = key;
      const value = unquote(scalar(rest));
      const at = { file, line: i + 1, where: where(i), raw: value };
      const kind = name.startsWith('node') ? 'node' : name.startsWith('python') ? 'python' : 'terraform';
      if (name.endsWith('-file')) {
        problems.push({ ...at, kind, message: `${name} is not read by the floors check; pin the version inline` });
        return;
      }
      if (kind === 'terraform' && value === 'latest') return;
      const fallback = /^\$\{\{\s*matrix\.[A-Za-z0-9_-]+\s*\|\|\s*'([^']+)'\s*\}\}$/.exec(value);
      if (fallback) {
        pins.push({ ...at, kind, version: fallback[1], where: `${at.where} (matrix default)` });
        return;
      }
      if (!parseVersion(value)) {
        problems.push({ ...at, kind, message: `${name}: ${value} is not a literal version the floors check can read` });
        return;
      }
      pins.push({ ...at, kind, version: value });
    }

    const setup = /^(\s*)(-\s+)?uses:\s*actions\/setup-(node|python)@/.exec(line);
    if (setup) {
      const want = `${setup[3]}-version`;
      let dash = i;
      if (!setup[2]) {
        for (let k = i - 1; k > jobLine; k -= 1) {
          if (/^\s*- /.test(lines[k]) && indentOf(lines[k]) < indentOf(line)) {
            dash = k;
            break;
          }
        }
      }
      const dashIndent = indentOf(lines[dash]);
      let found = false;
      for (let k = dash + 1; k < lines.length; k += 1) {
        if (lines[k].trim() !== '' && indentOf(lines[k]) <= dashIndent) break;
        if (new RegExp(`^\\s*${want}(-file)?:`).test(lines[k])) found = true;
      }
      if (!found) {
        problems.push({
          file,
          line: i + 1,
          where: where(i),
          kind: setup[3],
          raw: '',
          message: `actions/setup-${setup[3]} names no ${want}, so it runs whatever the runner ships`,
        });
      }
    }
  });
  return { pins, problems };
}

/** A Dockerfile's governed `FROM` images: python, node, debian and ubuntu tags. */
export function readDockerfile(file, source, floors) {
  const pins = [];
  const problems = [];
  const stages = new Set();
  const debianCodenames = floors.kinds.debian.codenames;
  const ubuntuCodenames = floors.kinds.ubuntu.codenames;

  source.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(line);
    if (!m) return;
    const [, ref, alias] = m;
    if (alias) stages.add(alias.toLowerCase());
    const at = { file, line: i + 1, where: `${file} > FROM ${ref.split('@')[0]}`, raw: ref };
    if (stages.has(ref.toLowerCase()) && ref.toLowerCase() !== alias?.toLowerCase()) return;
    if (ref.includes('$')) {
      problems.push({ ...at, kind: 'image', message: `FROM ${ref} is computed; the floors check reads literal images only` });
      return;
    }
    const noDigest = ref.split('@')[0];
    const colon = noDigest.lastIndexOf(':');
    const slash = noDigest.lastIndexOf('/');
    const name = colon > slash ? noDigest.slice(0, colon) : noDigest;
    const tag = colon > slash ? noDigest.slice(colon + 1) : 'latest';
    const image = name.replace(/^(docker\.io\/)?(library\/)?/, '');

    const codenameIn = (map) =>
      tag
        .toLowerCase()
        .split(/[-_.]/)
        .find((token) => Object.hasOwn(map, token));

    if (image === 'python' || image === 'node') {
      const version = /^(\d+(?:\.\d+){0,2})/.exec(tag)?.[1];
      if (!version) {
        problems.push({ ...at, kind: image, message: `${image}:${tag} names no version line` });
        return;
      }
      pins.push({ ...at, kind: image === 'node' ? 'node' : 'python', version });
      const codename = codenameIn(debianCodenames);
      if (codename) pins.push({ ...at, kind: 'debian', version: debianCodenames[codename], codename });
      return;
    }
    if (image === 'debian') {
      const numeric = /^(\d+)/.exec(tag)?.[1];
      const codename = codenameIn(debianCodenames);
      const version = numeric ?? (codename ? debianCodenames[codename] : null);
      if (!version) {
        problems.push({ ...at, kind: 'debian', message: `debian:${tag} is not a release the floors file knows; add its codename to kinds.debian.codenames` });
        return;
      }
      pins.push({ ...at, kind: 'debian', version, codename });
      return;
    }
    if (image === 'ubuntu') {
      const numeric = /^(\d+\.\d+)/.exec(tag)?.[1];
      const codename = codenameIn(ubuntuCodenames);
      const version = numeric ?? (codename ? ubuntuCodenames[codename] : null);
      if (!version) {
        problems.push({ ...at, kind: 'ubuntu', message: `ubuntu:${tag} is not a release the floors file knows; add its codename to kinds.ubuntu.codenames` });
        return;
      }
      pins.push({ ...at, kind: 'ubuntu', version, codename });
    }
  });
  return { pins, problems };
}

/** The lab host's pins: its Node.js package, its Ubuntu target and its control-side Python. */
export function readLabHost(root) {
  const pins = [];
  const problems = [];
  const groupVarsPath = 'lab-host/ansible/group_vars/all.yml';
  const bootstrapPath = 'lab-host/bootstrap.sh';
  const sitePath = 'lab-host/ansible/site.yml';

  if (existsSync(join(root, groupVarsPath))) {
    const lines = read(root, groupVarsPath).split(/\r?\n/);
    const nodeAt = lines.findIndex((l) => /^labs_agent_node_version:/.test(l));
    if (nodeAt === -1) {
      problems.push({ file: groupVarsPath, line: 0, where: groupVarsPath, kind: 'node', raw: '', message: 'labs_agent_node_version is missing' });
    } else {
      const raw = unquote(scalar(lines[nodeAt].replace(/^labs_agent_node_version:/, '')));
      const version = /^(\d+\.\d+\.\d+)/.exec(raw)?.[1];
      const at = { file: groupVarsPath, line: nodeAt + 1, where: `${groupVarsPath} > labs_agent_node_version`, raw };
      if (version) pins.push({ ...at, kind: 'node', version });
      else problems.push({ ...at, kind: 'node', message: `labs_agent_node_version ${raw} does not start with MAJOR.MINOR.PATCH` });
    }

    // The Ubuntu target: the newest release the play accepts. An older LTS
    // it still accepts as a fallback is compatibility, not a choice.
    const mapAt = lines.findIndex((l) => /^lab_host_ubuntu_releases:\s*$/.test(l));
    const releases = [];
    if (mapAt !== -1) {
      for (let k = mapAt + 1; k < lines.length && /^\s+\S/.test(lines[k]); k += 1) {
        const entry = /^\s+[a-z]+:\s*["']?(\d+\.\d+)["']?/.exec(lines[k]);
        if (entry) releases.push({ version: entry[1], line: k + 1 });
      }
      pushTarget(pins, problems, groupVarsPath, 'lab_host_ubuntu_releases', releases);
    } else if (existsSync(join(root, sitePath))) {
      read(root, sitePath)
        .split(/\r?\n/)
        .forEach((l, k) => {
          const m = /distribution_version'?\]?\s*==\s*'(\d+\.\d+)'/.exec(l);
          if (m) releases.push({ version: m[1], line: k + 1 });
        });
      pushTarget(pins, problems, sitePath, 'distribution_version', releases);
    }
  }

  if (existsSync(join(root, bootstrapPath))) {
    const lines = read(root, bootstrapPath).split(/\r?\n/);
    const releases = [];
    lines.forEach((l, k) => {
      if (/^\s*#/.test(l)) return;
      const m = /VERSION_ID="(\d+\.\d+)"/.exec(l) ?? /"ubuntu (\d+\.\d+)"\)/.exec(l);
      if (m) releases.push({ version: m[1], line: k + 1 });
    });
    pushTarget(pins, problems, bootstrapPath, 'accepted Ubuntu releases', releases);

    const pyAt = lines.findIndex((l) => /^PYTHON_VERSION=/.test(l));
    if (pyAt === -1) {
      problems.push({
        file: bootstrapPath,
        line: 0,
        where: `${bootstrapPath} > PYTHON_VERSION`,
        kind: 'python',
        raw: '',
        message: 'no PYTHON_VERSION pin: the control-side Python is whatever the distribution ships',
      });
    } else {
      const raw = unquote(lines[pyAt].replace(/^PYTHON_VERSION=/, '').replace(/\s+#.*$/, ''));
      const at = { file: bootstrapPath, line: pyAt + 1, where: `${bootstrapPath} > PYTHON_VERSION`, raw };
      if (parseVersion(raw)) pins.push({ ...at, kind: 'python', version: raw });
      else problems.push({ ...at, kind: 'python', message: `PYTHON_VERSION=${raw} is not a version` });
    }
  }
  return { pins, problems };
}

function pushTarget(pins, problems, file, label, releases) {
  if (releases.length === 0) {
    problems.push({ file, line: 0, where: `${file} > ${label}`, kind: 'ubuntu', raw: '', message: `no Ubuntu release found in ${label}` });
    return;
  }
  const target = releases.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  pins.push({
    file,
    line: target.line,
    where: `${file} > ${label} (target)`,
    raw: releases.map((r) => r.version).join(', '),
    kind: 'ubuntu',
    version: target.version,
  });
}

/**
 * Every pin in the tree, and every place a pin should be but cannot be read.
 * `files` defaults to `git ls-files`, so an untracked file never counts.
 */
export function collectPins(root, floors, files = trackedFiles(root)) {
  const pins = [];
  const problems = [];
  const add = (result) => {
    pins.push(...result.pins);
    problems.push(...result.problems);
  };

  for (const file of files) {
    const base = posix.basename(file);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) add(readWorkflow(file, read(root, file)));
    else if (/^Dockerfile(\..+)?$|\.Dockerfile$/.test(base)) add(readDockerfile(file, read(root, file), floors));
    else if (base === '.nvmrc' || base === '.node-version' || base === '.python-version') {
      // nvm, fnm, volta and pyenv read the first line; `v26` and `26` alike.
      const kind = base === '.python-version' ? 'python' : 'node';
      const raw = read(root, file).split(/\r?\n/)[0].trim();
      const value = raw.replace(/^v/, '');
      const at = { file, line: 1, where: file, raw, kind };
      if (parseVersion(value)) pins.push({ ...at, version: value });
      else problems.push({ ...at, message: `${base} names "${raw}", not a version the floors check can read` });
    } else if (base === 'package.json') {
      let engines;
      try {
        engines = JSON.parse(read(root, file)).engines?.node;
      } catch (err) {
        problems.push({ file, line: 0, where: file, kind: 'node', raw: '', message: `unreadable JSON: ${err.message}` });
        continue;
      }
      if (engines === undefined) {
        pins.push({ file, line: 0, where: `${file} > engines.node`, kind: 'node', raw: '', version: null, missing: true });
        continue;
      }
      const line = read(root, file).split(/\r?\n/).findIndex((l) => /"node"\s*:/.test(l)) + 1;
      pins.push({ file, line, where: `${file} > engines.node`, kind: 'node', raw: engines, range: engines });
    } else if (file.endsWith('.tf')) {
      // runtime_version is a Node.js pin only under runtime_name = "node";
      // a Python or .NET app's version is not this kind's to judge.
      let runtimeName = null;
      read(root, file)
        .split(/\r?\n/)
        .forEach((l, i) => {
          const m = /^\s*required_version\s*=\s*"([^"]+)"/.exec(l);
          if (m) pins.push({ file, line: i + 1, where: `${file} > required_version`, kind: 'terraform', raw: m[1], constraint: m[1] });
          const rn = /^\s*runtime_name\s*=\s*"([^"]+)"/.exec(l);
          if (rn) runtimeName = rn[1];
          const rt = /^\s*runtime_version\s*=\s*"([^"]+)"/.exec(l);
          if (rt && runtimeName === 'node') {
            pins.push({ file, line: i + 1, where: `${file} > runtime_version`, kind: 'node', raw: rt[1], version: rt[1] });
          }
        });
    }
  }

  const avm = 'frontend/src/lib/landingZone/avmVersions.js';
  if (files.includes(avm)) {
    read(root, avm)
      .split(/\r?\n/)
      .forEach((l, i) => {
        const m = /TERRAFORM_REQUIRED_VERSION\s*=\s*'([^']+)'/.exec(l);
        if (m) pins.push({ file: avm, line: i + 1, where: `${avm} > TERRAFORM_REQUIRED_VERSION`, kind: 'terraform', raw: m[1], constraint: m[1] });
      });
  }
  const versionsEnv = 'lab-image/versions.env';
  if (files.includes(versionsEnv)) {
    read(root, versionsEnv)
      .split(/\r?\n/)
      .forEach((l, i) => {
        const m = /^TERRAFORM_VERSION=(\S+)/.exec(l);
        if (m) pins.push({ file: versionsEnv, line: i + 1, where: `${versionsEnv} > TERRAFORM_VERSION`, kind: 'terraform', raw: m[1], version: m[1] });
      });
  }

  add(readLabHost(root));
  return { pins, problems };
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/** `.github/workflows/ci.yml > verify > functions (azure)` matches that pin and anything beneath it. */
export function selectorMatches(selector, where) {
  return where === selector || where.startsWith(`${selector} > `) || where.startsWith(`${selector} (`);
}

/** The platform ceiling that governs a pin, if any. */
export function ceilingFor(pin, floors) {
  if (pin.kind !== 'node') return null;
  for (const [component, ceiling] of Object.entries(floors.kinds.node.platformCeilings ?? {})) {
    if (ceiling.appliesTo.some((s) => selectorMatches(s, pin.where))) return { component, ...ceiling };
  }
  return null;
}

const nextLine = (line) => `${Number(line) + 1}.0.0`;

/**
 * Judge one pin. Returns null when it meets its rule, or one sentence saying
 * what it is, what it must be and why.
 */
export function judge(pin, floors) {
  const kind = floors.kinds[pin.kind];
  if (!kind) return `no floor is recorded for kind "${pin.kind}"`;
  const ceiling = ceilingFor(pin, floors);

  if (pin.range !== undefined) {
    let minimum;
    try {
      minimum = npmRangeMinimum(pin.range);
    } catch (err) {
      return `engines.node "${pin.range}" cannot be read (${err.message})`;
    }
    if (!minimum) return `engines.node "${pin.range}" admits no version`;
    if (ceiling) {
      if (!meetsFloor(minimum, ceiling.floor) || String(parseVersion(minimum)[0]) !== ceiling.line) {
        return `engines.node "${pin.range}" admits ${minimum}; ${ceiling.platform} holds this component at Node.js ${ceiling.line}, floor ${ceiling.floor}`;
      }
      if (!npmRangeAdmits(pin.range, ceiling.newest)) {
        return `engines.node "${pin.range}" does not admit ${ceiling.newest}, the newest Node.js ${ceiling.line}`;
      }
      if (npmRangeAdmits(pin.range, nextLine(ceiling.line))) {
        return `engines.node "${pin.range}" admits Node.js ${Number(ceiling.line) + 1}+, which ${ceiling.platform} does not run`;
      }
      return null;
    }
    if (!meetsFloor(minimum, kind.floor)) return `engines.node "${pin.range}" admits ${minimum}, below the floor ${kind.floor}`;
    if (!npmRangeAdmits(pin.range, kind.newest)) return `engines.node "${pin.range}" does not admit ${kind.newest}, the newest release`;
    return null;
  }

  if (pin.constraint !== undefined) {
    let admits;
    try {
      admits = terraformConstraintAdmits(pin.constraint, kind.newest);
    } catch (err) {
      return `required_version "${pin.constraint}" cannot be read (${err.message})`;
    }
    return admits ? null : `required_version "${pin.constraint}" does not admit ${kind.newest}, the newest release`;
  }

  if (!parseVersion(pin.version)) return `"${pin.raw}" is not a version the floors check can read`;

  if (ceiling) {
    if (String(parseVersion(pin.version)[0]) !== ceiling.line) {
      return `${pin.version} must be Node.js ${ceiling.line}: ${ceiling.platform} supports Node.js ${ceiling.line} at most, and the rule is the newest line the platform allows`;
    }
    return meetsFloor(pin.version, ceiling.floor) ? null : `${pin.version} is below the floor ${ceiling.floor} for Node.js ${ceiling.line}`;
  }

  if (!meetsFloor(pin.version, kind.floor)) {
    const shown = pin.codename ? `${pin.version} (${pin.codename})` : pin.version;
    return `${shown} is below the floor ${kind.floor}`;
  }
  if (pin.kind === 'ubuntu' && !/^\d*[02468]\.04$/.test(pin.version)) {
    return `${pin.version} is an interim release; the rule is the newest LTS only`;
  }
  return null;
}

/**
 * Every finding in the tree: pins below their floor, pins that cannot be
 * read, and ceiling selectors that no longer match anything (a renamed job
 * would otherwise silently move a functions pin under the general floor).
 */
export function findViolations(floors, { pins, problems }, { enginesExempt = {} } = {}) {
  const findings = [];
  for (const pin of pins) {
    if (pin.missing) {
      if (!Object.hasOwn(enginesExempt, pin.file)) {
        findings.push({ ...pin, message: 'no engines.node: every package declares the Node.js floor it runs on' });
      }
      continue;
    }
    const message = judge(pin, floors);
    if (message) findings.push({ ...pin, message });
  }
  for (const problem of problems) findings.push(problem);
  for (const [component, ceiling] of Object.entries(floors.kinds.node.platformCeilings ?? {})) {
    for (const selector of ceiling.appliesTo) {
      if (!pins.some((p) => p.kind === 'node' && selectorMatches(selector, p.where))) {
        findings.push({
          file: 'scripts/version-floors.json',
          line: 0,
          where: `kinds.node.platformCeilings.${component}.appliesTo`,
          kind: 'node',
          raw: selector,
          message: `"${selector}" matches no Node.js pin; it was renamed or removed, so the ${component} ceiling no longer covers it`,
        });
      }
    }
  }
  return findings;
}

/** `file:line  where  message`, one per finding, for a failing assertion to print. */
export function formatFindings(findings) {
  return findings
    .map((f) => `${f.file}${f.line ? `:${f.line}` : ''}  [${f.kind}] ${f.where}\n    ${f.message}`)
    .join('\n');
}

/** Load scripts/version-floors.json from the repository root. */
export function loadFloors(root) {
  return JSON.parse(read(root, 'scripts/version-floors.json'));
}
