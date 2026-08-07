/**
 * Shared authenticated API utility for CMS admin calls.
 * Injects an Entra ID access token (audience = the Functions API) into all
 * requests via MSAL — see lib/entraAuth.js.
 */
import { acquireApiToken } from '@/lib/entraAuth';

const GCP_FUNCTIONS_BASE = import.meta.env.VITE_GCP_FUNCTIONS_URL || '';

const DEFAULT_TIMEOUT_MS = 20000;
const FUNCTION_TIMEOUT_MS = {
  fetchRssFeedsManual: 45000,
  batchInspect: 45000,
  generateReviewerDigestManual: 30000,
  deleteRejectedContent: 90000,
  generateArticleDraft: 90000,
  generatePreviewImages: 30000,
};
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const SAFE_RETRY_FUNCTIONS = new Set([
  'fetchRssFeedsManual',
  'batchInspect',
  'generateReviewerDigestManual',
  'deleteRejectedContent',
  'listContentItems',
  'aiStackReadiness',
]);

function timeoutForFunction(fnName) {
  return FUNCTION_TIMEOUT_MS[fnName] || DEFAULT_TIMEOUT_MS;
}

/**
 * Build the full endpoint URL for a Cloud Function.
 * @param {string} fnName - Cloud Function name (e.g. 'submitContentUrls')
 * @returns {string} Full URL
 */
export function getEndpoint(fnName) {
  if (!GCP_FUNCTIONS_BASE) {
    throw new Error(
      `VITE_GCP_FUNCTIONS_URL is not set. Add it to your .env file before calling ${fnName}.`
    );
  }
  return `${GCP_FUNCTIONS_BASE}/${fnName}`;
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
 * @param {string} fnName - Cloud Function name
 * @param {object} options - fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 */
export async function authedFetch(fnName, options = {}) {
  // Throws 'Not authenticated. Please sign in.' with no active account —
  // same contract as the Firebase version. getCurrentAdminStatus keeps its
  // forced refresh so a just-granted role is visible immediately.
  const token = await acquireApiToken({ forceRefresh: fnName === 'getCurrentAdminStatus' });
  const url = getEndpoint(fnName);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
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
 * POST JSON to an authenticated Cloud Function.
 * @param {string} fnName - Cloud Function name
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
