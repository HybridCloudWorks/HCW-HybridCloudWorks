/**
 * Cloud Tools endpoint parity contract.
 *
 * Migration_Plan §7 requires: "Endpoint parity. Every one of the 117 endpoints
 * answers with the same shape as Firebase. Record the Firebase responses
 * BEFORE cutover; they are the fixtures."
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * This is the contract DERIVED FROM SOURCE — read off every `res.json(...)` and
 * `res.status(n).json(...)` in Site-Main `functions/cloud-tools.js` at commit
 * 07f3123. It is a schema, and it is exact about key names and status codes.
 *
 * It is NOT a recording of live Firebase responses. Nobody has called the
 * running system. Field VALUES, and any shape that only appears under real data
 * (an empty catalog, a partially-populated pricing object, a provider that
 * returns no evidence) are not captured here and cannot be, from source alone.
 *
 * So this does two jobs:
 *   1. It pins the response SHAPE now, so the port has a target and a reviewer
 *      has something to diff against.
 *   2. It is the checklist for the live recording that still has to happen
 *      against Firebase before cutover. When those recordings exist, they
 *      should be asserted against this contract — a disagreement means either
 *      the reading was wrong or an undocumented path exists.
 *
 * ---------------------------------------------------------------------------
 * THE ONE INVARIANT
 * ---------------------------------------------------------------------------
 * Every Cloud Tools response, success or failure, carries a boolean `ok`.
 * Success is `{ ok: true, ... }`; failure is exactly `{ ok: false, error: <string> }`
 * with no other keys. The frontend branches on `ok`, not on the HTTP status, so
 * a port that returns a bare error string or omits `ok` breaks the client even
 * when the status code is right.
 */

/** Every failure response in this group. No endpoint deviates from it. */
export const ERROR_ENVELOPE = Object.freeze({ ok: false, error: 'string' });

/**
 * Errors shared by most endpoints, applied before any handler-specific logic.
 * Ordering matters: CORS is checked first, then method, then auth.
 */
export const COMMON_ERRORS = Object.freeze({
  403: 'Origin not allowed', // CORS allowlist, cloud-tools.js:363
  401: 'Authentication required', // cloud-tools.js:394
  405: 'Method not allowed', // every POST-only endpoint
  500: '<error.message>', // handler threw; message is passed through verbatim
});

/**
 * @typedef {object} EndpointContract
 * @property {string} name              Firebase export name
 * @property {'GET'|'POST'} method
 * @property {'public'|'editor'} auth
 * @property {number} timeoutSeconds    Firebase declaration — the requirement to meet
 * @property {string} memory            Firebase declaration
 * @property {string[]} successKeys     Exact top-level keys of the 200 body
 * @property {Record<number,string>} errors  Status -> error string
 * @property {string[]} collections     Firestore collections touched
 * @property {string} notes
 */

/** @type {EndpointContract[]} */
export const CLOUD_TOOLS_CONTRACT = [
  {
    name: 'getToolComparisonData',
    method: 'POST',
    auth: 'public',
    timeoutSeconds: 30,
    memory: '1GiB',
    successKeys: [
      'ok',
      'catalog',
      'selected',
      'cache',
      'freshness',
      'stale',
      'oldestAgeMinutes',
      'region',
      'providerProfile',
    ],
    errors: {
      400: 'Unsupported region',
      405: 'Method not allowed',
      500: '<error.message>',
    },
    collections: ['tool_service_catalog', 'tool_service_cache'],
    notes:
      'PUBLIC and unauthenticated, and it takes serviceIds/region straight from the body. ' +
      'Two abuse paths are closed deliberately and must stay closed in the port: the read path ' +
      'never refreshes on TTL expiry, and a cache MISS must not build (allowBuild: false). ' +
      'Either would let an anonymous caller drive live pricing-API traffic and mint cache ' +
      'documents for any string they name. `stale` is derived: true if ANY entry in `freshness` ' +
      'is stale. `oldestAgeMinutes` is max(ages), or null when no entry can be dated.',
  },
  {
    name: 'refreshToolServiceCache',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 300,
    memory: '4GiB',
    successKeys: ['ok', 'region', 'refreshedCount'],
    errors: { 405: 'Method not allowed', 500: '<error.message>' },
    collections: ['tool_service_cache'],
    notes:
      'The 4GiB is load-bearing, not aspirational: posting with no serviceId loops every service ' +
      'in one invocation and OOM\'d at 2GiB with 2058 MiB used, on one AWS bulk offer document. ' +
      'The 300s timeout may exceed the Azure HTTP gateway cap — if so this endpoint changes ' +
      'shape (queue trigger + 202) and the contract gains an accepted/job-id response. Flagged, ' +
      'not yet decided.',
  },
  {
    name: 'refreshToolServiceCacheScheduled',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 540,
    memory: '4GiB',
    successKeys: [],
    errors: {},
    collections: ['tool_service_cache'],
    notes:
      'Timer, not HTTP — no response contract. Firebase schedule is the string "every 24 hours"; ' +
      'Azure needs 6-field NCRONTAB with SECONDS leading. Migration_Plan §8 lists silent cron ' +
      'translation failure as a live risk, and §7 requires each of the 16 timers observed firing ' +
      'at least once in Azure. This job is the only thing keeping the cache inside its TTL — its ' +
      'absence is what caused the 33-day-stale-pricing RCA.',
  },
  {
    name: 'lookupToolServiceEvidence',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 45,
    memory: '1GiB',
    successKeys: ['ok', 'serviceId', 'region', 'service', 'pricing', 'insights'],
    errors: {
      400: 'serviceId is required',
      404: 'Unknown serviceId: ${serviceId}',
      405: 'Method not allowed',
      500: '<error.message>',
    },
    collections: ['tool_service_catalog', 'tool_service_cache', 'mcp_servers'],
    notes:
      '`pricing` is `built?.pricing || null` — null is a legitimate success value, not an error. ' +
      'The 404 message interpolates the caller-supplied serviceId; preserve that, but note it ' +
      'reflects input back and should not gain any other caller-controlled content.',
  },
  {
    name: 'saveToolWorkspace',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 30,
    memory: '256MiB',
    successKeys: ['ok', 'workspaceId'],
    errors: {
      403: 'Workspace ownership mismatch',
      405: 'Method not allowed',
      500: '<error.message>',
    },
    collections: ['tool_workspaces'],
    notes:
      '`workspaceId` is the Firestore document id (ref.id). On Cosmos this becomes the document ' +
      'id we assign — the port must return the same identifier the client will later read back.',
  },
  {
    name: 'generateArchitecturePlan',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 90,
    memory: '256MiB',
    successKeys: ['ok', 'sessionId', 'planId', 'plan', 'generatedBy'],
    errors: { 405: 'Method not allowed', 500: '<error.message>' },
    collections: ['tool_architecture_plans', 'tool_assessment_sessions', 'tool_ai_plan_quota'],
    notes:
      'TWO success shapes. With a session it returns {ok, sessionId, planId, plan, generatedBy}; ' +
      'without one it returns {ok, plan, generatedBy} — sessionId and planId ABSENT, not null. ' +
      'A port that always emits all five keys is not parity. Rate limited for anonymous callers ' +
      'at ANONYMOUS_AI_PLANS_PER_HOUR = 5. Uses the AI secrets.',
  },
  {
    name: 'uploadMigrationInventory',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 60,
    memory: '256MiB',
    successKeys: ['ok', 'fileName', 'inventory', 'workspaceId'],
    errors: {
      400: 'fileBase64 is required',
      405: 'Method not allowed',
      413: '<payload too large>',
      500: '<error.message>',
    },
    collections: ['tool_migration_workspaces'],
    notes:
      'Parses xlsx via read-excel-file. 413 is a multi-key body, not the plain envelope — read ' +
      'cloud-tools.js:1725 before porting. Header de-duplication in sheetRowsToRecords appends ' +
      '" 2", " 3" to repeated column names; that shape reaches the client and must be preserved.',
  },
  {
    name: 'calculateMigrationInsights',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 30,
    memory: '256MiB',
    successKeys: ['ok', 'insights'],
    errors: { 405: 'Method not allowed', 500: '<error.message>' },
    collections: ['tool_migration_workspaces'],
    notes: 'Pure computation over an uploaded inventory.',
  },
  {
    name: 'exportToolReport',
    method: 'POST',
    auth: 'public',
    timeoutSeconds: 30,
    memory: '256MiB',
    successKeys: ['ok', 'exportId', 'shareId'],
    errors: {
      400: '<payload.error>',
      405: 'Method not allowed',
      500: 'Unable to create export',
    },
    collections: ['tool_exports', 'tool_export_quota'],
    notes:
      'NOTE the 500: it is the literal string "Unable to create export", NOT error.message — the ' +
      'only endpoint in the group that does not leak the exception text. That is deliberate and ' +
      'must survive the port. Rate limited at ANONYMOUS_EXPORTS_PER_HOUR = 10. Size caps: ' +
      'summary 32 KiB, artifact 250 KiB, title 160 chars, type 80 chars.',
  },
  {
    name: 'runToolExpertModeValidation',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 30,
    memory: '256MiB',
    successKeys: ['ok'],
    errors: {
      400: 'Unsupported Expert Mode validator',
      403: 'Plan ownership mismatch | Export ownership mismatch',
      404: 'Architecture plan not found | Export artifact not found',
      405: 'Method not allowed',
      500: '<error.message>',
    },
    collections: ['tool_architecture_plans', 'tool_exports', 'lab_jobs'],
    notes:
      'Validators are allowlisted: terraform-validate, ansible-check. Dispatches a lab job, so ' +
      'the runner contract matters — Migration_Plan §4 says to coordinate the labs group with ' +
      'vps-agent. Two distinct 403s and two distinct 404s; keep the messages apart.',
  },
  {
    name: 'syncToolExpertModeRuns',
    method: 'POST',
    auth: 'editor',
    timeoutSeconds: 30,
    memory: '256MiB',
    successKeys: ['ok'],
    errors: { 405: 'Method not allowed', 500: '<error.message>' },
    collections: ['tool_architecture_plans', 'tool_exports', 'lab_jobs'],
    notes: 'Reconciles completed lab jobs back onto plans/exports.',
  },
];

/** Endpoints reachable without authentication. Getting this wrong is a security bug. */
export const PUBLIC_ENDPOINTS = Object.freeze(
  CLOUD_TOOLS_CONTRACT.filter((e) => e.auth === 'public').map((e) => e.name)
);

/** Lookup by Firebase export name. */
export function contractFor(name) {
  return CLOUD_TOOLS_CONTRACT.find((e) => e.name === name) ?? null;
}

/**
 * Assert a response body matches an endpoint's success contract.
 * Intended for the port's own tests once handlers exist.
 *
 * @param {string} name
 * @param {object} body
 * @returns {string[]} human-readable differences; empty means conforming
 */
export function diffSuccessShape(name, body) {
  const contract = contractFor(name);
  if (!contract) return [`unknown endpoint: ${name}`];

  const expected = new Set(contract.successKeys);
  const actual = new Set(Object.keys(body ?? {}));
  const problems = [];

  for (const key of expected) if (!actual.has(key)) problems.push(`missing key: ${key}`);
  for (const key of actual) if (!expected.has(key)) problems.push(`unexpected key: ${key}`);
  if (body?.ok !== true) problems.push('success body must carry ok: true');

  return problems;
}
