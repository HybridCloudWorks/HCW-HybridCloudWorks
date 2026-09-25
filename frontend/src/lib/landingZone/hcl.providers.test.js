/**
 * The Terraform the Landing Zone Builder emits (#667), checked file by file
 * and module block by module block, one flat test each. The shape checks are
 * what `terraform fmt -check` would enforce, written out so CI without
 * terraform still fails on a tab or a trailing space; the provider checks are
 * what `terraform init` would refuse: a module block whose `providers` map
 * leaves out a provider its module requires, since a block with that
 * argument inherits nothing for the providers it omits.
 *
 * Every emitted file of nine builds is collected once into a flat list, and
 * every `module` block into another, so each `it.each` row is one file or one
 * block and a failure names it. hcl.test.js holds the content assertions.
 */
import { describe, expect, it } from 'vitest';
import {
  AVM_MODULES,
  AVM_SOURCES,
  DEFAULT_STATE,
  PROVIDER_NAMES,
  SUBSCRIPTION_SCOPED_PROVIDERS,
  emitFiles,
  normalizeState,
} from './index';

const ARCHIVED = 'avm-ptn-hubnetworking';
const UNPUBLISHED = 'avm-ptn-alz-application-landing-zone-identity-and-access';

const BUILDS = [
  ['default', DEFAULT_STATE],
  ['empty', normalizeState({ selected: [] })],
  ['tree only', normalizeState({ selected: ['management-groups'] })],
  ['policy without a hub', normalizeState({ selected: ['policy'] })],
  [
    'hub, no firewall, no dns',
    normalizeState({ selected: ['connectivity-hub'], options: { privateDnsZones: false } }),
  ],
  ['firewall basic', normalizeState({ selected: ['firewall'], options: { firewallSku: 'Basic' } })],
  ['identity only', normalizeState({ selected: ['identity'] })],
  [
    'five and five',
    normalizeState({ options: { corpCount: 5, onlineCount: 5, firewallSku: 'Premium' } }),
  ],
  ['nested under contoso', normalizeState({ options: { rootParentId: 'contoso' } })],
];

/** Every emitted file of every build, flat: `{ build, path, content }`. */
const EMITTED = BUILDS.flatMap(([build, state]) =>
  emitFiles(state).map((f) => ({ build, path: f.path, content: f.content }))
);

const MODULE_BY_SOURCE = Object.fromEntries(Object.values(AVM_MODULES).map((m) => [m.source, m]));

/** The `key = value` entries of a `providers = { … }` map, or null when the block has none. */
function providerEntries(block) {
  const map = /^\s*providers = \{\n([\s\S]*?)\n\s*\}/m.exec(block);
  if (!map) return null;
  return map[1]
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s*=\s*/));
}

/**
 * Every `module "…" { … }` block in a set of emitted files, flat:
 * `{ build, path, label, source, providers }` with `providers` the map's
 * entries as `[key, value]` pairs (null when the block has no map).
 */
export function collectModuleBlocks(files) {
  return files.flatMap(({ build, path, content }) =>
    content
      .split(/^module "/m)
      .slice(1)
      .map((block) => ({
        build,
        path,
        label: block.slice(0, block.indexOf('"')),
        source: /^\s*source\s*=\s*"([^"]+)"/m.exec(block)?.[1] ?? null,
        providers: providerEntries(block),
      }))
  );
}

const BLOCKS = collectModuleBlocks(EMITTED);

const rowName = ({ build, path }) => `${build}: ${path}`;

describe('every emitted file', () => {
  it('has at least one file per build, with unique paths', () => {
    const perBuild = BUILDS.map(([build]) => EMITTED.filter((f) => f.build === build));
    expect(perBuild.map((files) => files.length > 0)).toEqual(BUILDS.map(() => true));
    expect(perBuild.map((files) => new Set(files.map((f) => f.path)).size)).toEqual(
      perBuild.map((files) => files.length)
    );
  });

  it.each(EMITTED.map((f) => [rowName(f), f]))(
    '%s is fmt-shaped: no tabs, no trailing spaces, LF, one newline at EOF',
    (_name, { path, content }) => {
      expect(content).not.toMatch(/\t/);
      expect(content).not.toMatch(/[ ]+$/m);
      expect(content).not.toMatch(/\r/);
      expect(content).not.toMatch(/\n\n\n/);
      expect(content.endsWith('\n')).toBe(true);
      expect(content.endsWith('\n\n')).toBe(false);
      if (path.endsWith('.tf')) {
        const oddIndents = content.split('\n').filter((line) => /^ */.exec(line)[0].length % 2);
        expect(oddIndents).toEqual([]);
      }
    }
  );

  it.each(EMITTED.filter((f) => f.path !== 'terraform.tf').map((f) => [rowName(f), f]))(
    '%s pins every module source with a version and never names the archived or template module',
    (_name, { content }) => {
      const sources = [...content.matchAll(/^\s*source\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
      expect(sources.filter((s) => !AVM_SOURCES.includes(s))).toEqual([]);
      const afterSource = [...content.matchAll(/^\s*source\s*=\s*"Azure\/avm-[^"]*"\n([^\n]*)/gm)];
      expect(afterSource.map((m) => m[1])).toEqual(
        afterSource.map((m) => m[1]).filter((line) => /^\s*version = "\d+\.\d+\.\d+"$/.test(line))
      );
      expect(content).not.toContain(ARCHIVED);
      expect(content).not.toContain('hubnetworking');
      expect(content).not.toContain(UNPUBLISHED);
    }
  );

  it('uses all four modules in the default build, each at its pinned version', () => {
    const full = emitFiles(DEFAULT_STATE);
    const text = full
      .filter((f) => f.path !== 'terraform.tf')
      .map((f) => f.content)
      .join('\n');
    const sources = [...text.matchAll(/^\s*source\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(new Set(sources)).toEqual(new Set(AVM_SOURCES));
    const missing = Object.values(AVM_MODULES).filter(
      (m) => !text.includes(`version = "${m.version}"`)
    );
    expect(missing).toEqual([]);
  });
});

describe('every module block', () => {
  it('appears in the builds that select it', () => {
    const labels = BLOCKS.map((b) => b.label);
    for (const label of ['alz', 'management', 'connectivity', 'spoke_identity', 'spoke_corp_5']) {
      expect(labels, label).toContain(label);
    }
    expect(BLOCKS.filter((b) => b.source === null)).toEqual([]);
  });

  it.each(BLOCKS.map((b) => [`${rowName(b)} module "${b.label}"`, b]))(
    '%s maps every provider its module requires at the pinned tag, and only those',
    (_name, { label, source, providers }) => {
      expect(providers).not.toBeNull();
      const keys = providers.map(([k]) => k).sort();
      expect(keys).toEqual([...MODULE_BY_SOURCE[source].requiredProviders].sort());
      const aliased = providers.filter(
        ([k]) => SUBSCRIPTION_SCOPED_PROVIDERS.includes(k) && label !== 'alz'
      );
      const defaults = providers.filter(([k]) => !aliased.some(([a]) => a === k));
      expect(aliased.filter(([k, v]) => !new RegExp(`^${k}\\.[a-z_0-9]+$`).test(v))).toEqual([]);
      expect(defaults.filter(([k, v]) => v !== k)).toEqual([]);
    }
  );

  it('requires only providers the root pins', () => {
    const required = Object.values(AVM_MODULES).flatMap((m) =>
      m.requiredProviders.map((p) => `${m.name}: ${p}`)
    );
    const unpinned = required.filter((entry) => !PROVIDER_NAMES.includes(entry.split(': ')[1]));
    expect(unpinned).toEqual([]);
    expect(PROVIDER_NAMES).toEqual(['alz', 'azapi', 'azurerm', 'modtm', 'random', 'time']);
  });
});
