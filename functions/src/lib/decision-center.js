/**
 * decision-center.js — every decision waiting on a person, in one read
 * (#1013, #1014): the dashboard's "Needs a decision", grown from the newest
 * Review Queue items into a hub over the whole platform.
 *
 *   POST /api/getDecisionCenter   viewer (the dashboard snapshot's role)
 *
 * The answer is `{ items, counts, sources, errors }`:
 *
 *   items    every waiting decision, newest first (decision-center/items.js
 *            holds the shape), each with the `href` that opens it at its stage
 *   counts   `{ all, frameworks, queues, pipelines, governance, other }`
 *   sources  one row per source: its category, how many items it gave,
 *            whether its window was full (`truncated`: there may be more than
 *            it shows), whether the caller's role left it out (`restricted`),
 *            and its error when it failed
 *   errors   the failed sources, for the notice the dashboard shows
 *
 * Each source is ONE bounded, ordered read (decision-center/content-sources.js
 * and decision-center/sources.js), so adding one is adding it to SOURCES. A
 * source that throws costs its own items, never the whole answer, the way
 * the Calendar's collectors fail (lib/calendar.js). The reason sent back is a
 * fixed sentence; the error itself goes to the log, not to the browser.
 *
 * Each source names the role its own list route asks for. The route admits a
 * viewer, as the dashboard does, and leaves out of a viewer's answer the
 * sources only an editor may list — transcripts, newsletters, private
 * Ambassador applications, reminders — so the dashboard is not a side door.
 */
import { satisfiesRole } from './auth/roles.js';
import { CONTENT_SOURCES } from './decision-center/content-sources.js';
import { OTHER_SOURCES } from './decision-center/sources.js';
import { byNewest, countByCategory } from './decision-center/items.js';

export { CATEGORIES } from './decision-center/items.js';

export const SOURCES = Object.freeze([...CONTENT_SOURCES, ...OTHER_SOURCES]);

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const sourceRow = (source, fields) => ({
  id: source.id,
  label: source.label,
  category: source.category,
  count: 0,
  truncated: false,
  restricted: false,
  error: null,
  ...fields,
});

/**
 * Run every source the caller's role may read. Never throws: a failing source
 * becomes an error row and its items are left out. An item two sources both
 * return is kept once, from the first source in SOURCES order.
 *
 * @returns {Promise<{ items: object[], counts: object, sources: object[], errors: object[] }>}
 */
export async function collectDecisions({ store, now, env, role, sources = SOURCES, log }) {
  const allowed = sources.filter((source) => satisfiesRole(role, source.role || 'viewer'));
  const settled = await Promise.allSettled(
    allowed.map((source) => source.collect({ store, now, env }))
  );
  const seen = new Set();
  const items = [];
  const rows = new Map();
  settled.forEach((result, index) => {
    const source = allowed[index];
    if (result.status === 'rejected') {
      log?.warn?.(`[decision-center] ${source.id} failed: ${result.reason?.name ?? 'Error'}`);
      rows.set(source.id, sourceRow(source, { error: `${source.label} could not be read just now.` }));
      return;
    }
    const fresh = (result.value?.items || []).filter((item) => !seen.has(item.id) && seen.add(item.id));
    items.push(...fresh);
    rows.set(source.id, sourceRow(source, { count: fresh.length, truncated: Boolean(result.value?.truncated) }));
  });
  items.sort(byNewest);
  const report = sources.map((source) => rows.get(source.id) || sourceRow(source, { restricted: true }));
  const errors = report
    .filter((row) => row.error)
    .map(({ id, label, category, error }) => ({ source: id, label, category, message: error }));
  return { items, counts: countByCategory(items), sources: report, errors };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {Record<string, unknown>} [deps.env] read for unresolved Key Vault references
 * @param {ReadonlyArray<object>} [deps.sources]
 */
export function createDecisionCenterHandlers({
  guard,
  store,
  now = () => new Date(),
  env = process.env,
  sources = SOURCES,
}) {
  return {
    /** POST /api/getDecisionCenter — viewer. */
    async getDecisionCenter(request, context) {
      const auth = await guard.requireRole(request, 'viewer');
      if (auth.error) return auth.error;
      try {
        const result = await collectDecisions({
          store,
          now,
          env,
          role: auth.role,
          sources,
          log: context,
        });
        return json(200, { success: true, generatedAt: now().toISOString(), ...result });
      } catch (error) {
        context.error?.(`getDecisionCenter failed: ${error?.name ?? 'Error'}`);
        return json(500, { error: 'Failed to read the decisions waiting' });
      }
    },
  };
}
