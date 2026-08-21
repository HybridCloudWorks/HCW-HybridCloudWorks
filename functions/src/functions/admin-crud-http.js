/**
 * admin-crud-http.js — CRUD routes for the certifications and social-posts
 * admin pages (api-surface adminWrites). Registration only; semantics in
 * lib/admin-crud.js, auth via the two-gate role guard.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc } from '../lib/cosmos-client.js';
import { createAdminCrudHandlers } from '../lib/admin-crud.js';
import { createPublerClient } from '../lib/timers/publer-sync.js';
import { unpublishFromPubler } from '../lib/triggers/handlers.js';

const handlers = () =>
  createAdminCrudHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, upsertDoc, patchDoc, deleteDoc },
    // T-324: the change feed never sees a delete, so the Publer un-publish
    // that syncSocialPostToPubler's `!after` branch did happens on the route.
    unpublishSocialPost: (doc) => unpublishFromPubler(createPublerClient(), doc),
  });

httpRoute('cmsListCertifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/certifications',
  handler: (request, context) => handlers().listCertifications(request, context),
});

httpRoute('cmsCreateCertification', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/certifications',
  handler: (request, context) => handlers().createCertification(request, context),
});

httpRoute('cmsPatchCertification', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'cms/certifications/{id}',
  handler: (request, context) => handlers().patchCertification(request, context),
});

httpRoute('cmsDeleteCertification', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/certifications/{id}',
  handler: (request, context) => handlers().deleteCertification(request, context),
});

httpRoute('cmsListSocialPosts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/social-posts',
  handler: (request, context) => handlers().listSocialPosts(request, context),
});

httpRoute('cmsCreateSocialPost', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/social-posts',
  handler: (request, context) => handlers().createSocialPost(request, context),
});

httpRoute('cmsDeleteSocialPost', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/social-posts/{id}',
  handler: (request, context) => handlers().deleteSocialPost(request, context),
});

httpRoute('cmsDeleteBlog', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'cms/blogs/{id}',
  handler: (request, context) => handlers().deleteBlog(request, context),
});
