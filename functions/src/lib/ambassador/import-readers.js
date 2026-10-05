/**
 * Import readers (ADR 0033 §4): how a document in another module becomes an
 * evidence row. One reader per source module — the container to read, the
 * query the import picker lists, and `toEvidence`, the snapshot of what the
 * source said at link time.
 */
import { isHttpUrl, toCalendarDate } from './model.js';

const firstString = (doc, keys) => {
  for (const key of keys) {
    const value = doc?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const firstUrl = (doc, keys) => {
  const value = firstString(doc, keys);
  return isHttpUrl(value) ? value : null;
};

const NO_METRICS = () => ({ reach: null, attendees: null, views: null, credits: null });

/** The live-content predicate public-reads.js uses, so an import offers only what visitors can see. */
const LIVE_CONTENT_QUERY =
  'SELECT TOP 500 c.id, c.title, c.Title, c.publishedAt, c.publishedDate, c.cp_sortDate, c.publishedUrl, c.publicUrl, c.slugPageUrl, c.curatedSubpagePath, c.cloudProvider, c.type FROM c ' +
  'WHERE (c.Live = true OR c.Status = "Live" OR c.contentStatus = "published") ' +
  'AND (NOT IS_DEFINED(c.softDeletedAt) OR IS_NULL(c.softDeletedAt) OR c.softDeletedAt = "" OR c.softDeletedAt = false)';

function speakingToEvidence(doc) {
  const title =
    firstString(doc, ['eventName', 'name', 'title', 'Title']) || `Speaking event ${doc.id}`;
  const date = toCalendarDate(doc.date);
  const url = firstUrl(doc, ['eventUrl', 'website', 'presentationUrl']);
  const attendance = Number(doc.attendance);
  return {
    title,
    date,
    url,
    snapshot: { title, date, url },
    metrics: { ...NO_METRICS(), attendees: Number.isFinite(attendance) ? attendance : null },
    technology: topicList(doc.topic),
    description: typeof doc.description === 'string' ? doc.description.slice(0, 8000) : '',
  };
}

function topicList(topic) {
  if (Array.isArray(topic)) return topic;
  return topic ? [String(topic)] : [];
}

function certificationToEvidence(doc) {
  const title = firstString(doc, ['name', 'Name']) || `Certification ${doc.id}`;
  const date = toCalendarDate(doc.issueDate || doc.issue_date);
  const url = firstUrl(doc, ['verifyUrl', 'verify_url']);
  const code = firstString(doc, ['code']);
  return {
    title,
    date,
    url,
    snapshot: { title, date, url },
    metrics: NO_METRICS(),
    technology: [firstString(doc, ['vendor', 'issuer'])].filter(Boolean),
    description: code ? `Exam ${code}` : '',
  };
}

function contentToEvidence(doc) {
  const title = firstString(doc, ['title', 'Title']) || `Article ${doc.id}`;
  const date = toCalendarDate(doc.publishedAt || doc.publishedDate || doc.cp_sortDate);
  const url = firstUrl(doc, ['publishedUrl', 'publicUrl', 'slugPageUrl']) || curatedUrl(doc);
  const type = firstString(doc, ['type']);
  return {
    title,
    date,
    url,
    snapshot: { title, date, url },
    metrics: NO_METRICS(),
    technology: [firstString(doc, ['cloudProvider'])].filter(Boolean),
    description: type ? `Published ${type}` : '',
  };
}

function curatedUrl(doc) {
  if (!doc.curatedSubpagePath) return null;
  return `https://hybridcloudworks.com/${String(doc.curatedSubpagePath).replace(/^\//, '')}`;
}

// ── CSV readers: a file the owner exports, pasted or uploaded ────────────────

/**
 * The text inside a quoted segment, from the character after the opening
 * quote to the closing one (a doubled quote is one literal quote), and the
 * index after the closing quote. An unterminated quote runs to the end.
 */
function readQuoted(source, start) {
  let text = '';
  let i = start;
  while (i < source.length) {
    if (source[i] !== '"') {
      text += source[i];
      i += 1;
    } else if (source[i + 1] === '"') {
      text += '"';
      i += 2;
    } else {
      return { text, next: i + 1 };
    }
  }
  return { text, next: i };
}

const isLineBreak = (ch) => ch === '\n' || ch === '\r';

/** How many characters the line break at `i` takes: two for CRLF, one otherwise. */
const lineBreakLength = (source, i) => (source[i] === '\r' && source[i + 1] === '\n' ? 2 : 1);

/**
 * One cell from `start`: its text, the index the next cell starts at, and
 * whether a line break (or the end of the text) rather than a comma ended it.
 */
function readCell(source, start) {
  let cell = '';
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      const quoted = readQuoted(source, i + 1);
      cell += quoted.text;
      i = quoted.next;
    } else if (ch === ',') {
      return { cell, next: i + 1, endsLine: false };
    } else if (isLineBreak(ch)) {
      return { cell, next: i + lineBreakLength(source, i), endsLine: true };
    } else {
      cell += ch;
      i += 1;
    }
  }
  return { cell, next: i, endsLine: true };
}

const isFilledRow = (cells) => cells.some((value) => value.trim() !== '');

/** Rows of cells from CSV text (RFC 4180: quoted cells, doubled quotes, CRLF); blank lines dropped. */
export function parseCsv(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let i = 0;
  while (i < source.length) {
    const { cell, next, endsLine } = readCell(source, i);
    row.push(cell);
    i = next;
    if (endsLine) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows.filter(isFilledRow);
}

/** "MTM Class ID" → "mtmclassid", so a header matches however the export spells it. */
const headerKey = (header) =>
  String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** The Metrics That Matter columns the reader uses, by the header keys each may carry. */
const MTM_COLUMNS = {
  classId: ['mtmclassid', 'classid', 'id'],
  course: ['coursename', 'course', 'coursetitle', 'title'],
  method: ['learningmethod', 'deliverymethod', 'method'],
  instructor: ['instructor', 'instructorname', 'trainer'],
  start: ['startdate', 'classstartdate', 'start'],
  end: ['enddate', 'classenddate', 'end'],
  location: ['location', 'city', 'country'],
  attendees: ['attendees', 'students', 'studentcount', 'numberofstudents', 'enrolled', 'learners'],
};

/** Each column's index in the header row, by the first matching key. */
function mtmColumnIndexes(header) {
  const keys = header.map(headerKey);
  return Object.fromEntries(
    Object.entries(MTM_COLUMNS).map(([column, names]) => [
      column,
      names.map((name) => keys.indexOf(name)).find((index) => index >= 0) ?? -1,
    ])
  );
}

/** An ISO day, or a slash date (M/D/YYYY, or D/M/YYYY when the first part cannot be a month). */
export function csvDate(value) {
  const text = String(value || '').trim();
  const iso = toCalendarDate(text);
  if (iso) return iso;
  const match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (!match) return null;
  const [, a, b, year] = match;
  const [month, day] = Number(a) > 12 ? [b, a] : [a, b];
  return toCalendarDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
}

/**
 * The Metrics That Matter classes-delivered export as evidence seeds: one
 * row per class, titled by the course, dated by the start date, the method,
 * instructor, dates and location in the description, attendees when the
 * export carries a count. Rows with no course name or start date are
 * skipped. `sourceId` is the MTM class id so the import stays idempotent.
 */
export function mctClassesToEvidence(text) {
  const [header, ...lines] = parseCsv(text);
  if (!header) return { items: [], skipped: 0 };
  const at = mtmColumnIndexes(header);
  const cell = (cells, column) => (at[column] >= 0 ? String(cells[at[column]] ?? '').trim() : '');
  const items = [];
  let skipped = 0;
  for (const cells of lines) {
    const title = cell(cells, 'course').slice(0, 300);
    const date = csvDate(cell(cells, 'start'));
    if (!title || !date) {
      skipped += 1;
      continue;
    }
    const end = csvDate(cell(cells, 'end'));
    const classId = cell(cells, 'classId');
    const attendees = Number(cell(cells, 'attendees'));
    const facts = [
      cell(cells, 'method'),
      cell(cells, 'instructor') && `Instructor ${cell(cells, 'instructor')}`,
      end && end !== date ? `${date} to ${end}` : date,
      cell(cells, 'location'),
    ].filter(Boolean);
    items.push({
      sourceId: classId ? `mct-class:${classId}` : `mct-class:${title}|${date}`,
      title,
      date,
      url: null,
      snapshot: { title, date, url: null },
      metrics: {
        ...NO_METRICS(),
        attendees: Number.isFinite(attendees) && attendees > 0 ? attendees : null,
      },
      technology: [],
      description: `MCT class delivered: ${facts.join(' · ')}`.slice(0, 8000),
    });
  }
  return { items, skipped };
}

/**
 * Readers for a file the owner exports and pastes into the import dialog;
 * each names the evidence source its rows are stored under and turns the
 * text into seeds with a `sourceId` the import can stay idempotent on.
 */
export const CSV_READERS = Object.freeze({
  'mct-classes': {
    label: 'MCT classes (Metrics That Matter CSV)',
    sourceModule: 'manual',
    toEvidence: mctClassesToEvidence,
  },
});

export const IMPORT_READERS = Object.freeze({
  speaking: {
    container: 'speakerevents',
    listQuery: 'SELECT TOP 500 * FROM c',
    toEvidence: speakingToEvidence,
  },
  certifications: {
    container: 'certifications',
    listQuery: 'SELECT TOP 500 * FROM c',
    toEvidence: certificationToEvidence,
  },
  content: {
    container: 'content',
    listQuery: LIVE_CONTENT_QUERY,
    toEvidence: contentToEvidence,
  },
});
