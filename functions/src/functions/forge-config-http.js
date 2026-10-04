/**
 * forge-config-http.js — registration for the Forge Studio routes (Blog
 * Machine T-604, the T-409 remainder; the workspace routes from ADR 0033).
 * Semantics in lib/content/forge-studio.js.
 *
 * The two configuration RPCs are RPC-style like the rest of the admin
 * surface: the portal posts to the function NAME. getForgeConfig also
 * accepts GET for the Studio's initial load. The three workspace routes are
 * REST under cms/forge/*: a brief saved onto a draft, one AI action over the
 * draft text, and an ETag-guarded save of the edited text.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc, patchDoc } from '../lib/cosmos-client.js';
import * as ai from '../lib/ai/router.js';
import {
  createForgeStudioHandlers,
  createForgeWorkspaceHandlers,
} from '../lib/content/forge-studio.js';
import { defaultForgeConfig } from '../lib/content/forge-config-default.js';

const handlers = () =>
  createForgeStudioHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
    // The process-wide loader the forge worker also uses — an update here
    // must clear the cache the next forge run reads, not a private copy.
    config: defaultForgeConfig,
  });

const workspace = () =>
  createForgeWorkspaceHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc, patchDoc },
    ai,
  });

httpRoute('getForgeConfig', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'getForgeConfig',
  handler: (request, context) => handlers().getForgeConfig(request, context),
});

httpRoute('updateForgeConfig', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'updateForgeConfig',
  handler: (request, context) => handlers().updateForgeConfig(request, context),
});

httpRoute('cmsForgeBrief', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/forge/brief',
  handler: (request, context) => workspace().saveBrief(request, context),
});

httpRoute('cmsForgeAssist', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/forge/assist',
  handler: (request, context) => workspace().assist(request, context),
});

httpRoute('cmsForgeSave', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'cms/forge/save',
  handler: (request, context) => workspace().save(request, context),
});
