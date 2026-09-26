// The privilege boundary ADR 0032 draws around a Coder workspace, as a test
// over the two files that define it (issue #679, from the boundary comment on
// the issue):
//
//   1. the Docker socket is mounted into the `coder` server service only;
//   2. nothing is `privileged`;
//   3. the workspace mounts no host path, only its own named volume;
//   4. the workspace joins its own bridge network, not the Compose network;
//   5. the workspace runs as uid 65534.
//
// Text-level on purpose: no YAML or HCL parser is a dependency of this
// directory, and the assertions are about what a reviewer would grep for.
// Run with `node --test` from lab-host/coder (npm test does the same).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mainTf = readFileSync(join(here, 'main.tf'), 'utf8');
const compose = readFileSync(join(here, '..', '..', 'docker-compose.yml'), 'utf8');

// A line of HCL or YAML with its trailing `#` comment removed. Comments in
// both files talk about the socket and about `privileged` by name, so the
// assertions look at code, not prose.
function stripComment(line) {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

const codeLines = (text) => text.split('\n').map(stripComment);

// Split the Compose file's `services:` map into { name: [lines] } by
// indentation: a service starts at two spaces, its body is deeper.
function composeServices(text) {
  const lines = codeLines(text);
  const services = {};
  let inServices = false;
  let current = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inServices = line.startsWith('services:');
      current = null;
      continue;
    }
    if (!inServices) continue;
    const service = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (service) {
      current = service[1];
      services[current] = [];
      continue;
    }
    if (current && line.trim() !== '') services[current].push(line);
  }
  return services;
}

// Top-level HCL blocks as { header, body } so a `volumes {` inside the
// container can be inspected without a parser.
function hclBlocks(text, header) {
  const blocks = [];
  const lines = codeLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith(header)) continue;
    let depth = 0;
    const body = [];
    for (let j = i; j < lines.length; j += 1) {
      depth += (lines[j].match(/\{/g) || []).length;
      depth -= (lines[j].match(/\}/g) || []).length;
      body.push(lines[j]);
      if (depth === 0) break;
    }
    blocks.push({ header: lines[i], body: body.join('\n') });
  }
  return blocks;
}

// Nested blocks of one name inside a body, by brace matching.
function nestedBlocks(body, name) {
  const found = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`^\\s*${name}\\s*\\{`).test(lines[i])) continue;
    let depth = 0;
    const block = [];
    for (let j = i; j < lines.length; j += 1) {
      depth += (lines[j].match(/\{/g) || []).length;
      depth -= (lines[j].match(/\}/g) || []).length;
      block.push(lines[j]);
      if (depth === 0) break;
    }
    found.push(block.join('\n'));
  }
  return found;
}

const services = composeServices(compose);
const containers = hclBlocks(mainTf, 'resource "docker_container"');

test('the Compose file defines exactly the two services ADR 0032 names', () => {
  assert.deepEqual(Object.keys(services).sort(), ['coder', 'coder-postgres']);
});

test('the Docker socket is mounted into the coder service and nowhere else', () => {
  const socketLines = (lines) => lines.filter((line) => line.includes('docker.sock'));
  assert.equal(socketLines(services.coder).length, 1, 'coder mounts the socket once');
  assert.ok(
    /^\s*-\s*\/var\/run\/docker\.sock:\/var\/run\/docker\.sock\s*$/.test(socketLines(services.coder)[0]),
    'the mount is the plain socket path, not a directory above it',
  );
  assert.equal(socketLines(services['coder-postgres']).length, 0, 'postgres never sees the socket');
  assert.equal(codeLines(mainTf).filter((line) => line.includes('docker.sock')).length, 0, 'the template never names the socket');
  assert.equal(codeLines(mainTf).filter((line) => /\/var\/run\b/.test(line)).length, 0, 'the template never reaches under /var/run');
});

test('the coder server keeps its non-root user and joins the docker group by GID', () => {
  assert.ok(services.coder.some((line) => /^\s*group_add:\s*$/.test(line)), 'group_add is present');
  assert.ok(services.coder.some((line) => /^\s*-\s*"\$\{DOCKER_GID/.test(line)), 'the GID comes from the role-written .env');
  assert.equal(services.coder.filter((line) => /^\s*user:/.test(line)).length, 0, 'no user: override, so the image default (non-root coder) stands');
});

test('nothing in either file is privileged', () => {
  for (const [name, lines] of Object.entries(services)) {
    assert.equal(lines.filter((line) => /privileged/.test(line)).length, 0, `${name} has no privileged key`);
  }
  const privileged = codeLines(mainTf).filter((line) => /\bprivileged\b/.test(line));
  assert.ok(privileged.length >= 1, 'the template states privileged explicitly');
  for (const line of privileged) {
    assert.match(line, /^\s*privileged\s*=\s*false\s*$/, 'and it is false');
  }
});

test('the workspace mounts no host path', () => {
  assert.equal(containers.length, 1, 'one workspace container resource');
  const [container] = containers;
  const volumes = nestedBlocks(container.body, 'volumes');
  assert.equal(volumes.length, 1, 'exactly one volumes block');
  assert.match(volumes[0], /volume_name\s*=\s*docker_volume\./, 'it is the named volume');
  assert.doesNotMatch(volumes[0], /host_path/, 'and it has no host_path');
  assert.equal(nestedBlocks(container.body, 'mounts').length, 0, 'no mounts blocks (bind mounts live there)');
  assert.doesNotMatch(container.body, /host_path/, 'no host_path anywhere in the container');
  assert.doesNotMatch(container.body, /devices\s*\{/, 'no device passthrough');
});

test('the workspace joins its own bridge network, not the Compose network', () => {
  const [container] = containers;
  assert.doesNotMatch(container.body, /network_mode/, 'no network_mode (host, none, container: or a named network by string)');
  const attach = nestedBlocks(container.body, 'networks_advanced');
  assert.equal(attach.length, 1, 'attached to exactly one network');
  assert.match(attach[0], /name\s*=\s*docker_network\.workspace\[count\.index\]\.name/, 'the per-workspace docker_network resource');
  const networks = hclBlocks(mainTf, 'resource "docker_network"');
  assert.equal(networks.length, 1);
  assert.match(networks[0].body, /name\s*=\s*"coder-ws-\$\{data\.coder_workspace\.me\.id\}"/, 'named per workspace');
  assert.match(networks[0].body, /driver\s*=\s*"bridge"/);
  assert.match(networks[0].body, /count\s*=\s*data\.coder_workspace\.me\.start_count/, 'removed with the container');
  const composeNetwork = compose.match(/^networks:\n(?:\s*#.*\n)*\s+([A-Za-z0-9_-]+):/m);
  assert.ok(composeNetwork, 'the Compose file names its network');
  assert.doesNotMatch(networks[0].body, new RegExp(`"${composeNetwork[1]}"`), 'the workspace network is not the Compose network');
  assert.doesNotMatch(container.body, new RegExp(`"${composeNetwork[1]}"`), 'the container never names the Compose network');
});

test('the workspace runs as uid 65534 with hard limits and no capabilities', () => {
  const [container] = containers;
  assert.match(container.body, /^\s*user\s*=\s*"65534:65534"\s*$/m);
  assert.match(container.body, /^\s*memory\s*=\s*local\.memory_mib\s*$/m);
  assert.match(mainTf, /memory_mib\s*=\s*2048/);
  assert.match(container.body, /^\s*cpu_quota\s*=\s*local\.cpu_quota\s*$/m);
  assert.match(mainTf, /cpu_quota\s*=\s*100000/);
  assert.match(mainTf, /cpu_period\s*=\s*100000/);
  assert.match(container.body, /security_opts\s*=\s*\["no-new-privileges:true"\]/);
  const caps = nestedBlocks(container.body, 'capabilities');
  assert.equal(caps.length, 1);
  assert.match(caps[0], /drop\s*=\s*\["ALL"\]/);
  assert.doesNotMatch(caps[0], /\badd\b/);
});

test('the workspace takes its passwd from the image, not an upload', () => {
  // The hcw-lab image gives uid 65534 /bin/bash and /tmp/home (#693, #698),
  // so the template writes no file into the container before it starts.
  const [container] = containers;
  assert.equal(nestedBlocks(container.body, 'upload').length, 0);
  assert.doesNotMatch(mainTf, /^\s*passwd\s*=/m);
});

test('the workspace image is the hcw-lab digest and Coder itself binds to loopback only', () => {
  assert.match(mainTf, /ghcr\.io\/hybridcloudworks\/hcw-lab@\$\{local\.image_digest\}/);
  assert.match(mainTf, /image_digest\s*=\s*"sha256:[0-9a-f]{64}"/);
  const ports = services.coder.filter((line) => /^\s*-\s*"/.test(line) && /:\d+:\d+"/.test(line));
  assert.equal(ports.length, 1);
  assert.match(ports[0], /"127\.0\.0\.1:7080:7080"/);
  assert.equal(services['coder-postgres'].filter((line) => /^\s*ports:/.test(line)).length, 0, 'postgres publishes nothing');
});
