/**
 * ambassador-http.js — the Spotlight → Ambassador hub's routes (ADR 0033 §4).
 * Registration only; semantics in lib/ambassador.js. One registration per
 * route template, the method fan-out inside it (http-route.js, T-510).
 *
 * Every verb is guarded in the handler: editor reads and writes, publisher
 * deletes, super_admin changes the program catalogue.
 */
import { httpRoute, httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import { createAmbassadorHandlers } from '../lib/ambassador.js';

const handlers = (context) =>
  createAmbassadorHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc },
    log: context,
  });

httpRouteByMethod('cmsAmbassadorPrograms', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/programs',
  handlers: {
    GET: (request, context) => handlers(context).listPrograms(request, context),
    POST: (request, context) => handlers(context).createProgram(request, context),
  },
});

httpRouteByMethod('cmsAmbassadorProgramById', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/programs/{id}',
  handlers: {
    PATCH: (request, context) => handlers(context).patchProgram(request, context),
    DELETE: (request, context) => handlers(context).deleteProgram(request, context),
  },
});

httpRouteByMethod('cmsAmbassadorApplications', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/applications',
  handlers: {
    GET: (request, context) => handlers(context).listApplications(request, context),
    POST: (request, context) => handlers(context).createApplication(request, context),
  },
});

httpRouteByMethod('cmsAmbassadorApplicationById', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/applications/{id}',
  handlers: {
    PATCH: (request, context) => handlers(context).patchApplication(request, context),
    DELETE: (request, context) => handlers(context).deleteApplication(request, context),
  },
});

httpRouteByMethod('cmsAmbassadorEvidence', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/evidence',
  handlers: {
    GET: (request, context) => handlers(context).listEvidence(request, context),
    POST: (request, context) => handlers(context).createEvidence(request, context),
  },
});

// Declared before `evidence/{id}` so the literal segment is not read as an id.
httpRoute('cmsAmbassadorEvidenceImport', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/ambassador/evidence/import',
  handler: (request, context) => handlers(context).importEvidence(request, context),
});

httpRoute('cmsAmbassadorEvidenceSources', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/ambassador/evidence/sources/{sourceModule}',
  handler: (request, context) => handlers(context).listImportSources(request, context),
});

httpRouteByMethod('cmsAmbassadorEvidenceById', {
  authLevel: 'anonymous',
  route: 'cms/ambassador/evidence/{id}',
  handlers: {
    PATCH: (request, context) => handlers(context).patchEvidence(request, context),
    DELETE: (request, context) => handlers(context).deleteEvidence(request, context),
  },
});

httpRoute('cmsAmbassadorReadiness', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/ambassador/readiness/{programId}',
  handler: (request, context) => handlers(context).readiness(request, context),
});
