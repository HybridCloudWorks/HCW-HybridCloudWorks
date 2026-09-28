/**
 * The lab host pulls every pinned job image before a job needs it, and
 * removes the digests a pin no longer names (lab-host/ansible/roles/
 * lab_images). The list comes from the pins themselves, read on the host by
 * lab-images.mjs, never from a copy: a bump to IMAGES in
 * vps-agent/lib/capabilities.js, or to the workspace image in the Coder
 * template, must reach the host with no second edit.
 *
 * So this test holds the helper to the two files as they are in this
 * repository (the CLI Ansible runs, against this checkout, prints exactly
 * IMAGES and the template's image), and holds the plan to what the role
 * promises: pulls by repository@digest, removals only inside the lab's own
 * repositories, never a pinned digest, never an image a container uses.
 *
 * In the CI matrix this runs in the `scripts (operations)` row, whose filter
 * already covers lab-host/ and vps-agent/lib/capabilities.js.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPABILITIES_FILE,
  LAB_REPOSITORY_PATTERN,
  WORKSPACE_TEMPLATE_FILE,
  parseReference,
  planImages,
  readPins,
  workspaceImageFromTemplate,
} from '../lab-host/ansible/roles/lab_images/files/lab-images.mjs';
import { IMAGES } from '../vps-agent/lib/capabilities.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const helper = path.join(repoRoot, 'lab-host', 'ansible', 'roles', 'lab_images', 'files', 'lab-images.mjs');
const templateText = readFileSync(path.join(repoRoot, WORKSPACE_TEMPLATE_FILE), 'utf8');

const hex = (c) => c.repeat(64);
const RUNNER = 'ghcr.io/hybridcloudworks/hcw-lab-runner';
const WORKSPACE = 'ghcr.io/hybridcloudworks/hcw-lab';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'lab-images-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let fixtureCount = 0;
/** A checkout holding only the two files the helper reads. */
function fixtureCheckout({ images, template }) {
  const root = path.join(scratch, `checkout-${(fixtureCount += 1)}`);
  mkdirSync(path.join(root, path.dirname(CAPABILITIES_FILE)), { recursive: true });
  mkdirSync(path.join(root, path.dirname(WORKSPACE_TEMPLATE_FILE)), { recursive: true });
  writeFileSync(path.join(root, CAPABILITIES_FILE), `export const IMAGES = ${JSON.stringify(images)};\n`);
  writeFileSync(path.join(root, WORKSPACE_TEMPLATE_FILE), template);
  return root;
}

function templateWith(digest, repository = WORKSPACE) {
  return [
    'locals {',
    '  # image_digest = "sha256:' + hex('0') + '" (a comment is not a pin)',
    `  image_tag    = "7c0a95b2ac8d48f77d8c01f71a187b02e2cd284b"`,
    `  image_digest = "${digest}"`,
    `  image        = "${repository}@\${local.image_digest}"`,
    '}',
    'resource "docker_container" "workspace" {',
    '  image = docker_image.hcw_lab.image_id',
    '}',
    '',
  ].join('\n');
}

const image = (id, refs) => ({
  Id: `sha256:${id}`,
  RepoTags: refs.filter((r) => !r.includes('@')),
  RepoDigests: refs.filter((r) => r.includes('@')),
});

describe('the pins, read from this repository', () => {
  it('are exactly the values of IMAGES in capabilities.js, in order', async () => {
    const pins = await readPins(repoRoot);
    expect(pins.capabilities.map((p) => p.reference)).toEqual(Object.values(IMAGES));
    expect(pins.capabilities.length).toBeGreaterThan(0);
  });

  it('pull each capability image as repository@digest, the tag dropped', async () => {
    const pins = await readPins(repoRoot);
    for (const pin of pins.capabilities) {
      const [name, digest] = pin.reference.split('@');
      expect(pin.pull).toBe(`${parseReference(name).repository}@${digest}`);
      expect(pin.pull).not.toMatch(/:[^/@]*@/);
    }
  });

  it('include the workspace image the Coder template runs, from its image and image_digest locals', async () => {
    const pins = await readPins(repoRoot);
    expect(pins.workspace.repository).toMatch(LAB_REPOSITORY_PATTERN);
    expect(pins.workspace.pull).toBe(`${pins.workspace.repository}@${pins.workspace.digest}`);
    const digestLines = templateText.split('\n').filter((line) => line.includes(pins.workspace.digest));
    expect(digestLines).toHaveLength(1);
    expect(digestLines[0]).toMatch(/^\s*image_digest\s*=/);
  });

  it('are what the CLI prints for this checkout, the command the role runs', () => {
    const out = execFileSync(process.execPath, [helper, repoRoot], {
      input: JSON.stringify({ images: [], containers: [] }),
      encoding: 'utf8',
    });
    const plan = JSON.parse(out);
    const capabilityPulls = Object.values(IMAGES).map((ref) => {
      const [name, digest] = ref.split('@');
      return `${parseReference(name).repository}@${digest}`;
    });
    expect(plan.pull).toEqual(capabilityPulls);
    expect(plan.pinned).toHaveLength(capabilityPulls.length + 1);
    expect(plan.remove).toEqual([]);
  });

  it('adds the workspace image to the pulls only with --pull-workspace', () => {
    const run = (args) =>
      JSON.parse(execFileSync(process.execPath, [helper, ...args], { input: '', encoding: 'utf8' }));
    const off = run([repoRoot]);
    const on = run(['--pull-workspace', repoRoot]);
    expect(on.pull).toHaveLength(off.pull.length + 1);
    expect(on.pull.at(-1)).toMatch(new RegExp(`^${WORKSPACE}@sha256:[0-9a-f]{64}$`));
    expect(off.pinned).toEqual(on.pinned);
  });
});

describe('a pin that is not a digest reference', () => {
  it('fails, naming the IMAGES entry', async () => {
    const root = fixtureCheckout({
      images: { alpine: 'alpine:3.24.2', runner: `${RUNNER}:abc@sha256:${hex('1')}` },
      template: templateWith(`sha256:${hex('2')}`),
    });
    await expect(readPins(root)).rejects.toThrow(/IMAGES\.alpine .* is "alpine:3\.24\.2", which is not an image pinned by digest/);
  });

  it('fails the CLI with exit code 1 and the reason on stderr', () => {
    const root = fixtureCheckout({
      images: { alpine: 'alpine@sha256:short' },
      template: templateWith(`sha256:${hex('2')}`),
    });
    let failure;
    try {
      execFileSync(process.execPath, [helper, root], { input: '', encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    expect(failure?.status).toBe(1);
    expect(failure.stderr).toMatch(/^lab-images: IMAGES\.alpine /);
  });

  it('fails when the template no longer has the image locals the plan reads', () => {
    expect(() => workspaceImageFromTemplate('locals {\n  image = "x"\n}\n', 'main.tf')).toThrow(
      /main\.tf: expected exactly one `image_digest = "sha256:<64 hex>"` local, found 0/
    );
    const twice = templateWith(`sha256:${hex('2')}`) + `locals {\n  image_digest = "sha256:${hex('3')}"\n}\n`;
    expect(() => workspaceImageFromTemplate(twice, 'main.tf')).toThrow(/found 2/);
  });

  it('fails when capabilities.js is missing from a checkout', async () => {
    await expect(readPins(path.join(scratch, 'no-such-checkout'))).rejects.toThrow();
  });
});

describe('references', () => {
  it('compare in Docker\'s familiar form, as /images/json lists them', () => {
    expect(parseReference(`docker.io/library/alpine:3.24.2@sha256:${hex('a')}`)).toEqual({
      repository: 'alpine',
      tag: '3.24.2',
      digest: `sha256:${hex('a')}`,
    });
    expect(parseReference(`alpine@sha256:${hex('a')}`).repository).toBe('alpine');
    expect(parseReference('docker.io/alpine/ansible:2.17.0').repository).toBe('alpine/ansible');
    expect(parseReference('localhost:5000/team/app:1').repository).toBe('localhost:5000/team/app');
  });

  it('are not parsed out of Docker\'s placeholders', () => {
    expect(parseReference('<none>:<none>')).toBeNull();
    expect(parseReference('<none>@<none>')).toBeNull();
  });
});

describe('the plan', () => {
  const alpine = `alpine:3.24.2@sha256:${hex('a')}`;
  const runnerNew = `${RUNNER}:new@sha256:${hex('b')}`;
  const workspaceDigest = `sha256:${hex('c')}`;
  const current = () => fixtureCheckout({ images: { alpine, hcwLabRunner: runnerNew }, template: templateWith(workspaceDigest) });

  it('pulls a bumped digest and removes the one it replaced', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [
        image(hex('a'), [`alpine@sha256:${hex('a')}`]),
        image(hex('9'), [`${RUNNER}@sha256:${hex('9')}`]),
      ],
    });
    expect(plan.pull).toEqual([`alpine@sha256:${hex('a')}`, `${RUNNER}@sha256:${hex('b')}`]);
    expect(plan.remove).toEqual([`${RUNNER}@sha256:${hex('9')}`]);
    expect(plan.in_use).toEqual([]);
  });

  it('never lists a pinned digest, whatever else the image carries', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [
        // The containerd image store lists a digest pull under RepoTags too.
        { Id: `sha256:${hex('b')}`, RepoTags: [`${RUNNER}@sha256:${hex('b')}`], RepoDigests: [`${RUNNER}@sha256:${hex('b')}`] },
        image(hex('a'), [`alpine:3.24.2`, `alpine@sha256:${hex('a')}`]),
      ],
    });
    expect(plan.remove).toEqual([]);
  });

  it('keeps the pinned workspace image while Coder is off, and does not pull it', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      pullWorkspace: false,
      images: [image(hex('c'), [`${WORKSPACE}@${workspaceDigest}`]), image(hex('8'), [`${WORKSPACE}@sha256:${hex('8')}`])],
    });
    expect(plan.pull).not.toContain(`${WORKSPACE}@${workspaceDigest}`);
    expect(plan.pinned).toContain(`${WORKSPACE}@${workspaceDigest}`);
    expect(plan.remove).toEqual([`${WORKSPACE}@sha256:${hex('8')}`]);
  });

  it('removes a stale tag under ghcr.io/hybridcloudworks/hcw-lab* before its digest', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [image(hex('7'), [`${WORKSPACE}:latest`, `${WORKSPACE}@sha256:${hex('7')}`])],
    });
    expect(plan.remove).toEqual([`${WORKSPACE}:latest`, `${WORKSPACE}@sha256:${hex('7')}`]);
  });

  it('leaves every repository outside the lab\'s own alone', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [
        image(hex('1'), [`postgres@sha256:${hex('1')}`]),
        image(hex('2'), [`caddy@sha256:${hex('2')}`]),
        image(hex('3'), [`ghcr.io/coder/coder@sha256:${hex('3')}`]),
        image(hex('4'), ['hcw-lab-runner:dev']),
        image(hex('5'), [`ghcr.io/hybridcloudworks/other@sha256:${hex('5')}`]),
        image(hex('6'), [`alpine/ansible@sha256:${hex('6')}`]),
      ],
    });
    expect(plan.remove).toEqual([]);
  });

  it('removes only the lab reference of an image that another repository also names', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [image(hex('9'), [`${RUNNER}@sha256:${hex('9')}`, 'someone/else:kept', `someone/else@sha256:${hex('9')}`])],
    });
    expect(plan.remove).toEqual([`${RUNNER}@sha256:${hex('9')}`]);
  });

  it('keeps a stale image a container still uses, running or stopped, and reports it', async () => {
    const pins = await readPins(current());
    const plan = planImages({
      checkouts: [pins],
      images: [image(hex('9'), [`${RUNNER}@sha256:${hex('9')}`])],
      containers: [{ Id: 'c1', Names: ['/labjob-0a1b2c'], ImageID: `sha256:${hex('9')}`, State: 'exited' }],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.in_use).toEqual([
      { image: `sha256:${hex('9')}`, references: [`${RUNNER}@sha256:${hex('9')}`], containers: ['labjob-0a1b2c'] },
    ]);
  });

  it('holds the pins of every checkout, so an agent held at an older commit keeps its images', async () => {
    const playbook = await readPins(current());
    const agent = await readPins(
      fixtureCheckout({ images: { alpine, hcwLabRunner: `${RUNNER}:old@sha256:${hex('9')}` }, template: templateWith(workspaceDigest) })
    );
    const plan = planImages({
      checkouts: [playbook, agent],
      images: [image(hex('9'), [`${RUNNER}@sha256:${hex('9')}`]), image(hex('8'), [`${RUNNER}@sha256:${hex('8')}`])],
    });
    expect(plan.pull).toEqual([
      `alpine@sha256:${hex('a')}`,
      `${RUNNER}@sha256:${hex('b')}`,
      `${RUNNER}@sha256:${hex('9')}`,
    ]);
    expect(plan.remove).toEqual([`${RUNNER}@sha256:${hex('8')}`]);
  });
});
