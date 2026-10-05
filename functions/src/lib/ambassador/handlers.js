/**
 * Ambassador HTTP handlers (ADR 0033 §4): programs, applications, evidence,
 * import and readiness over the one ambassador container.
 *
 * Every handler is guarded (steps.js): role first, then the body, then one
 * place a Cosmos failure is named. The three document kinds share one
 * create, one patch and one delete shape, parameterised by the validator
 * and the audit row; what differs per kind — a program check on an
 * application, the status machine on a patch — lives in applications.js and
 * evidence.js. Roles: editor reads and writes, publisher deletes,
 * super_admin changes program settings (roles.js).
 */
import { randomUUID } from 'node:crypto';
import { createFileDownload } from './files.js';
import { createApplication, listApplications, patchApplication } from './applications.js';
import { createEvidence, importEvidence, listEvidence, listImportSources } from './evidence.js';
import { CONTAINER } from './model.js';
import { computeReadiness, parsePeriod } from './readiness.js';
import {
  checkParentProgram,
  createContext,
  deleteHandler,
  guardedHandler,
  json,
  KINDS,
  loadCreate,
  patchHandler,
  stamped,
} from './steps.js';
import { str } from './fields.js';

export { isNotProvisioned } from './steps.js';

// ── programs ──────────────────────────────────────────────────────────────────

/** GET cms/ambassador/programs — every program (disabled included), seeded on first read. */
async function listPrograms(ctx) {
  const items = await ctx.listPrograms();
  return json(200, { success: true, items, total: items.length });
}

const programDefaults = () => ({
  enabled: true,
  eligibility: [],
  criteria: [],
  requirements: [],
  recommendedActivities: [],
  applicationWindow: { opens: null, closes: null, note: '' },
  reminders: { daysBeforeDeadline: 14, daysBeforeRenewal: 30 },
  customFields: [],
});

/** POST cms/ambassador/programs — super_admin: program settings are the catalogue. */
async function createProgram(ctx, request, auth) {
  const loaded = await loadCreate(ctx, request, KINDS.program);
  if (loaded.error) return loaded.error;
  const badParent = await checkParentProgram(ctx, loaded.value);
  if (badParent) return badParent;
  const existing = await ctx.listPrograms();
  const doc = stamped(ctx, KINDS.program, {
    ...programDefaults(),
    order: existing.length + 1,
    ...loaded.value,
  });
  await ctx.store.upsertDoc(CONTAINER, doc);
  await ctx.audit('ambassador_program_created', auth, request, {
    programId: doc.id,
    name: doc.name,
  });
  return json(200, { success: true, id: doc.id, item: doc });
}

// ── readiness ─────────────────────────────────────────────────────────────────

/** GET cms/ambassador/readiness/{programId}?period= */
async function readiness(ctx, request) {
  const programId = str(request.params?.programId, 200);
  if (!programId) return json(400, { error: 'programId required' });
  const program = await ctx.readKind('program', programId);
  if (!program) return json(404, { error: `Program ${programId} not found` });
  const period = parsePeriod(request.query?.get?.('period'));
  const evidence = await ctx.listKind('evidence');
  const parent = program.parentProgramId
    ? await ctx.readKind('program', program.parentProgramId)
    : null;
  return json(200, {
    success: true,
    readiness: computeReadiness(program, evidence, { period, today: ctx.today(), parent }),
  });
}

// ── the factory ───────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {{ readBlobForDelivery: Function }|null} [deps.storage] blob storage for the private file download
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {{ error?: Function, warn?: Function }} [deps.log]
 */
export function createAmbassadorHandlers({
  guard,
  store,
  storage = null,
  now = () => new Date(),
  uuid = randomUUID,
  log = console,
}) {
  const ctx = createContext({ store, now, uuid, log });
  const guarded = (role, name, fn) => guardedHandler({ guard, ctx }, role, name, fn);
  return {
    /** GET cms/ambassador/files/{container}/{*blobPath} — a privately stored file, as a download. */
    downloadFile: guarded('editor', 'download file', createFileDownload({ storage })),
    listPrograms: guarded('editor', 'list programs', listPrograms),
    createProgram: guarded('super_admin', 'create program', createProgram),
    /** `enabled:false` disables; nothing here deletes. */
    patchProgram: guarded(
      'super_admin',
      'update program',
      patchHandler(KINDS.program, {
        action: 'ambassador_program_updated',
        details: ({ id, updates }) => ({ programId: id, fields: Object.keys(updates) }),
        check: (ctx, { id, updates }) => checkParentProgram(ctx, updates, id),
      })
    ),
    /** Soft; disable is the usual path. */
    deleteProgram: guarded(
      'publisher',
      'delete program',
      deleteHandler(KINDS.program, {
        action: 'ambassador_program_deleted',
        details: ({ id, existing }) => ({ programId: id, name: existing.name }),
        extra: { enabled: false },
      })
    ),

    listApplications: guarded('editor', 'list applications', listApplications),
    createApplication: guarded('editor', 'create application', createApplication),
    patchApplication: guarded('editor', 'update application', patchApplication),
    deleteApplication: guarded(
      'publisher',
      'delete application',
      deleteHandler(KINDS.application, {
        action: 'ambassador_application_deleted',
        details: ({ id, existing }) => ({ applicationId: id, programId: existing.programId }),
      })
    ),

    listEvidence: guarded('editor', 'list evidence', listEvidence),
    createEvidence: guarded('editor', 'create evidence', createEvidence),
    patchEvidence: guarded(
      'editor',
      'update evidence',
      patchHandler(KINDS.evidence, {
        action: 'ambassador_evidence_updated',
        details: ({ id, updates }) => ({ evidenceId: id, fields: Object.keys(updates) }),
      })
    ),
    deleteEvidence: guarded(
      'publisher',
      'delete evidence',
      deleteHandler(KINDS.evidence, {
        action: 'ambassador_evidence_deleted',
        details: ({ id, existing }) => ({ evidenceId: id, sourceModule: existing.sourceModule }),
      })
    ),
    importEvidence: guarded('editor', 'import evidence', importEvidence),
    listImportSources: guarded('editor', 'list import sources', listImportSources),

    readiness: guarded('editor', 'compute readiness', readiness),
  };
}
