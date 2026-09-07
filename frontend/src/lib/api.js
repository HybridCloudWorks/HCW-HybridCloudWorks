/**
 * Shared authenticated API utility for CMS admin calls.
 * Injects an Entra ID access token (audience = the Functions API) into all
 * requests via MSAL — see lib/entraAuth.js.
 *
 * ===========================================================================
 * WHY entraAuth IS IMPORTED DYNAMICALLY (T-736)
 * ===========================================================================
 * `import { acquireApiToken } from '@/lib/entraAuth'` was a static import, and
 * entraAuth imports `@azure/msal-browser`. Any module that imports anything
 * from this file therefore dragged 236 kB of MSAL into its chunk — including
 * `useGenerateCuratedImages`, which is on the public `/:provider/news` route.
 * So an anonymous visitor downloaded and executed MSAL to look at a news grid.
 *
 * That hook's own header claims its role gate "stops the hook dragging MSAL
 * onto the critical path of a public page". The runtime gate does work; the
 * module graph never followed it, because a static import is resolved before
 * any gate runs.
 *
 * The import moves inside `authedFetch`, which is already `async` and already
 * awaits the token — so no caller signature changes and no call site needs to
 * know. MSAL now loads when the first authenticated request is made, which on
 * a public route is never.
 *
 * Keep it dynamic. A static `import` of entraAuth anywhere in this file's
 * graph silently undoes this, with no test failure and no visible symptom
 * beyond a slower public page — which is exactly how it got here.
 * `msal-not-on-public-routes.test.js` is what actually holds the line.
 */
import { requireFunctionsBase } from '@/lib/functionsBase';

const DEFAULT_TIMEOUT_MS = 20000;
const FUNCTION_TIMEOUT_MS = {
  generateReviewerDigestManual: 30000,
  deleteRejectedContent: 90000,
  generateArticleDraft: 90000,
  createContentFromRecording: 90000,
  generatePreviewImages: 30000,
  // A batch of articles each fetching its body images (15 s per image, four
  // at a time) — sized with the Function host's 230 s cap, not the default.
  'cms/content/rehost-images': 200000,
};
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SAFE_RETRY_FUNCTIONS = new Set([
  'generateReviewerDigestManual',
  'deleteRejectedContent',
  'listContentItems',
  'aiStackReadiness',
]);

function timeoutForFunction(fnName) {
  return FUNCTION_TIMEOUT_MS[fnName] || DEFAULT_TIMEOUT_MS;
}

/**
 * Build the full endpoint URL for an Azure Functions route.
 * @param {string} fnName - Route name (e.g. 'submitContentUrls', 'cms/content')
 * @returns {string} Full URL
 */
export function getEndpoint(fnName) {
  return `${requireFunctionsBase(fnName)}/${fnName}`;
}

/**
 * Fetch with a function-aware timeout via AbortController.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @param {string} fnName
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options, timeoutMs, fnName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `${fnName} timed out after ${Math.round(timeoutMs / 1000)}s (${url}). This may indicate slow backend processing or a temporary network issue.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticated fetch wrapper.
 * Automatically injects an Entra Bearer token.
 * Admin status forces a token refresh so a newly granted role is visible immediately.
 * Retries once on transient 429/5xx failures with a 2-second backoff.
 *
 * @param {string} fnName - Azure Functions route name
 * @param {object} options - fetch options (method, body, etc.), plus an
 *   optional `token`: a bearer token the caller has ALREADY acquired. When
 *   given, no acquisition happens here — the Admin Diagnostics page needs the
 *   token it decodes and the token it sends to be one acquisition, and a
 *   caller-supplied Authorization header alone did not achieve that (the
 *   acquisition still ran, and was a forced refresh). Nothing else should
 *   need this; every other caller wants the acquisition.
 * @returns {Promise<Response>}
 */
export async function authedFetch(fnName, { token: presetToken, ...options } = {}) {
  let token = presetToken;
  if (!token) {
    // Throws 'Not authenticated. Please sign in.' with no active account —
    // same contract as the Firebase version. getCurrentAdminStatus keeps its
    // forced refresh so a just-granted role is visible immediately.
    const { acquireApiToken } = await import('@/lib/entraAuth');
    token = await acquireApiToken({ forceRefresh: fnName === 'getCurrentAdminStatus' });
  }
  const url = getEndpoint(fnName);

  // Caller headers first, Authorization LAST, and any Authorization the caller
  // supplied is dropped on the way in. The previous order let a caller's
  // header silently replace the token this function had just acquired; the
  // only sanctioned way to change what is sent is the `token` option above.
  const callerHeaders = Object.fromEntries(
    Object.entries(options.headers || {}).filter(([name]) => name.toLowerCase() !== 'authorization')
  );
  const headers = {
    'Content-Type': 'application/json',
    ...callerHeaders,
    Authorization: `Bearer ${token}`,
  };

  const timeoutMs = timeoutForFunction(fnName);
  const shouldRetry = SAFE_RETRY_FUNCTIONS.has(fnName);
  const attemptFetch = () => fetchWithTimeout(url, { ...options, headers }, timeoutMs, fnName);

  let res;
  try {
    res = await attemptFetch();
  } catch (err) {
    if (!shouldRetry) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    res = await attemptFetch();
  }

  if (shouldRetry && !res.ok && RETRYABLE_STATUSES.has(res.status)) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    res = await attemptFetch();
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const detailText = errData?.details ? ` Details: ${JSON.stringify(errData.details)}` : '';
    throw new Error(
      (errData.error || `${fnName} failed with HTTP ${res.status}. Try again or check the logs.`) +
        detailText
    );
  }

  return res;
}

/**
 * POST JSON to an authenticated Azure Functions route.
 * @param {string} fnName - Azure Functions route name
 * @param {object} body - JSON payload
 * @returns {Promise<object>} Parsed JSON response
 */
export async function postJSON(fnName, body) {
  const res = await authedFetch(fnName, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

/**
 * GET an authenticated REST route (e.g. 'cms/certifications').
 * @param {string} fnName - route path after the API base
 * @returns {Promise<object>} Parsed JSON response
 */
export async function getJSON(fnName, options = {}) {
  // `options` reaches authedFetch unchanged, so `token` (a pre-acquired
  // bearer token — see authedFetch) works here too.
  const res = await authedFetch(fnName, { ...options, method: 'GET' });
  return res.json();
}

/**
 * Send JSON to an authenticated REST route with an explicit method
 * (PATCH/PUT/DELETE). Omit body for body-less requests.
 * @param {string} fnName - route path after the API base
 * @param {string} method - HTTP method
 * @param {object} [body] - JSON payload
 * @returns {Promise<object>} Parsed JSON response
 */
export async function sendJSON(fnName, method, body) {
  const res = await authedFetch(fnName, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}
