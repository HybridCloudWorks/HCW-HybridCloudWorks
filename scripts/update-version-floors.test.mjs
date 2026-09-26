/**
 * The weekly floors updater (#715): which release each rule picks, when a
 * floor moves, and what it refuses to believe. The sources are fixtures in
 * the shape endoflife.date's v1 API and the Microsoft Learn page returned on
 * 2026-09-25, cut to the fields the updater reads.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SourceError,
  proposeFloors,
  readFlexNodeLines,
  renderSummary,
  serialise,
} from './update-version-floors.mjs';
import { loadFloors } from './version-floors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-07';

const rel = (name, latest, extra = {}) => ({
  name,
  releaseDate: '2025-01-01',
  latest: latest ? { name: latest, date: '2026-09-01' } : null,
  ...extra,
});
const doc = (releases) => ({ schema_version: '1.2.0', result: { name: 'x', releases } });

/** The sources as they read on 2026-09-25, which the committed file records. */
function sourcesToday() {
  return {
    eol: {
      python: doc([rel('3.14', '3.14.7'), rel('3.13', '3.13.15')]),
      node: doc([
        rel('26', '26.10.0', { isLts: false, ltsFrom: '2026-10-28' }),
        rel('25', '25.9.0', { isLts: false, ltsFrom: null }),
        rel('24', '24.21.0', { isLts: true, ltsFrom: '2025-10-28' }),
        rel('22', '22.23.3', { isLts: true, ltsFrom: '2024-10-29' }),
      ]),
      ubuntu: doc([
        rel('26.04', '26.04.1', { codename: 'Resolute Raccoon', isLts: true }),
        rel('25.10', '25.10', { codename: 'Questing Quokka', isLts: false }),
        rel('24.04', '24.04.3', { codename: 'Noble Numbat', isLts: true }),
      ]),
      debian: doc([rel('13', '13.7', { codename: 'Trixie' }), rel('12', '12.15', { codename: 'Bookworm' })]),
      terraform: doc([rel('1.16', '1.16.4'), rel('1.15', '1.15.9')]),
    },
    flexNodeLines: [22, 24],
  };
}

const current = () => loadFloors(ROOT);

describe('proposeFloors', () => {
  it('moves nothing when the sources say what the file already records', () => {
    const { changes, notes, next } = proposeFloors(current(), sourcesToday(), TODAY);
    expect(changes).toEqual([]);
    expect(notes).toEqual([]);
    expect(next).toEqual(current());
  });

  it('moves the newest patch and the N-2 floor with it, and dates only that entry', () => {
    const sources = sourcesToday();
    sources.eol.python.result.releases[0].latest.name = '3.14.9';
    const { changes, next } = proposeFloors(current(), sources, TODAY);
    expect(changes).toEqual([
      { kind: 'python', field: 'newest', from: '3.14.7', to: '3.14.9' },
      { kind: 'python', field: 'floor', from: '3.14.5', to: '3.14.7' },
    ]);
    expect(next.kinds.python.checkedOn).toBe(TODAY);
    expect(next.kinds.node.checkedOn).toBe(current().kinds.node.checkedOn);
  });

  it('adopts a new Python line only once its N-2 patch exists', () => {
    const early = sourcesToday();
    early.eol.python.result.releases.unshift(rel('3.15', '3.15.1'));
    expect(proposeFloors(current(), early, TODAY).next.kinds.python.line).toBe('3.14');

    const ready = sourcesToday();
    ready.eol.python.result.releases.unshift(rel('3.15', '3.15.2'));
    const { next } = proposeFloors(current(), ready, TODAY);
    expect([next.kinds.python.line, next.kinds.python.newest, next.kinds.python.floor]).toEqual(['3.15', '3.15.2', '3.15.0']);
  });

  it('skips a Node.js line that never becomes LTS, and adopts the next one at its N-2 minor', () => {
    const odd = sourcesToday();
    odd.eol.node.result.releases.unshift(rel('27', '27.4.0', { isLts: false, ltsFrom: null }));
    expect(proposeFloors(current(), odd, TODAY).next.kinds.node.line).toBe('26');

    const early = sourcesToday();
    early.eol.node.result.releases.unshift(rel('28', '28.1.0', { isLts: false, ltsFrom: '2028-10-24' }));
    expect(proposeFloors(current(), early, TODAY).next.kinds.node.line).toBe('26');

    const ready = sourcesToday();
    ready.eol.node.result.releases.unshift(rel('28', '28.2.0', { isLts: false, ltsFrom: '2028-10-24' }));
    const { next } = proposeFloors(current(), ready, TODAY);
    expect([next.kinds.node.line, next.kinds.node.floor]).toEqual(['28', '28.0.0']);
  });

  it('moves the functions ceiling when Flex Consumption lists a newer GA line, and says what that costs', () => {
    const sources = sourcesToday();
    sources.flexNodeLines = [22, 24, 26];
    const { next, notes } = proposeFloors(current(), sources, TODAY);
    const ceiling = next.kinds.node.platformCeilings.functions;
    expect([ceiling.line, ceiling.newest, ceiling.floor]).toEqual(['26', '26.10.0', '26.8.0']);
    expect(notes.join(' ')).toMatch(/runtime_version in infra\/functionapp\.tf/);
  });

  it('keeps the ceiling within the newest line the rule allows', () => {
    const sources = sourcesToday();
    sources.flexNodeLines = [24, 28];
    const ceiling = proposeFloors(current(), sources, TODAY).next.kinds.node.platformCeilings.functions;
    expect(ceiling.line).toBe('26');
  });

  it('leaves the ceiling alone, and says so, when the Learn table cannot be read', () => {
    const sources = sourcesToday();
    sources.flexNodeLines = null;
    const { next, notes } = proposeFloors(current(), sources, TODAY);
    expect(next.kinds.node.platformCeilings.functions.line).toBe('24');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/could not be read/);
  });

  it('moves the Ubuntu target to a new LTS and learns its codename, but never to an interim release', () => {
    const interim = sourcesToday();
    interim.eol.ubuntu.result.releases.unshift(rel('26.10', '26.10', { codename: 'Some Thing', isLts: false }));
    expect(proposeFloors(current(), interim, TODAY).changes).toEqual([]);

    const lts = sourcesToday();
    lts.eol.ubuntu.result.releases.unshift(rel('28.04', '28.04', { codename: 'Future Fox', isLts: true }));
    const { next } = proposeFloors(current(), lts, TODAY);
    expect(next.kinds.ubuntu.newest).toBe('28.04');
    expect(next.kinds.ubuntu.codenames.future).toBe('28.04');
  });

  it('does not count a release dated in the future', () => {
    const sources = sourcesToday();
    sources.eol.debian.result.releases.unshift(rel('14', null, { codename: 'Forky', releaseDate: '2027-06-01' }));
    expect(proposeFloors(current(), sources, TODAY).next.kinds.debian.newest).toBe('13');
  });

  it('refuses a source whose newest line is older than the recorded one', () => {
    const sources = sourcesToday();
    sources.eol.python.result.releases.shift();
    expect(() => proposeFloors(current(), sources, TODAY)).toThrow(SourceError);
    expect(() => proposeFloors(current(), sources, TODAY)).toThrow(/older than the recorded 3\.14/);
  });

  it('refuses a newest release older than the recorded one on the same line', () => {
    const sources = sourcesToday();
    sources.eol.terraform.result.releases[0].latest.name = '1.16.3';
    expect(() => proposeFloors(current(), sources, TODAY)).toThrow(/1\.16\.3 is older than the recorded 1\.16\.4/);
  });

  it('refuses a document without the v1 releases array', () => {
    const sources = sourcesToday();
    sources.eol.debian = { result: {} };
    expect(() => proposeFloors(current(), sources, TODAY)).toThrow(/no result\.releases array/);
  });
});

describe('readFlexNodeLines', () => {
  const page = (row) =>
    [
      '<h2 id="supported-language-stack-versions">Supported language stack versions</h2>',
      '<table><thead><tr><th>Language stack</th><th>Required version</th></tr></thead><tbody>',
      '<tr>\n<td>Java</td>\n<td style="text-align: center;">Java 21, Java 25</td>\n</tr>',
      row,
      '</tbody></table>',
      '<table><tr><td>Node.js</td><td>Node.js 99</td></tr></table>',
    ].join('\n');

  it('reads the lines from the Node.js row of that table and no other', () => {
    expect(readFlexNodeLines(page('<tr>\n<td>Node.js</td>\n<td style="text-align: center;">Node.js 22, Node.js 24</td>\n</tr>'))).toEqual([22, 24]);
  });

  it('skips a line marked preview', () => {
    expect(readFlexNodeLines(page('<tr><td>Node.js</td><td>Node.js 24, Node.js 26 (preview)</td></tr>'))).toEqual([24]);
  });

  it('returns null rather than guessing when the section or the row is missing', () => {
    expect(readFlexNodeLines('<html></html>')).toBe(null);
    expect(readFlexNodeLines(page(''))).toBe(null);
  });
});

describe('the file and the summary', () => {
  it('serialises the floors exactly as the committed file is written', () => {
    const text = readFileSync(join(ROOT, 'scripts', 'version-floors.json'), 'utf8');
    expect(serialise(JSON.parse(text))).toBe(text);
  });

  it('lists each moved value and each pin the new floors leave behind', () => {
    const summary = renderSummary({
      today: TODAY,
      changes: [{ kind: 'node', field: 'floor', from: '26.8.0', to: '26.9.0' }],
      notes: ['a note'],
      behind: [{ file: 'frontend/package.json', line: 7, where: 'frontend/package.json > engines.node', message: 'below the floor' }],
    });
    expect(summary).toContain('| node | floor | 26.8.0 | 26.9.0 |');
    expect(summary).toContain('- a note');
    expect(summary).toContain('- `frontend/package.json:7` (frontend/package.json > engines.node): below the floor');
  });

  it('says so plainly when nothing moved', () => {
    const summary = renderSummary({ today: TODAY, changes: [], notes: [], behind: [] });
    expect(summary).toContain('No floor moved.');
    expect(summary).toContain('None.');
  });
});
