/**
 * listen-and-learn-http.js — the Listen & Learn admin surface.
 *
 * Generation is NOT here: it is the `generate-listen-and-learn` job
 * (listen-and-learn-jobs.js), because it runs for minutes and an HTTP response
 * is bounded well below that. These three routes are the fast half — reading
 * what has been generated, and approving it.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { queryDocs, readDoc, patchDoc } from '../lib/cosmos-client.js';
import { createListenAndLearnHandlers } from '../lib/listen-and-learn/handlers.js';

const handlers = () =>
  createListenAndLearnHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, patchDoc },
  });

httpRoute('listListenAndLearnSets', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn',
  handler: (request, context) => handlers().listSets(request, context),
});

httpRoute('reviewListenAndLearn', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/review',
  handler: (request, context) => handlers().reviewEpisode(request, context),
});

// Registered after the literal `review` route so the static segment wins;
// otherwise `cms/listen-and-learn/review` would bind `platform: 'review'`.
httpRoute('getListenAndLearnSet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'cms/listen-and-learn/{platform}/{examCode}',
  handler: (request, context) => handlers().getSet(request, context),
});
