/**
 * Pure helpers every Certifications Hub tab shares (#572, ADR 0033 Spotlight
 * slice): reading a cert document, the stats strip, the catalog filter, the
 * renewals list, the verification source, the editor's validation and the
 * public-snapshot diff. No React, no fetching, so each is tested on its own
 * in certView.test.js.
 *
 * DATES ARE CALENDAR DAYS. A certification's issue, expiry and renewal dates
 * are stored as plain `YYYY-MM-DD` (the API normalises every write) and read
 * by their leading day; nothing here parses one through `new Date(iso)`,
 * which places midnight UTC and showed a cert as expired the evening before
 * its last day everywhere west of Greenwich (ADR 0033 §1). "Expired" is
 * today's local calendar date being past the expiry day; days left are whole
 * calendar days.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';
import { daysUntil, isIsoDate, todayIso } from '@/lib/certStatus';

export const COLLECTION = 'certifications';

/** The stats strip's "Expiring 90d" and the card's Expiring badge. */
export const EXPIRING_SOON_DAYS = 90;
/** How far ahead Renewals looks; the old page's "expiring" view used the same. */
export const RENEWAL_WINDOW_DAYS = 180;

/** Resolve current API media paths while preserving absolute URLs on migrated records. */
export const normalizeUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return raw;
  return resolveMediaUrl(raw);
};

/** Build an ordered list of candidate image URLs from a cert doc. CertImage walks
 *  the list on each load error so a flaky Credly URL falls back to the Storage copy. */
export const resolveImages = (cert) => {
  const out = [];
  if (cert?.imageUrl) out.push(normalizeUrl(cert.imageUrl));
  if (Array.isArray(cert?.image)) {
    for (const a of cert.image) {
      if (a?.downloadURL) {
        const u = normalizeUrl(a.downloadURL);
        if (!out.includes(u)) out.push(u);
      }
    }
  }
  return out;
};

export const resolveImage = (cert) => resolveImages(cert)[0] || '';

/**
 * `YYYY-MM-DD` for a stored date: the leading day of a string (a plain day or
 * a timestamp), the UTC day of a Firestore-shaped value (those were written
 * as UTC midnight of the day meant). Empty for nothing usable.
 */
export const toIso = (val) => {
  if (!val) return '';
  if (typeof val === 'string') {
    const head = val.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : '';
  }
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : val.toISOString().slice(0, 10);
  if (val?.toDate) return val.toDate().toISOString().slice(0, 10);
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  return '';
};

/** What a save writes for a date input: the plain day, or null for none. */
export const fromIso = (s) => (s && isIsoDate(s) ? s : null);

export const issuerOf = (cert) => {
  const i = cert.issuer;
  if (Array.isArray(i)) return i[0] || 'Unknown';
  return i || 'Unknown';
};

export const emptyForm = Object.freeze({
  name: '',
  code: '',
  issuer: '',
  issueDate: '',
  expDate: '',
  renewalDate: '',
  renewalRequirements: '',
  verifyUrl: '',
  learnUrl: '',
  imageUrl: '',
  description: '',
  evidence: [],
  relatedLearning: [],
  display: true,
  certState: true,
  featured: false,
  display_order: 999,
});

/** Today's local calendar date for a clock value, as `YYYY-MM-DD`. */
const todayFor = (nowMs) => todayIso(new Date(nowMs));

/** Whole calendar days from today to the cert's expiry; null when it has none. */
export function daysToExpiry(cert, nowMs) {
  const exp = toIso(cert.expDate);
  return exp ? daysUntil(exp, todayFor(nowMs)) : null;
}

/** Expired / expiring-soon flags for a card. Expired means today is past the expiry day. */
export function expiryFlags(cert, nowMs) {
  const days = daysToExpiry(cert, nowMs);
  const isExpired = days !== null && days < 0;
  const isExpiringSoon = days !== null && !isExpired && days < EXPIRING_SOON_DAYS;
  return { isExpired, isExpiringSoon };
}

/** Display order is one global ladder across every issuer (ADR 0033, Spotlight slice). */
export function sortByDisplayOrder(rows) {
  return [...rows].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

export function computeStats(items, nowMs) {
  const expiringSoon = items.filter((c) => expiryFlags(c, nowMs).isExpiringSoon).length;
  const issuerCounts = items.reduce((acc, c) => {
    const k = issuerOf(c);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const [topIssuer] = Object.entries(issuerCounts).sort((a, b) => b[1] - a[1]);
  return {
    total: items.length,
    shown: items.filter((c) => c.display === true).length,
    featured: items.filter((c) => c.featured).length,
    expiringSoon,
    topIssuer,
  };
}

export function issuerList(items) {
  return Array.from(new Set(items.map(issuerOf))).sort();
}

/** The Catalog tab's search box and issuer filter. */
export function filterCatalog(items, { search, issuer }) {
  const q = (search || '').toLowerCase();
  return items.filter((c) => {
    if (q && !`${c.name} ${c.code || ''} ${issuerOf(c)}`.toLowerCase().includes(q)) return false;
    return !(issuer && issuerOf(c) !== issuer);
  });
}

export const featuredCerts = (items) => sortByDisplayOrder(items.filter((c) => c.featured));

export const hiddenCerts = (items) => items.filter((c) => c.display !== true);

/**
 * Renewals: every cert that has expired, or expires within the renewal
 * window, soonest first, with whole calendar days left (negative once
 * expired: a cert that expired yesterday is "1 day ago", never 0).
 */
export function renewalRows(items, nowMs) {
  return items
    .map((cert) => ({ cert, days: daysToExpiry(cert, nowMs) }))
    .filter(({ days }) => days !== null && days <= RENEWAL_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)
    .map(({ cert, days }) => ({
      cert,
      due: toIso(cert.expDate),
      daysLeft: days,
      expired: days < 0,
      renewalDate: toIso(cert.renewalDate) || null,
    }));
}

export function isCredlyUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'credly.com' || url.hostname === 'www.credly.com')
    );
  } catch {
    return false;
  }
}

/**
 * Which verification the weekly re-verify timer can do for a cert: `credly`
 * (the badge page is read), `link` (a verify URL the timer does not read, so
 * only the expiry date is checked) or `none`.
 */
export function verificationSource(cert) {
  if (!cert.verifyUrl) return 'none';
  return isCredlyUrl(cert.verifyUrl) ? 'credly' : 'link';
}

export function verificationCounts(items) {
  return items.reduce(
    (acc, cert) => {
      acc[verificationSource(cert)] += 1;
      return acc;
    },
    { credly: 0, link: 0, none: 0 }
  );
}

const isHttpUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || '').trim());
const isImageRef = (value) => isHttpUrl(value) || /^\/\S+$/.test(String(value || '').trim());

/**
 * The editor's validation, as `{ field: message }` — empty when the form can
 * be saved. The same rules the API enforces (functions/src/lib/admin-crud.js
 * `validateCertification`), stated here so a refusal is shown beside the
 * field rather than as a toast after the round trip.
 */
export function validateCertForm(form) {
  const errors = {};
  if (!String(form.name ?? '').trim()) errors.name = 'Name is required.';
  if (form.issueDate && !isIsoDate(form.issueDate)) errors.issueDate = 'Enter a real date.';
  if (form.expDate && !isIsoDate(form.expDate)) errors.expDate = 'Enter a real date.';
  if (form.renewalDate && !isIsoDate(form.renewalDate)) errors.renewalDate = 'Enter a real date.';
  if (!errors.expDate && form.issueDate && form.expDate && form.expDate < form.issueDate) {
    errors.expDate = 'Expiration must be on or after the issue date.';
  }
  for (const key of ['verifyUrl', 'learnUrl']) {
    if (String(form[key] || '').trim() && !isHttpUrl(form[key])) {
      errors[key] = 'Must start with http:// or https://.';
    }
  }
  if (String(form.imageUrl || '').trim() && !isImageRef(form.imageUrl)) {
    errors.imageUrl = 'Must be an http(s) URL or an uploaded image path.';
  }
  const order = form.display_order;
  if (order !== '' && order !== null && order !== undefined) {
    const n = Number(order);
    if (!Number.isInteger(n) || n < 0) errors.display_order = 'A whole number, 0 or more.';
  }
  (form.evidence || []).forEach((row, index) => {
    if (String(row.url || '').trim() && !isHttpUrl(row.url)) {
      errors[`evidence.${index}`] = 'Must start with http:// or https://.';
    }
  });
  (form.relatedLearning || []).forEach((row, index) => {
    if (String(row.url || '').trim() && !isHttpUrl(row.url)) {
      errors[`relatedLearning.${index}`] = 'Must start with http:// or https://.';
    }
  });
  return errors;
}

/**
 * The public fields the snapshot publishes (functions/src/lib/snapshots-publish.js
 * `sanitizeCertification`), each read from an admin row and a snapshot item.
 */
const PUBLIC_FIELDS = [
  ['name', (c) => c.name ?? null, (s) => s.name ?? s.Name ?? null],
  ['issuer', (c) => issuerOf(c), (s) => issuerOf(s)],
  ['code', (c) => c.code || null, (s) => s.code || null],
  ['issue date', (c) => toIso(c.issueDate), (s) => toIso(s.issueDate)],
  ['expiry date', (c) => toIso(c.expDate), (s) => toIso(s.expDate)],
  ['active', (c) => c.certState ?? null, (s) => s.certState ?? null],
  ['verify URL', (c) => c.verifyUrl || null, (s) => s.verifyUrl || null],
  ['order', (c) => c.display_order ?? null, (s) => s.displayOrder ?? null],
  ['featured', (c) => c.featured === true, (s) => s.featured === true],
];

function changedFields(row, item) {
  return PUBLIC_FIELDS.filter(([, fromRow, fromItem]) => fromRow(row) !== fromItem(item)).map(
    ([label]) => label
  );
}

/**
 * What changed since the last publish: rows now shown that the snapshot lacks
 * (added), snapshot items no longer shown or gone (removed), and rows whose
 * public fields differ (changed). Only `display: true` rows are published.
 */
export function diffSnapshot(items, snapshotItems) {
  const published = new Map((snapshotItems || []).map((s) => [s.id, s]));
  const shown = items.filter((c) => c.display === true);
  const shownIds = new Set(shown.map((c) => c._docId));
  const added = [];
  const changed = [];
  for (const row of shown) {
    const item = published.get(row._docId);
    if (!item) {
      added.push(row);
      continue;
    }
    const fields = changedFields(row, item);
    if (fields.length) changed.push({ cert: row, fields });
  }
  const removed = [...published.values()].filter((s) => !shownIds.has(s.id));
  return { added, removed, changed, total: added.length + removed.length + changed.length };
}
