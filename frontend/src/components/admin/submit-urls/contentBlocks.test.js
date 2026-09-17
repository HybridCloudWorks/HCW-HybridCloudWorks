/**
 * The section-block templates (#634).
 *
 * Qlty raised four similar-code findings on this file when it was lifted out
 * of the page: twenty entries repeating the same shape, each writing its
 * heading out three times. The `block` builder derives them instead, and these
 * pin what that buys.
 */
import { describe, it, expect } from 'vitest';

import { CONTENT_TYPE_OPTIONS, SECTION_BLOCKS_BY_TYPE } from './contentBlocks';

const ALL = Object.entries(SECTION_BLOCKS_BY_TYPE).flatMap(([type, blocks]) =>
  blocks.map((block) => [type, block])
);

describe('SECTION_BLOCKS_BY_TYPE', () => {
  it('covers every content type on offer', () => {
    for (const { value } of CONTENT_TYPE_OPTIONS) {
      expect(SECTION_BLOCKS_BY_TYPE[value], `no blocks for ${value}`).toBeDefined();
      expect(SECTION_BLOCKS_BY_TYPE[value].length).toBeGreaterThan(0);
    }
  });

  it('derives every heading from its title', () => {
    // The readiness checklist matches a section by its HEADING; the button
    // that inserts it is labelled by its TITLE. If those two ever disagree the
    // checklist stops finding a section the operator can see in the draft, and
    // the draft can never be marked ready.
    for (const [type, block] of ALL) {
      expect(block.heading, `${type}/${block.key}`).toBe(`## ${block.title}`);
    }
  });

  it('starts every template with that same heading', () => {
    // insertSectionBlock appends the template and then checks for the heading
    // to decide the section is present, so the template has to carry it.
    for (const [type, block] of ALL) {
      expect(block.template.startsWith(`${block.heading}\n\n`), `${type}/${block.key}`).toBe(true);
      expect(block.template.endsWith('\n')).toBe(true);
    }
  });

  it('gives every block a unique key within its type', () => {
    for (const [type, blocks] of Object.entries(SECTION_BLOCKS_BY_TYPE)) {
      const keys = blocks.map((b) => b.key);
      expect(new Set(keys).size, `duplicate key in ${type}`).toBe(keys.length);
    }
  });

  it('marks at least one section required for every type', () => {
    // A type with none would pass the schema-sections readiness check for free.
    for (const [type, blocks] of Object.entries(SECTION_BLOCKS_BY_TYPE)) {
      expect(
        blocks.some((b) => b.required),
        `${type} has no required section`
      ).toBe(true);
    }
  });

  it('says nothing beyond the five fields the page reads', () => {
    for (const [, block] of ALL) {
      expect(Object.keys(block).sort()).toEqual(
        ['heading', 'key', 'required', 'template', 'title'].sort()
      );
    }
  });
});
