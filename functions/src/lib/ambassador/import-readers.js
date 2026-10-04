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

const NO_METRICS = () => ({ reach: null, attendees: null, views: null });

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
