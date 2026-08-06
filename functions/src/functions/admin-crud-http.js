/**
 * admin-crud-http.js — CRUD routes for the certifications and social-posts
 * admin pages (api-surface adminWrites). Registration only; semantics in
 * lib/admin-crud.js, auth via the two-gate role guard.
 */
import { app } from '@azure/functions';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createAdminCrudHandlers } from '../lib/admin-crud.js';

const handlers = () =>
  createAdminCrudHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
  });

app.http('cmsListCertifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/certifications',
  handler: (request, context) => handlers().listCertifications(request, context),
});

app.http('cmsCreateCertification', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/certifications',
  handler: (request, context) => handlers().createCertification(request, context),
});

app.http('cmsPatchCertification', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/certifications/{id}',
  handler: (request, context) => handlers().patchCertification(request, context),
});

app.http('cmsDeleteCertification', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/certifications/{id}',
  handler: (request, context) => handlers().deleteCertification(request, context),
});

app.http('cmsListSocialPosts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/social-posts',
  handler: (request, context) => handlers().listSocialPosts(request, context),
});

app.http('cmsCreateSocialPost', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/social-posts',
  handler: (request, context) => handlers().createSocialPost(request, context),
});

app.http('cmsDeleteSocialPost', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/social-posts/{id}',
  handler: (request, context) => handlers().deleteSocialPost(request, context),
});
