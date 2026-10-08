/**
 * health-http.js — the Health Hub's stored probe results (#1011).
 * Registration only; the store, the validation and the roles are
 * lib/health/probe-results.js, and the pulse that writes most of the results
 * is the `healthPulse` timer in schedulers.js (lib/health/pulse.js).
 *
 *   GET  cms/health/probe-results  every probe's last result and the pulse's heartbeat (viewer)
 *   PUT  cms/health/probe-results  one probe's result, at the role the probe needs to run
 */
import { httpRouteByMethod } from '../lib/auth/http-route.js';
import { getDefaultGuard } from '../lib/auth/default-guard.js';
import { createDoc, queryDocs, readDoc, replaceDocIfMatch } from '../lib/cosmos-client.js';
import { createProbeResultHandlers } from '../lib/health/probe-results.js';

// Built per invocation: the guard is resolved lazily so this module stays
// importable without one (the route inventory imports every module).
const handlers = () =>
  createProbeResultHandlers({
    guard: getDefaultGuard(),
    store: { createDoc, queryDocs, readDoc, replaceDocIfMatch },
  });

httpRouteByMethod('cmsHealthProbeResults', {
  authLevel: 'anonymous',
  route: 'cms/health/probe-results',
  handlers: {
    GET: (request, context) => handlers().getProbeResults(request, context),
    PUT: (request, context) => handlers().putProbeResult(request, context),
  },
});
