/**
 * section-edit.js — a PATCH's `sections` applied to the stored ones (ADR 0030
 * §2a, manual blocks for ADR 0033).
 *
 * Collected items may only be removed or reordered within their section: a
 * title or URL comes from the published site, and the renderer re-checks every
 * link, so an item the page sends back is matched to the STORED item by its
 * `url` and the stored one is what is written. A manual item (`manual: true`)
 * is the owner's own block and is validated here like a collected one: plain
 * text, an https link, an https image. It may land in any section, or in a
 * manual section the page creates (`manual`, `manual-<slug>`, with a title).
 *
 * Split out of admin-handlers.js for PR #841: each rule is one small function
 * that answers `{ error }` or the value, and `applySectionEdit` only threads
 * them, so a refused edit names exactly the rule it broke.
 */
import { absoluteUrl, plainText } from './sections.js';

export const MAX_SECTION_TITLE_LENGTH = 80;
const MANUAL_SECTION_ID = /^manual(-[a-z0-9]{1,20})?$/;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isPresent = (value) => value !== undefined && value !== null && value !== '';

/**
 * A manual block as submitted, validated into the stored item shape, or
 * `{ error }`. Plain text only and https only, like a collected item: the
 * renderer escapes every field, and `absoluteUrl` drops anything that is not
 * https (a site path is made absolute).
 */
export function normalizeManualItem(raw) {
  if (!isObject(raw)) return { error: 'a manual item must be an object' };
  const title = plainText(raw.title, 160);
  if (!title) return { error: 'a manual item needs a title' };
  const url = absoluteUrl(raw.url);
  if (!url) return { error: 'a manual item needs an https link' };
  const item = { manual: true, title, url };
  const summary = plainText(raw.summary);
  if (summary) item.summary = summary;
  const label = plainText(raw.label, 40);
  if (label) item.label = label;
  if (isPresent(raw.imageUrl)) {
    const imageUrl = absoluteUrl(raw.imageUrl);
    if (!imageUrl) return { error: 'a manual item image must be an https URL' };
    item.imageUrl = imageUrl;
  }
  if (raw.contentId !== undefined && raw.contentId !== null)
    item.contentId = String(raw.contentId).slice(0, 120);
  return { item };
}

/** A section the issue does not hold: only a manual one may be new, and it needs a title. */
function newManualSection(entry) {
  if (!MANUAL_SECTION_ID.test(entry.id)) {
    return { error: 'sections may only be removed or reordered; a section was added' };
  }
  const title = plainText(entry.title, MAX_SECTION_TITLE_LENGTH);
  if (!title) return { error: 'a manual section needs a title' };
  return { section: { id: entry.id, title, manual: true, items: [] } };
}

/** The section with the submitted title, when one was sent: only a manual section's can change. */
function retitled(section, title) {
  if (title === undefined || title === section.title) return { section };
  if (!section.manual) return { error: 'a section title cannot be edited' };
  const clean = plainText(title, MAX_SECTION_TITLE_LENGTH);
  if (!clean) return { error: 'a manual section needs a title' };
  return { section: { ...section, title: clean } };
}

/**
 * The stored (or new manual) section a submitted entry stands for, with its
 * title as submitted, or `{ error }`. `seen` is the ids already placed.
 */
function resolveSection(entry, stored, seen) {
  if (!isObject(entry) || typeof entry.id !== 'string') {
    return { error: 'each section must be an object with the id of a section in this issue' };
  }
  const found = stored.get(entry.id);
  const base = found ? { section: found } : newManualSection(entry);
  if (base.error) return base;
  if (seen.has(entry.id)) return { error: 'a section is listed more than once' };
  seen.add(entry.id);
  return retitled(base.section, entry.title);
}

/**
 * One submitted item against the section's stored items: a manual item is
 * validated, a collected one must match a stored URL, and `edited` says a
 * field of a collected item differs from the stored value.
 */
function resolveItem(raw, byUrl) {
  if (isObject(raw) && raw.manual === true) {
    const manual = normalizeManualItem(raw);
    return manual.error ? manual : { item: manual.item };
  }
  const match = isObject(raw) && typeof raw.url === 'string' ? byUrl.get(raw.url) : undefined;
  if (!match) {
    return {
      error:
        'items may only be removed or reordered within their section; an item was added or moved',
    };
  }
  // Any field the page sends back must be the stored value: this is a
  // subset check, not an editor for titles, summaries or labels.
  return { item: match, edited: Object.keys(raw).some((key) => raw[key] !== match[key]) };
}

/** The section's items as submitted — stored ones written back as stored, manual ones validated — or `{ error }`. */
function applyItemEdit(storedItems, submitted) {
  if (!Array.isArray(submitted)) return { error: 'each section needs an items array' };
  const byUrl = new Map((storedItems || []).map((item) => [item.url, item]));
  const seen = new Set();
  const items = [];
  for (const raw of submitted) {
    const resolved = resolveItem(raw, byUrl);
    if (resolved.error) return resolved;
    if (seen.has(resolved.item.url)) return { error: 'an item is listed more than once' };
    seen.add(resolved.item.url);
    if (resolved.edited) return { error: 'item fields cannot be edited; they come from the site' };
    items.push(resolved.item);
  }
  return { items };
}

/**
 * The stored sections, filtered and reordered as the page submitted them,
 * plus any manual blocks it added, or `{ error }`. A section left with no
 * items is a removed section, and an issue must keep at least one item.
 */
export function applySectionEdit(storedSections, submitted) {
  if (!Array.isArray(submitted)) return { error: 'sections must be an array' };
  const stored = new Map((storedSections || []).map((section) => [section.id, section]));
  const seen = new Set();
  const sections = [];
  for (const entry of submitted) {
    const resolved = resolveSection(entry, stored, seen);
    if (resolved.error) return resolved;
    const edited = applyItemEdit(resolved.section.items, entry.items);
    if (edited.error) return edited;
    if (edited.items.length) sections.push({ ...resolved.section, items: edited.items });
  }
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  if (itemCount === 0) return { error: 'at least one item must remain in the issue' };
  return { sections, itemCount };
}
