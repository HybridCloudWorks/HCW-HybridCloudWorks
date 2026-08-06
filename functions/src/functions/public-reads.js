/**
 * public-reads.js — anonymous read routes for the public site
 * (api-surface.json rest.publicReads). Registration only; semantics live in
 * lib/public-reads.js. No guard: these replace reads Firestore rules used to
 * allow anonymously, and the lib enforces the public-document filter that
 * those rules provided.
 */
import { app } from '@azure/functions';
import { queryDocs, readDoc } from '../lib/cosmos-client.js';
import { createPublicReadHandlers } from '../lib/public-reads.js';

const handlers = () => createPublicReadHandlers({ store: { queryDocs, readDoc } });

app.http('publicListContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/content',
  handler: (request, context) => handlers().listContent(request, context),
});

app.http('publicGetContent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/content/{slugOrId}',
  handler: (request, context) => handlers().getContent(request, context),
});

app.http('publicGetSnapshot', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/snapshots/{id}',
  handler: (request, context) => handlers().getSnapshot(request, context),
});

app.http('publicListPodcasts', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/podcasts',
  handler: (request, context) => handlers().listPodcasts(request, context),
});

app.http('publicGetFeed', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'public/feed',
  handler: (request, context) => handlers().getFeed(request, context),
});
