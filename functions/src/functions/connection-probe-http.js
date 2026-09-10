/**
 * connection-probe-http.js — `connectionProbe` (#483).
 *
 * The Integrations page's beaker for Telegram, RSS.com and YouTube, whose
 * credentials are read only on the server. Semantics, the closed probe table
 * and the reason the caller supplies a NAME rather than a path are all in
 * lib/integrations/connection-probe.js.
 *
 * RPC-style route name, matching what the admin UI posts to.
 */
import { httpRoute } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { readKey } from '../lib/ai/router.js';
import { createConnectionProbe } from '../lib/integrations/connection-probe.js';
import { recordKeyVerdict } from '../lib/key-verdict.js';

// `recordKeyVerdict` is the process-wide writer the AI router, the Publer
// timer and the REST proxies use, so the API-keys page hears about a rejected
// credential from whichever path sees it first (#358). Built per invocation
// for the same reason the proxies are: the guard is resolved lazily so this
// module stays importable without one.
const probe = () =>
  createConnectionProbe({ guard: getDefaultGuard(), readKey, onKeyVerdict: recordKeyVerdict });

httpRoute('connectionProbe', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'connectionProbe',
  handler: (request, context) => probe()(request, context),
});
