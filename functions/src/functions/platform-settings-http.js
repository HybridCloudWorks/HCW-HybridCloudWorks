/**
 * platform-settings-http.js — the Admin → Platform settings page's routes
 * (#351, #352, #348). Registration only; semantics in
 * lib/platform-settings.js.
 *
 * The {setting} segment is allowlisted in the lib (default-heroes,
 * social-autopost, podcast-feeds, listen-and-learn-speech) — anything else
 * 404s before touching Cosmos, the same pattern as cms/config/{collection}.
 */
import { httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readDoc, upsertDoc } from '../lib/cosmos-client.js';
import { createPlatformSettingsHandlers } from '../lib/platform-settings.js';

const handlers = () =>
  createPlatformSettingsHandlers({
    guard: getDefaultGuard(),
    store: { readDoc, upsertDoc },
  });

httpRouteByMethod('cmsPlatformSetting', {
  authLevel: 'anonymous',
  route: 'cms/platform-settings/{setting}',
  handlers: {
    GET: (request, context) => handlers().getSetting(request, context),
    PUT: (request, context) => handlers().putSetting(request, context),
  },
});
