/**
 * Ambassador (ADR 0033 §4): programs seed once, the application status
 * machine refuses a move it does not list and records the ones it allows,
 * evidence import is idempotent on (sourceModule, sourceId), readiness
 * explains its arithmetic and never promises acceptance, an absent container
 * is a 503 NOT_PROVISIONED and not a 500, and the role per verb holds.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  DEFAULT_PROGRAMS,
  canTransition,
  computeReadiness,
  createAmbassadorHandlers,
  isNotProvisioned,
  parsePeriod,
  toCalendarDate,
  validateApplication,
  validateEvidence,
  validateProgram,
} from './ambassador.js';

const context = { log: vi.fn(), error: vi.fn() };
const NOW = new Date('2026-10-03T12:00:00.000Z');
let counter = 0;
const fixed = { now: () => NOW, uuid: () => `id-${++counter}`, log: { error: vi.fn() } };

/** A guard that answers the given role for every call. */
const guardAs = (role) => ({
  requireRole: vi.fn(async (_request, required) => {
    const level = { viewer: 1, editor: 2, publisher: 3, super_admin: 4 };
    if (level[role] >= level[required]) {
      return { user: { oid: 'u1', email: 'owner@example.test' }, role, error: null };
    }
    return { user: null, role: null, error: { status: 403, body: '{}' } };
  }),
});

const makeRequest = ({ query = {}, params = {}, body } = {}) => ({
  query: { get: (k) => query[k] ?? null },
  params,
  headers: { get: () => 'vitest' },
  json: async () => {
    if (body === undefined) throw new SyntaxError('no body');
    return body;
  },
});

/** An in-memory `ambassador` container plus whatever other containers a test seeds. */
function memStore(seed = {}) {
  const data = new Map(
    Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map((r) => [r.id, r]))])
  );
  const table = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  return {
    data,
    queryDocs: vi.fn(async (name, query, params) => {
      const rows = [...table(name).values()];
      const docType = params?.find((p) => p.name === '@docType')?.value;
      return docType ? rows.filter((r) => r.docType === docType && !r.softDeletedAt) : rows;
    }),
    readDoc: vi.fn(async (name, id) => table(name).get(id) || null),
    upsertDoc: vi.fn(async (name, doc) => {
      table(name).set(doc.id, doc);
      return doc;
    }),
    patchDoc: vi.fn(async (name, id, updates) => {
      const next = { ...table(name).get(id), ...updates };
      table(name).set(id, next);
      return next;
    }),
  };
}

const parse = (res) => JSON.parse(res.body);

describe('calendar dates and periods', () => {
  it('keeps a plain day, takes the day of a timestamp, and refuses an impossible one', () => {
    expect(toCalendarDate('2026-02-28')).toBe('2026-02-28');
    expect(toCalendarDate('2026-02-28T23:30:00.000Z')).toBe('2026-02-28');
    expect(toCalendarDate('2026-02-30')).toBeNull();
    expect(toCalendarDate('')).toBeNull();
  });

  it('reads a year or a range as a period', () => {
    expect(parsePeriod('2026')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(parsePeriod('2026-07-01..2027-06-30')).toEqual({
      start: '2026-07-01',
      end: '2027-06-30',
    });
    expect(parsePeriod('')).toBeNull();
  });
});

describe('validation', () => {
  it('rejects unknown fields on every kind, so a stray key never reaches the store', () => {
    expect(validateProgram({ name: 'X', bogus: 1 }).error).toMatch(/Unknown program field/);
    expect(validateApplication({ programId: 'p', bogus: 1 }).error).toMatch(
      /Unknown application field/
    );
    expect(validateEvidence({ title: 'T', date: '2026-01-01', bogus: 1 }).error).toMatch(
      /Unknown evidence field/
    );
  });

  it('checks dates and URLs and cleans lists', () => {
    expect(validateApplication({ programId: 'p', submissionDeadline: 'soon' }).error).toMatch(
      /submissionDeadline/
    );
    expect(
      validateEvidence({ title: 'T', date: '2026-01-01', url: 'javascript:alert(1)' }).error
    ).toMatch(/http/);
    const ok = validateEvidence({
      title: ' Talk ',
      date: '2026-05-01T09:00:00Z',
      technology: ['Azure', '', 7],
      metrics: { attendees: '120', reach: '' },
    });
    expect(ok.value).toMatchObject({
      title: 'Talk',
      date: '2026-05-01',
      sourceModule: 'manual',
      technology: ['Azure'],
      metrics: { attendees: 120, reach: null, views: null },
    });
    expect(
      validateProgram({
        name: 'P',
        requirements: [
          { label: 'Talks', evidenceTypes: ['speaking', 'nope'], minCount: '3', weight: 2 },
        ],
      }).value.requirements
    ).toEqual([
      {
        id: 'req-1',
        label: 'Talks',
        description: '',
        evidenceTypes: ['speaking'],
        minCount: 3,
        weight: 2,
      },
    ]);
  });
});

describe('status machine', () => {
  it('lists every status and allows only the moves in the table', () => {
    expect(APPLICATION_STATUSES).toHaveLength(12);
    for (const status of APPLICATION_STATUSES)
      expect(APPLICATION_TRANSITIONS[status]).toBeDefined();
    expect(canTransition('interested', 'preparing')).toBe(true);
    expect(canTransition('interested', 'accepted')).toBe(false);
    expect(canTransition('submitted', 'under_review')).toBe(true);
    expect(canTransition('renewal_due', 'renewed')).toBe(true);
    expect(canTransition('denied', 'preparing')).toBe(true);
    expect(canTransition('nope', 'preparing')).toBe(false);
  });
});

describe('readiness', () => {
  const program = {
    id: 'p1',
    requirements: [
      { id: 'talks', label: 'Talks', evidenceTypes: ['speaking'], minCount: 2, weight: 3 },
      { id: 'posts', label: 'Posts', evidenceTypes: ['content'], minCount: 1, weight: 1 },
    ],
  };
  const evidence = [
    { id: 'e1', title: 'A', date: '2026-03-01', sourceModule: 'speaking', programIds: [] },
    { id: 'e2', title: 'B', date: '2026-04-01', sourceModule: 'speaking', programIds: ['p1'] },
    { id: 'e3', title: 'C', date: '2025-01-01', sourceModule: 'speaking', programIds: ['other'] },
    { id: 'e4', title: 'D', date: '2026-02-01', sourceModule: 'content', softDeletedAt: 'x' },
  ];

  it('counts relevant evidence per requirement, weights the score and explains it', () => {
    const r = computeReadiness(program, evidence, { today: '2026-10-03' });
    expect(r.requirements.map((row) => [row.id, row.count, row.met])).toEqual([
      ['talks', 2, true],
      ['posts', 0, false],
    ]);
    expect(r.score).toBe(75);
    expect(r.missing).toEqual([{ id: 'posts', label: 'Posts', shortfall: 1 }]);
    expect(r.explanation).toContain('(3) over the total weight (4)');
    expect(r.explanation).toMatch(/does not promise/);
  });

  it('bounds the count by the period and drops the rolling-window warning when one is given', () => {
    const r = computeReadiness(program, evidence, {
      period: { start: '2026-04-01', end: '2026-12-31' },
      today: '2026-10-03',
    });
    expect(r.requirements[0].count).toBe(1);
    expect(r.expiring).toEqual([]);
  });
});

describe('not provisioned', () => {
  it('turns a Cosmos 404 on the container into 503 NOT_PROVISIONED with the owner message', async () => {
    const error = Object.assign(new Error('Resource Not Found'), { code: 404 });
    expect(isNotProvisioned(error)).toBe(true);
    expect(isNotProvisioned(new Error('boom'))).toBe(false);
    const store = memStore();
    store.queryDocs.mockRejectedValue(error);
    const h = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    const res = await h.listPrograms(makeRequest(), context);
    expect(res.status).toBe(503);
    expect(parse(res)).toEqual({
      code: 'NOT_PROVISIONED',
      message: 'Run terraform apply for the ambassador container',
    });
  });

  it('keeps any other failure a 500', async () => {
    const store = memStore();
    store.queryDocs.mockRejectedValue(new Error('throttled'));
    const h = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    expect((await h.listPrograms(makeRequest(), context)).status).toBe(500);
  });
});

describe('programs', () => {
  it('seeds the seven defaults on the first read of an empty container, each editable and enabled', async () => {
    const store = memStore();
    const h = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    const body = parse(await h.listPrograms(makeRequest(), context));
    expect(body.items.map((p) => p.name)).toEqual([
      'Microsoft MVP',
      'Microsoft Certified Trainer',
      'AWS Community Hero',
      'AWS Ambassador',
      'GitHub Star',
      'Docker Captain',
      'VMware vExpert',
    ]);
    expect(
      body.items.every((p) => p.enabled && p.docType === 'program' && p.requirements.length > 0)
    ).toBe(true);
    expect(store.upsertDoc).toHaveBeenCalledTimes(DEFAULT_PROGRAMS.length);
    // Every seeded requirement says it is a starting point.
    for (const program of DEFAULT_PROGRAMS) {
      for (const req of program.requirements) expect(req.description).toMatch(/Edit to match/);
    }
    // A second read seeds nothing.
    await h.listPrograms(makeRequest(), context);
    expect(store.upsertDoc).toHaveBeenCalledTimes(DEFAULT_PROGRAMS.length);
  });

  it('needs super_admin to change the catalogue, and disabling never deletes', async () => {
    const store = memStore();
    const editor = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    await editor.listPrograms(makeRequest(), context);
    expect(
      (
        await editor.patchProgram(
          makeRequest({ params: { id: 'program-github-star' }, body: { enabled: false } }),
          context
        )
      ).status
    ).toBe(403);

    const admin = createAmbassadorHandlers({ guard: guardAs('super_admin'), store, ...fixed });
    const res = await admin.patchProgram(
      makeRequest({ params: { id: 'program-github-star' }, body: { enabled: false, order: 9 } }),
      context
    );
    expect(parse(res).item).toMatchObject({ enabled: false, order: 9 });
    expect(store.data.get('ambassador').get('program-github-star').softDeletedAt).toBeUndefined();
    const audit = store.upsertDoc.mock.calls.find(
      ([c, d]) => c === 'admin_audit_logs' && d.action === 'ambassador_program_updated'
    );
    expect(audit[1]).toMatchObject({
      userEmail: 'owner@example.test',
      details: { programId: 'program-github-star' },
    });
  });
});

describe('applications', () => {
  async function seeded(role = 'editor') {
    const store = memStore();
    const h = createAmbassadorHandlers({ guard: guardAs(role), store, ...fixed });
    await h.listPrograms(makeRequest(), context);
    return { store, h };
  }

  it('creates as interested with an opening history row, private by default', async () => {
    const { h } = await seeded();
    const res = await h.createApplication(
      makeRequest({ body: { programId: 'program-microsoft-mvp' } }),
      context
    );
    expect(res.status).toBe(200);
    expect(parse(res).item).toMatchObject({
      status: 'interested',
      private: true,
      programId: 'program-microsoft-mvp',
      history: [{ from: null, to: 'interested', by: 'owner@example.test' }],
    });
    expect(parse(res).item).not.toHaveProperty('statusNote');
    expect(
      (await h.createApplication(makeRequest({ body: { programId: 'nope' } }), context)).status
    ).toBe(400);
  });

  it('refuses a transition the table does not list and records one it does, with its note', async () => {
    const { h, store } = await seeded();
    const id = parse(
      await h.createApplication(
        makeRequest({ body: { programId: 'program-aws-ambassador' } }),
        context
      )
    ).id;

    const refused = await h.patchApplication(
      makeRequest({ params: { id }, body: { status: 'accepted' } }),
      context
    );
    expect(refused.status).toBe(400);
    expect(parse(refused).allowed).toEqual(['preparing', 'withdrawn']);

    await h.patchApplication(
      makeRequest({
        params: { id },
        body: { status: 'preparing', statusNote: 'Collecting talks' },
      }),
      context
    );
    await h.patchApplication(makeRequest({ params: { id }, body: { status: 'ready' } }), context);
    const submitted = parse(
      await h.patchApplication(
        makeRequest({ params: { id }, body: { status: 'submitted' } }),
        context
      )
    ).item;
    expect(submitted.history.map((row) => row.to)).toEqual([
      'interested',
      'preparing',
      'ready',
      'submitted',
    ]);
    expect(submitted.history[1].note).toBe('Collecting talks');
    expect(submitted.applicationDate).toBe('2026-10-03');
    expect(store.data.get('ambassador').get(id).statusNote).toBeUndefined();
  });

  it('lets a super_admin set any status from Settings, recorded as an override; an editor is refused', async () => {
    const { h: editor } = await seeded('editor');
    const id = parse(
      await editor.createApplication(
        makeRequest({ body: { programId: 'program-microsoft-mct' } }),
        context
      )
    ).id;
    const refused = await editor.patchApplication(
      makeRequest({ params: { id }, body: { status: 'active', statusOverride: true } }),
      context
    );
    expect(refused.status).toBe(403);

    const { h: admin, store } = await seeded('super_admin');
    const adminId = parse(
      await admin.createApplication(
        makeRequest({ body: { programId: 'program-microsoft-mct' } }),
        context
      )
    ).id;
    const set = parse(
      await admin.patchApplication(
        makeRequest({
          params: { id: adminId },
          body: { status: 'active', statusOverride: true, statusNote: 'Set from Settings' },
        }),
        context
      )
    ).item;
    expect(set.status).toBe('active');
    expect(set.history.at(-1)).toMatchObject({
      from: 'interested',
      to: 'active',
      note: 'Set from Settings',
      override: true,
    });
    expect(store.data.get('ambassador').get(adminId).statusOverride).toBeUndefined();
    // A plain move still obeys the table.
    const plain = await admin.patchApplication(
      makeRequest({ params: { id: adminId }, body: { status: 'interested' } }),
      context
    );
    expect(plain.status).toBe(400);
  });

  it('refuses statusOverride on a create, and answers 409 when the record changed under a patch', async () => {
    const { h, store } = await seeded('super_admin');
    const refused = await h.createApplication(
      makeRequest({ body: { programId: 'program-microsoft-mct', statusOverride: true } }),
      context
    );
    expect(refused.status).toBe(400);

    const id = parse(
      await h.createApplication(
        makeRequest({ body: { programId: 'program-microsoft-mct' } }),
        context
      )
    ).id;
    store.data.get('ambassador').get(id)._etag = 'etag-1';
    store.patchDoc.mockImplementationOnce(async () => {
      throw Object.assign(new Error('precondition failed'), { code: 412 });
    });
    const conflict = await h.patchApplication(
      makeRequest({ params: { id }, body: { status: 'preparing' } }),
      context
    );
    expect(conflict.status).toBe(409);
    expect(parse(conflict).code).toBe('CONFLICT');
    // The write carried the ETag it read.
    const [, , , options] = store.patchDoc.mock.calls.at(-1);
    expect(options).toEqual({ ifMatch: 'etag-1' });
  });

  it('keeps a privately stored file by its { container, path } reference, and serves it as a download', async () => {
    const { h } = await seeded('editor');
    const created = parse(
      await h.createApplication(
        makeRequest({
          body: {
            programId: 'program-microsoft-mct',
            files: [
              { name: 'agreement.pdf', path: 'ambassador/app-1/1-agreement.pdf', container: 'speakerevents', bytes: 10 },
              { name: 'no-reference-at-all' },
              { name: 'linked', url: 'https://example.com/x.pdf' },
            ],
          },
        }),
        context
      )
    ).item;
    expect(created.files).toEqual([
      {
        name: 'agreement.pdf',
        url: null,
        container: 'speakerevents',
        path: 'ambassador/app-1/1-agreement.pdf',
        bytes: 10,
        uploadedAt: null,
      },
      { name: 'linked', url: 'https://example.com/x.pdf', container: null, path: null, bytes: null, uploadedAt: null },
    ]);

    const storage = {
      readBlobForDelivery: vi.fn(async (_c, path) =>
        path === 'ambassador/app-1/1-agreement.pdf'
          ? { body: Buffer.from('%PDF'), contentType: 'application/pdf', etag: '"e1"' }
          : null
      ),
    };
    const withStorage = createAmbassadorHandlers({ guard: guardAs('editor'), store: memStore(), storage, ...fixed });
    const ok = await withStorage.downloadFile(
      makeRequest({ params: { container: 'speakerevents', blobPath: 'ambassador/app-1/1-agreement.pdf' } }),
      context
    );
    expect(ok.status).toBe(200);
    expect(ok.headers['Content-Type']).toBe('application/pdf');
    expect(ok.headers['Content-Disposition']).toBe('attachment; filename="1-agreement.pdf"');
    expect(ok.headers['Cache-Control']).toBe('private, no-store');
    expect(ok.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(ok.body.toString()).toBe('%PDF');

    for (const params of [
      { container: 'certifications', blobPath: 'ambassador/app-1/1-agreement.pdf' },
      { container: 'speakerevents', blobPath: 'events/2026/hero.png' },
      { container: 'speakerevents', blobPath: 'ambassador/../secret.pdf' },
      { container: 'speakerevents', blobPath: 'ambassador/app-1/missing.pdf' },
    ]) {
      expect((await withStorage.downloadFile(makeRequest({ params }), context)).status).toBe(404);
    }
    expect(storage.readBlobForDelivery).toHaveBeenCalledTimes(2);
    expect((await h.downloadFile(makeRequest({ params: { container: 'speakerevents', blobPath: 'ambassador/a/b.pdf' } }), context)).status).toBe(503);
  });

  it('deletes softly and only as publisher', async () => {
    const { h, store } = await seeded();
    const id = parse(
      await h.createApplication(
        makeRequest({ body: { programId: 'program-docker-captain' } }),
        context
      )
    ).id;
    expect((await h.deleteApplication(makeRequest({ params: { id } }), context)).status).toBe(403);
    const publisher = createAmbassadorHandlers({ guard: guardAs('publisher'), store, ...fixed });
    expect(
      (await publisher.deleteApplication(makeRequest({ params: { id } }), context)).status
    ).toBe(200);
    expect(store.data.get('ambassador').get(id).softDeletedAt).toBe(NOW.toISOString());
    expect(parse(await h.listApplications(makeRequest(), context)).items).toEqual([]);
  });
});

describe('evidence', () => {
  it('imports from speaking with a snapshot, once per source id, and reports what is missing', async () => {
    const store = memStore({
      speakerevents: [
        {
          id: 'event-1',
          eventName: 'KCDC',
          date: '2026-08-14T00:00:00.000Z',
          eventUrl: 'https://kcdc.info',
          attendance: 80,
        },
        { id: 'event-2', name: 'Meetup', date: '2026-09-01' },
      ],
    });
    const h = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    const first = parse(
      await h.importEvidence(
        makeRequest({ body: { sourceModule: 'speaking', ids: ['event-1', 'event-2', 'event-9'] } }),
        context
      )
    );
    expect(first.created.map((e) => e.title)).toEqual(['KCDC', 'Meetup']);
    expect(first.created[0]).toMatchObject({
      sourceModule: 'speaking',
      sourceId: 'event-1',
      date: '2026-08-14',
      snapshot: {
        title: 'KCDC',
        date: '2026-08-14',
        url: 'https://kcdc.info',
        capturedAt: NOW.toISOString(),
      },
      metrics: { attendees: 80 },
    });
    expect(first.missing).toEqual(['event-9']);

    const second = parse(
      await h.importEvidence(
        makeRequest({ body: { sourceModule: 'speaking', ids: ['event-1'] } }),
        context
      )
    );
    expect(second.created).toEqual([]);
    expect(second.existing).toHaveLength(1);

    const sources = parse(
      await h.listImportSources(makeRequest({ params: { sourceModule: 'speaking' } }), context)
    );
    expect(sources.items.map((s) => [s.id, s.imported])).toEqual([
      ['event-2', true],
      ['event-1', true],
    ]);
    expect(
      (await h.importEvidence(makeRequest({ body: { sourceModule: 'labs', ids: ['x'] } }), context))
        .status
    ).toBe(400);
  });

  it('lists with filters and computes readiness over the container', async () => {
    const store = memStore();
    const h = createAmbassadorHandlers({ guard: guardAs('editor'), store, ...fixed });
    await h.listPrograms(makeRequest(), context);
    await h.createEvidence(
      makeRequest({ body: { title: 'Talk', date: '2026-05-01', sourceModule: 'speaking' } }),
      context
    );
    await h.createEvidence(
      makeRequest({
        body: {
          title: 'Cert',
          date: '2026-06-01',
          sourceModule: 'certifications',
          verificationStatus: 'verified',
          programIds: ['program-microsoft-mct'],
        },
      }),
      context
    );

    expect(
      parse(
        await h.listEvidence(makeRequest({ query: { sourceModule: 'speaking' } }), context)
      ).items.map((e) => e.title)
    ).toEqual(['Talk']);
    expect(
      parse(
        await h.listEvidence(makeRequest({ query: { verificationStatus: 'verified' } }), context)
      ).items
    ).toHaveLength(1);
    expect(
      parse(
        await h.listEvidence(
          makeRequest({ query: { programId: 'program-aws-ambassador' } }),
          context
        )
      ).items.map((e) => e.title)
    ).toEqual(['Talk']);

    const res = parse(
      await h.readiness(
        makeRequest({ params: { programId: 'program-microsoft-mct' }, query: { period: '2026' } }),
        context
      )
    );
    expect(res.readiness.requirements.find((r) => r.id === 'cert')).toMatchObject({
      count: 1,
      met: true,
    });
    expect(res.readiness.explanation).toMatch(/Acceptance is decided by the program/);
    expect(
      (await h.readiness(makeRequest({ params: { programId: 'nope' } }), context)).status
    ).toBe(404);
  });
});
