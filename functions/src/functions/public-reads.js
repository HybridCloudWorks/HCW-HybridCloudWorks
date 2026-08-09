/**
 * public-reads.js — anonymous read routes for the public site
 * (api-surface.json rest.publicReads). Registration only; semantics live in
 * lib/public-reads.js. No guard: these replace reads Firestore rules used to
 * allow anonymously, and the lib enforces the public-document filter that
 * those rules provided.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { queryDocs, readDoc } from '../lib/cosmos-client.js';
import { createPublicReadHandlers } from '../lib/public-reads.js';

const handlers = () => createPublicReadHandlers({ store: { queryDocs, readDoc } });

httpRoute('publicListContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/content',
  handler: (request, context) => handlers().listContent(request, context),
});

httpRoute('publicGetContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/content/{slugOrId}',
  handler: (request, context) => handlers().getContent(request, context),
});

httpRoute('publicGetSnapshot', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/snapshots/{id}',
  handler: (request, context) => handlers().getSnapshot(request, context),
});

httpRoute('publicListPodcasts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/podcasts',
  handler: (request, context) => handlers().listPodcasts(request, context),
});

httpRoute('publicGetFeed', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/feed',
  handler: (request, context) => handlers().getFeed(request, context),
});
