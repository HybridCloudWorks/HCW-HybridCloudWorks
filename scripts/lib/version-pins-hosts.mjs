/**
 * The version pins of the things that run code (#715): the base images in
 * tracked Dockerfiles, and the lab host's Node.js package, Ubuntu target,
 * control-side Python and Coder's PostgreSQL.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { compareVersions, parseVersion } from './version-math.mjs';
import { clean, empty, isComment, linesOf, merge, read, unquote } from './pin-text.mjs';

// ---------------------------------------------------------------------------
// Dockerfiles
// ---------------------------------------------------------------------------

/** `name:tag@digest` → { image, tag }, with Docker Hub's library prefix removed. */
function splitImage(ref) {
  const noDigest = ref.split('@')[0];
  const colon = noDigest.lastIndexOf(':');
  const hasTag = colon > noDigest.lastIndexOf('/');
  const name = hasTag ? noDigest.slice(0, colon) : noDigest;
  return {
    image: name.replace(/^(docker\.io\/)?(library\/)?/, ''),
    tag: hasTag ? noDigest.slice(colon + 1) : 'latest',
  };
}

/** The codename a tag names (`slim-trixie` → trixie), if the map knows it. */
const codenameIn = (tag, map) =>
  tag
    .toLowerCase()
    .split(/[-_.]/)
    .find((token) => Object.hasOwn(map, token));

/** python:3.14.7-slim-trixie → a python pin, and a debian pin for the release beneath it. */
function runtimeImage(kind, tag, at, floors) {
  const version = /^(\d+(?:\.\d+){0,2})/.exec(tag)?.[1];
  if (!version) return { pins: [], problems: [{ ...at, kind, message: `${kind}:${tag} names no version line` }] };
  const debian = floors.kinds.debian.codenames;
  const codename = codenameIn(tag, debian);
  const pins = [{ ...at, kind, version }];
  if (codename) pins.push({ ...at, kind: 'debian', version: debian[codename], codename });
  return { pins, problems: [] };
}

/** debian:bookworm-slim, debian:13, ubuntu:26.04, ubuntu:noble → a pin of that distribution. */
function distroImage(kind, numeric, tag, at, floors) {
  const map = floors.kinds[kind].codenames;
  const codename = codenameIn(tag, map);
  const version = numeric.exec(tag)?.[1] ?? (codename ? map[codename] : null);
  if (version) return { pins: [{ ...at, kind, version, codename }], problems: [] };
  const message = `${kind}:${tag} is not a release the floors file knows; add its codename to kinds.${kind}.codenames`;
  return { pins: [], problems: [{ ...at, kind, message }] };
}

const IMAGE_READERS = {
  python: (tag, at, floors) => runtimeImage('python', tag, at, floors),
  node: (tag, at, floors) => runtimeImage('node', tag, at, floors),
  debian: (tag, at, floors) => distroImage('debian', /^(\d+)/, tag, at, floors),
  ubuntu: (tag, at, floors) => distroImage('ubuntu', /^(\d+\.\d+)/, tag, at, floors),
};

const FROM = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i;

/** One FROM reference: a computed image is a problem, an ungoverned image nothing. */
function readImage(ref, at, floors) {
  if (ref.includes('$')) {
    return { pins: [], problems: [{ ...at, kind: 'image', message: `FROM ${ref} is computed; the floors check reads literal images only` }] };
  }
  const { image, tag } = splitImage(ref);
  return IMAGE_READERS[image]?.(tag, at, floors) ?? empty();
}

/** A Dockerfile's governed `FROM` images: python, node, debian and ubuntu tags. Build stages are skipped. */
export function readDockerfile(file, source, floors) {
  const stages = new Set();
  const results = linesOf(source).flatMap((line, i) => {
    const m = FROM.exec(line);
    if (!m) return [];
    const [, ref, alias] = m;
    const isStage = stages.has(ref.toLowerCase());
    if (alias) stages.add(alias.toLowerCase());
    if (isStage) return [];
    return [readImage(ref, { file, line: i + 1, where: `${file} > FROM ${ref.split('@')[0]}`, raw: ref }, floors)];
  });
  return merge(results);
}

// ---------------------------------------------------------------------------
// The lab host
// ---------------------------------------------------------------------------

const GROUP_VARS = 'lab-host/ansible/group_vars/all.yml';
const BOOTSTRAP = 'lab-host/bootstrap.sh';
const SITE = 'lab-host/ansible/site.yml';

/** The newest of the releases a host accepts is its target; an older accepted LTS is a fallback. */
function ubuntuTarget(file, label, releases) {
  const where = `${file} > ${label}`;
  if (releases.length === 0) {
    return { pins: [], problems: [{ file, line: 0, where, kind: 'ubuntu', raw: '', message: `no Ubuntu release found in ${label}` }] };
  }
  const target = releases.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a));
  const raw = releases.map((r) => r.version).join(', ');
  return { pins: [{ file, line: target.line, where: `${where} (target)`, raw, kind: 'ubuntu', version: target.version }], problems: [] };
}

/** Every non-comment line of `lines` matching `pattern`, as { version: first group, line }. */
const matching = (lines, pattern) =>
  lines.flatMap((l, k) => {
    const m = !isComment(l) && pattern.exec(l);
    return m ? [{ version: m[1], line: k + 1 }] : [];
  });

/** labs_agent_node_version: the NodeSource package string, read as its MAJOR.MINOR.PATCH. */
function agentNode(lines) {
  const at = lines.findIndex((l) => /^labs_agent_node_version:/.test(l));
  const base = { file: GROUP_VARS, where: `${GROUP_VARS} > labs_agent_node_version`, kind: 'node' };
  if (at === -1) return { pins: [], problems: [{ ...base, line: 0, raw: '', message: 'labs_agent_node_version is missing' }] };
  const raw = clean(lines[at].replace(/^labs_agent_node_version:/, ''));
  const version = /^(\d+\.\d+\.\d+)/.exec(raw)?.[1];
  if (version) return { pins: [{ ...base, line: at + 1, raw, version }], problems: [] };
  return { pins: [], problems: [{ ...base, line: at + 1, raw, message: `labs_agent_node_version ${raw} does not start with MAJOR.MINOR.PATCH` }] };
}

/**
 * coder_postgres_image_tag: the PostgreSQL release Coder's database digest
 * was read from (the image runs by digest; the tag records which release that
 * is). Exactly MAJOR.MINOR: a major-only tag (18) names whatever is newest
 * that day, and a beta or release candidate (19beta4) is not a general
 * release, so either is a problem rather than a pin.
 */
function coderPostgres(lines) {
  const at = lines.findIndex((l) => /^coder_postgres_image_tag:/.test(l));
  const base = { file: GROUP_VARS, where: `${GROUP_VARS} > coder_postgres_image_tag`, kind: 'postgresql' };
  if (at === -1) return { pins: [], problems: [{ ...base, line: 0, raw: '', message: 'coder_postgres_image_tag is missing' }] };
  const raw = clean(lines[at].replace(/^coder_postgres_image_tag:/, ''));
  if (/^\d+\.\d+$/.test(raw)) return { pins: [{ ...base, line: at + 1, raw, version: raw }], problems: [] };
  return {
    pins: [],
    problems: [
      {
        ...base,
        line: at + 1,
        raw,
        message: `coder_postgres_image_tag ${raw} is not a general release as MAJOR.MINOR: a major-only tag moves, and a beta or release candidate is not a general release`,
      },
    ],
  };
}

/** lab_host_ubuntu_releases in group_vars, or, before that map existed, site.yml's distribution_version check. */
function playbookUbuntu(root, lines) {
  const mapAt = lines.findIndex((l) => /^lab_host_ubuntu_releases:\s*$/.test(l));
  if (mapAt === -1) {
    if (!existsSync(join(root, SITE))) return empty();
    return ubuntuTarget(SITE, 'distribution_version', matching(linesOf(read(root, SITE)), /distribution_version'?\]?\s*==\s*'(\d+\.\d+)'/));
  }
  const end = lines.findIndex((l, k) => k > mapAt && !/^\s+\S/.test(l));
  const entries = lines.slice(mapAt + 1, end === -1 ? undefined : end);
  const releases = matching(entries, /^\s+[a-z]+:\s*["']?(\d+\.\d+)["']?/).map((r) => ({ ...r, line: r.line + mapAt + 1 }));
  return ubuntuTarget(GROUP_VARS, 'lab_host_ubuntu_releases', releases);
}

/** PYTHON_VERSION in bootstrap.sh: the interpreter uv installs for Ansible's control side. */
function bootstrapPython(lines) {
  const at = lines.findIndex((l) => /^PYTHON_VERSION=/.test(l));
  const base = { file: BOOTSTRAP, where: `${BOOTSTRAP} > PYTHON_VERSION`, kind: 'python' };
  if (at === -1) {
    return { pins: [], problems: [{ ...base, line: 0, raw: '', message: 'no PYTHON_VERSION pin: the control-side Python is whatever the distribution ships' }] };
  }
  const raw = unquote(lines[at].replace(/^PYTHON_VERSION=/, '').replace(/\s+#.*$/, ''));
  if (parseVersion(raw)) return { pins: [{ ...base, line: at + 1, raw, version: raw }], problems: [] };
  return { pins: [], problems: [{ ...base, line: at + 1, raw, message: `PYTHON_VERSION=${raw} is not a version` }] };
}

/**
 * bootstrap.sh: the Ubuntu releases it accepts and its Python pin. Before
 * the Ubuntu 26.04 change it tested VERSION_ID; after it, a case statement
 * accepts each release by name. Either form is read.
 */
function bootstrap(root) {
  if (!existsSync(join(root, BOOTSTRAP))) return empty();
  const lines = linesOf(read(root, BOOTSTRAP));
  const accepted = [...matching(lines, /VERSION_ID="(\d+\.\d+)"/), ...matching(lines, /"ubuntu (\d+\.\d+)"\)/)];
  return merge([ubuntuTarget(BOOTSTRAP, 'accepted Ubuntu releases', accepted), bootstrapPython(lines)]);
}

/** The lab host's pins: its Node.js package, its Ubuntu target, its control-side Python and Coder's PostgreSQL. */
export function readLabHost(root) {
  if (!existsSync(join(root, GROUP_VARS))) return bootstrap(root);
  const lines = linesOf(read(root, GROUP_VARS));
  return merge([agentNode(lines), playbookUbuntu(root, lines), bootstrap(root), coderPostgres(lines)]);
}
