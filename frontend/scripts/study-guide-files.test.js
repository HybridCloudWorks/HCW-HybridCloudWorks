// @vitest-environment node
/**
 * The on-disk layout of the study-guide outlines (#500): one module per guide
 * plus an index, written by the weekly updater through study-guide-files.mjs.
 * Written into a temporary directory, never into src/.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GUIDE_KEY,
  readStudyGuides,
  renderGuideFile,
  renderIndexFile,
  writeStudyGuides,
} from './study-guide-files.mjs';

const outline = (code) => ({
  examCode: code.toUpperCase(),
  title: `Study guide for Exam ${code.toUpperCase()}`,
  sourceUrl: `https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/${code}`,
  areas: [
    {
      name: 'An area',
      slug: 'an-area',
      anchor: 'an-area-2530',
      weightLabel: '25–30%',
      weightLow: 25,
      weightHigh: 30,
      sections: [{ title: 'A section', objectives: ["Microsoft's words, verbatim"] }],
      objectives: [],
    },
  ],
});

let dir;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-guides-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('study-guide files', () => {
  it('writes one module per guide and an index, and reads back what it wrote', async () => {
    const outlines = { 'az-104': outline('az-104'), 'ab-100': outline('ab-100') };
    const { written, removed } = await writeStudyGuides({ dir, outlines, today: '2026-09-14' });
    expect(written.sort()).toEqual(['ab-100.js', 'az-104.js', 'index.js']);
    expect(removed).toEqual([]);

    expect(await readStudyGuides(dir)).toEqual(outlines);

    const index = await import(/* @vite-ignore */ pathToFileURL(path.join(dir, 'index.js')).href);
    expect(index.DATA_AS_OF).toBe('2026-09-14');
    expect([...index.GUIDE_KEYS]).toEqual(['ab-100', 'az-104']);
    expect(index.outlineKeyFor(outlines['az-104'].sourceUrl)).toBe('az-104');
    expect(index.outlineKeyFor(outline('zz-000').sourceUrl)).toBeNull();
  });

  it('keeps the date out of the guide modules, so an unchanged guide is an unchanged file', async () => {
    const outlines = { 'az-104': outline('az-104') };
    await writeStudyGuides({ dir, outlines, today: '2026-09-07' });
    const before = await fs.readFile(path.join(dir, 'az-104.js'), 'utf8');
    await writeStudyGuides({ dir, outlines, today: '2026-09-14' });
    const after = await fs.readFile(path.join(dir, 'az-104.js'), 'utf8');
    expect(after).toBe(before);
    expect(after).not.toContain('2026-09');
    expect(await fs.readFile(path.join(dir, 'index.js'), 'utf8')).toContain(
      "DATA_AS_OF = '2026-09-14'"
    );
  });

  it('deletes the module of a guide that is no longer in the run', async () => {
    await writeStudyGuides({
      dir,
      outlines: { 'az-104': outline('az-104'), 'az-900': outline('az-900') },
      today: '2026-09-07',
    });
    const { removed } = await writeStudyGuides({
      dir,
      outlines: { 'az-104': outline('az-104') },
      today: '2026-09-14',
    });
    expect(removed).toEqual(['az-900.js']);
    expect((await fs.readdir(dir)).sort()).toEqual(['az-104.js', 'index.js']);
  });

  it('refuses a key that is not a file-safe guide key, or that would overwrite the index', async () => {
    for (const bad of ['../x', 'AZ-104', 'index']) {
      await expect(
        writeStudyGuides({ dir, outlines: { [bad]: outline('az-104') }, today: '2026-09-14' })
      ).rejects.toThrow(/unusable keys/);
    }
    expect(GUIDE_KEY.test('az-104')).toBe(true);
  });

  it('reads nothing, rather than throwing, when the directory does not exist', async () => {
    expect(await readStudyGuides(path.join(dir, 'absent'))).toEqual({});
  });

  it('emits plain modules: a default export per guide, and no outline in the index', () => {
    expect(renderGuideFile('az-104', outline('az-104'))).toMatch(/^export default \{/m);
    const index = renderIndexFile({ keys: ['az-104'], today: '2026-09-14' });
    expect(index).toContain('export const GUIDE_KEYS');
    expect(index).not.toContain('areas');
  });
});
