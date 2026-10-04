/**
 * Evidence routes (ADR 0033 §4): one thing that happened, manual or imported
 * from a source module with a snapshot of what the source said at link time.
 * Import is idempotent on (sourceModule, sourceId).
 */
import { IMPORT_READERS } from './import-readers.js';
import { CONTAINER } from './model.js';
import { evidenceRelevant, inPeriod, parsePeriod } from './readiness.js';
import { KINDS, byDateDesc, json, loadCreate, stamped } from './steps.js';
import { str, stringList } from './fields.js';

/** `?key=` filters on the evidence list: the query key, its length cap, the predicate it makes. */
const EVIDENCE_FILTERS = [
  ['sourceModule', 40, (value) => (e) => e.sourceModule === value],
  ['programId', 200, (value) => (e) => evidenceRelevant(e, value)],
  ['verificationStatus', 20, (value) => (e) => (e.verificationStatus || 'unverified') === value],
  [
    'period',
    40,
    (value) => {
      const period = parsePeriod(value);
      return period ? (e) => inPeriod(e.date, period) : null;
    },
  ],
];

/** GET cms/ambassador/evidence?sourceModule=&programId=&verificationStatus=&period= */
export async function listEvidence(ctx, request) {
  let items = await ctx.listKind('evidence');
  for (const [key, max, predicateFor] of EVIDENCE_FILTERS) {
    const value = str(request.query?.get?.(key), max);
    const keep = value ? predicateFor(value) : null;
    if (keep) items = items.filter(keep);
  }
  items.sort(byDateDesc);
  return json(200, { success: true, items, total: items.length });
}
const evidenceDefaults = () => ({
  description: '',
  sourceId: null,
  snapshot: null,
  url: null,
  files: [],
  images: [],
  metrics: { reach: null, attendees: null, views: null },
  technology: [],
  programIds: [],
  qualificationPeriod: null,
  verificationStatus: 'unverified',
  notes: '',
  tags: [],
});

/** POST cms/ambassador/evidence — manual evidence. */
export async function createEvidence(ctx, request, auth) {
  const loaded = await loadCreate(ctx, request, KINDS.evidence);
  if (loaded.error) return loaded.error;
  const doc = stamped(ctx, KINDS.evidence, { ...evidenceDefaults(), ...loaded.value }, auth);
  await ctx.store.upsertDoc(CONTAINER, doc);
  await ctx.audit('ambassador_evidence_created', auth, request, {
    evidenceId: doc.id,
    sourceModule: doc.sourceModule,
  });
  return json(200, { success: true, id: doc.id, item: doc });
}

function importedEvidence(ctx, { seed, programIds, sourceModule, sourceId, stamp }, auth) {
  return stamped(
    ctx,
    KINDS.evidence,
    {
      description: '',
      files: [],
      images: [],
      technology: [],
      qualificationPeriod: null,
      verificationStatus: 'unverified',
      notes: '',
      tags: [],
      ...seed,
      programIds,
      snapshot: { ...seed.snapshot, capturedAt: stamp },
      sourceModule,
      sourceId,
    },
    auth
  );
}

/**
 * Import every id from one source: a row already imported is reported as
 * `existing`, a source document that is gone as `missing`, the rest created.
 */
async function importFromSource(ctx, { reader, sourceModule, ids, programIds }, auth) {
  const current = (await ctx.listKind('evidence')).filter((e) => e.sourceModule === sourceModule);
  const bySource = new Map(current.map((e) => [String(e.sourceId), e]));
  const created = [];
  const existing = [];
  const missing = [];
  const stamp = ctx.nowIso();
  for (const sourceId of ids) {
    const already = bySource.get(sourceId);
    if (already) {
      existing.push(already.id);
      continue;
    }
    const source = await ctx.store.readDoc(reader.container, sourceId, sourceId);
    if (!source) {
      missing.push(sourceId);
      continue;
    }
    const seed = reader.toEvidence(source);
    const doc = importedEvidence(ctx, { seed, programIds, sourceModule, sourceId, stamp }, auth);
    await ctx.store.upsertDoc(CONTAINER, doc);
    bySource.set(sourceId, doc);
    created.push(doc);
  }
  return { created, existing, missing };
}

const unknownSource = () =>
  json(400, { error: `sourceModule must be one of ${Object.keys(IMPORT_READERS).join(', ')}` });

/**
 * POST cms/ambassador/evidence/import { sourceModule, ids[] } — one evidence
 * row per source document, with a snapshot of what the source said now.
 * Idempotent on (sourceModule, sourceId): a row already imported is
 * reported as `existing`, never duplicated.
 */
export async function importEvidence(ctx, request, auth) {
  const body = await ctx.readBody(request);
  if (!body) return json(400, { error: 'Body must be a JSON object' });
  const sourceModule = str(body.sourceModule, 40);
  const reader = IMPORT_READERS[sourceModule];
  if (!reader) return unknownSource();
  const ids = stringList(body.ids, 200);
  if (ids.length === 0) return json(400, { error: 'ids must be a non-empty array' });
  const programIds = stringList(body.programIds);
  const result = await importFromSource(ctx, { reader, sourceModule, ids, programIds }, auth);
  await ctx.audit('ambassador_evidence_imported', auth, request, {
    sourceModule,
    created: result.created.length,
    existing: result.existing.length,
    missing: result.missing.length,
  });
  return json(200, { success: true, ...result });
}

/** GET cms/ambassador/evidence/sources/{sourceModule} — what the import picker lists, with what is already imported. */
export async function listImportSources(ctx, request) {
  const sourceModule = str(request.params?.sourceModule, 40);
  const reader = IMPORT_READERS[sourceModule];
  if (!reader) return unknownSource();
  const rows = await ctx.store.queryDocs(reader.container, reader.listQuery, []);
  const imported = new Set(
    (await ctx.listKind('evidence'))
      .filter((e) => e.sourceModule === sourceModule)
      .map((e) => String(e.sourceId))
  );
  const items = rows
    .map((row) => {
      const seed = reader.toEvidence(row);
      return {
        id: row.id,
        title: seed.title,
        date: seed.date,
        url: seed.url,
        imported: imported.has(String(row.id)),
      };
    })
    .sort(byDateDesc);
  return json(200, { success: true, items, total: items.length });
}
