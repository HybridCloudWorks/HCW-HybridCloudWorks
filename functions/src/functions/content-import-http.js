/**
 * content-import-http.js — the repository draft import (owner request
 * 2026-09-28). Semantics in lib/cms/repo-import.js, the GitHub fetch in
 * lib/cms/repo-draft-source.js, the allow-list and document shape in
 * lib/cms/repo-draft.js.
 *
 * `cms/content/import-repo` (POST: import the listed paths as in_review) and
 * `cms/content/import-repo/candidates` (GET: the drafts on main, marked with
 * what is already imported). Two templates, so two registrations, each
 * through httpRouteByMethod so that a later verb on either is a new key in
 * `handlers`, never a second function on the same template (TODO.md T-510).
 * Both are literal segments under `cms/content/`, beside rehost-images, slug
 * and item, so the `cms/content/{id}` DELETE template does not capture them.
 */
import { httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createDoc, patchDoc, queryDocs, readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createContentDocument } from '../lib/cms/content-create.js';
import { createRepoDraftSource } from '../lib/cms/repo-draft-source.js';
import { createRepoImportHandlers } from '../lib/cms/repo-import.js';

const handlers = (context) =>
  createRepoImportHandlers({
    guard: getDefaultGuard(),
    store: { queryDocs, readDoc, patchDoc, upsertDoc, createDoc },
    source: createRepoDraftSource(),
    persist: createContentDocument,
    log: context,
  });

httpRouteByMethod('cmsContentImportRepo', {
  authLevel: 'anonymous',
  route: 'cms/content/import-repo',
  handlers: {
    POST: (request, context) => handlers(context).importDrafts(request, context),
  },
});

httpRouteByMethod('cmsContentImportRepoCandidates', {
  authLevel: 'anonymous',
  route: 'cms/content/import-repo/candidates',
  handlers: {
    GET: (request, context) => handlers(context).listCandidates(request, context),
  },
});
