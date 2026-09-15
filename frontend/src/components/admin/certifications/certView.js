/**
 * Pure helpers every Certifications Hub tab shares (#572): reading a cert
 * document, the stats strip, the catalog filter, the renewals list, the
 * verification source and the public-snapshot diff. No React, no fetching,
 * so each is tested on its own in certView.test.js.
 */
import { resolveMediaUrl } from '@/lib/functionsBase';

export const COLLECTION = 'certifications';

const DAY_MS = 24 * 60 * 60 * 1000;
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

export const toIso = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val?.toDate) return val.toDate().toISOString().slice(0, 10);
  if (val?.seconds) return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  return '';
};

export const fromIso = (s) => (s ? new Date(`${s}T00:00:00Z`).toISOString() : null);

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
  verifyUrl: '',
  learnUrl: '',
  imageUrl: '',
  description: '',
  display: true,
  certState: true,
  featured: false,
  display_order: 999,
});

/** Epoch ms of a cert's expiry, or 0 when it has none. */
export function expiryMs(cert) {
  const exp = toIso(cert.expDate);
  return exp ? new Date(exp).getTime() : 0;
}

/** Expired / expiring-soon flags for a card, as the old page computed them. */
export function expiryFlags(cert, nowMs) {
  const expMs = expiryMs(cert);
  const isExpired = expMs > 0 && expMs < nowMs;
  const isExpiringSoon = expMs > 0 && !isExpired && expMs < nowMs + EXPIRING_SOON_DAYS * DAY_MS;
  return { isExpired, isExpiringSoon };
}

export function sortByDisplayOrder(rows) {
  return [...rows].sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
}

export function computeStats(items, nowMs) {
  const expiringSoon = items.filter((c) => {
    const t = expiryMs(c);
    return t > nowMs && t < nowMs + EXPIRING_SOON_DAYS * DAY_MS;
  }).length;
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
 * window, soonest first, with whole days left (negative once expired).
 */
export function renewalRows(items, nowMs) {
  const horizon = nowMs + RENEWAL_WINDOW_DAYS * DAY_MS;
  return items
    .map((cert) => ({ cert, expMs: expiryMs(cert) }))
    .filter(({ expMs }) => expMs > 0 && expMs <= horizon)
    .sort((a, b) => a.expMs - b.expMs)
    .map(({ cert, expMs }) => ({
      cert,
      due: toIso(cert.expDate),
      daysLeft: Math.ceil((expMs - nowMs) / DAY_MS),
      expired: expMs < nowMs,
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
