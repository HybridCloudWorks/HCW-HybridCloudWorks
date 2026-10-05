/**
 * AI Engine — the model catalogue as the page reads it (ADR 0034 slice 2,
 * #857). Pure helpers over the document `GET cms/ai-model-catalog` answers;
 * the reads and writes are in config.js.
 *
 * The cards and the Routing editor keep reading `provider.models`. That list
 * used to be typed into the seed; it now comes from the catalogue, merged
 * onto the provider documents in ONE place (`withCatalogModels`, called by
 * the page before it renders a tab), so no card, select or editor has a
 * list of its own. `visibleModelsFor` is the same rule the API applies
 * (functions/src/lib/ai/model-catalog.js), and aiEngine.test.js holds the two
 * equal on the same document.
 */

/** The refresh is weekly; a list older than this is stale (the API says so too). */
export const STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

const SELECTABLE = new Set(['live', 'unknown']);
const STATUS_RANK = { live: 0, unknown: 1, retired: 2 };

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The provider's entry in the catalogue, or null. */
export function catalogEntryFor(catalog, provider) {
  const entry = catalog?.providers?.[provider];
  return isObject(entry) ? entry : null;
}

/**
 * The ids a card may offer: live or unknown, not hidden, live first then by
 * id. Mirrors the API's `visibleModelsFor`.
 */
export function visibleModelsFor(catalog, provider) {
  const models = catalogEntryFor(catalog, provider)?.models;
  if (!isObject(models)) return [];
  const rank = (status) => (status === 'live' ? 0 : 1);
  return Object.values(models)
    .filter((m) => SELECTABLE.has(m?.status) && m.hidden !== true)
    .sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

/**
 * Every model of a provider's entry for the card's disclosure list: live,
 * then unknown, then retired, each group by id. Hidden models stay in the
 * list — that is where they are shown again.
 */
export function catalogEntries(entry) {
  const models = isObject(entry?.models) ? Object.values(entry.models) : [];
  return models
    .filter((m) => isObject(m) && typeof m.id === 'string')
    .sort(
      (a, b) =>
        (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || a.id.localeCompare(b.id)
    );
}

/**
 * Provider documents with `models` taken from the catalogue. A provider the
 * catalogue does not know keeps whatever it carried, so a card still renders
 * when the catalogue could not be read.
 */
export function withCatalogModels(providers, catalog) {
  return (providers || []).map((p) =>
    catalogEntryFor(catalog, p?.id) ? { ...p, models: visibleModelsFor(catalog, p.id) } : p
  );
}

/**
 * [below this many seconds, divide by, suffix]. The same steps as the card's
 * "Tested 3d ago" line; older than a month is a date.
 */
const AGO_UNITS = [
  [3600, 60, 'm'],
  [86400, 3600, 'h'],
  [30 * 86400, 86400, 'd'],
];

export function relativeTime(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  const secs = Math.floor((now - at) / 1000);
  if (secs < 60) return 'just now';
  const unit = AGO_UNITS.find(([below]) => secs < below);
  return unit ? `${Math.floor(secs / unit[1])}${unit[2]} ago` : new Date(at).toLocaleDateString();
}

/** True when the entry's last successful list is missing or older than STALE_AFTER_MS. */
export function isStaleEntry(entry, now = Date.now()) {
  if (typeof entry?.stale === 'boolean') return entry.stale;
  const at = entry?.refresh?.lastOk ? new Date(entry.refresh.lastOk).getTime() : NaN;
  return !Number.isFinite(at) || now - at > STALE_AFTER_MS;
}

/**
 * The card's line under the model list: when the provider's list was last
 * confirmed, or that it never was. Stale is said as such; the models are
 * still offered.
 */
export function describeRefresh(entry, now = Date.now()) {
  const lastOk = entry?.refresh?.lastOk;
  if (!lastOk) return 'List not refreshed yet';
  const ago = relativeTime(lastOk, now);
  return isStaleEntry(entry, now) ? `List is stale — refreshed ${ago}` : `List refreshed ${ago}`;
}
