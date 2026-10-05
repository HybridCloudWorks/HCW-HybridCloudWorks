/**
 * GET /api/public/labs/coder-status — the server-side Coder status proxy
 * (#680, Phase 2 of #659; ADR 0032 decision 4).
 *
 * The public labs page shows which Coder templates exist and how many
 * workspaces are running, without the browser ever calling Coder: the SPA's
 * `connect-src` stays closed (frontend/staticwebapp.config.json) and the
 * read-only token never leaves the Function App. The route is anonymous, so
 * it is bounded the way the pricing read is — one document in
 * `tool_service_cache`, refreshed at most once a minute however many visitors
 * open the page (minute-cache.js).
 *
 * THE PANES OPEN ON THIS READ. `/education/labs/<id>` shows a lab's pane only
 * when this answers configured and reachable (LabPanePage.jsx), so those two
 * depend on nothing but Coder's address and Coder answering. Before the lab
 * launcher (2026-09-28) both also needed the status token: the owner's first
 * sign-in could not happen in a pane, because the token that opened the
 * panes was made from that sign-in, and the token's one-year expiry would
 * have closed every pane on the day it lapsed. The token now adds the
 * card's templates and running count, and nothing else.
 *
 * Four answers, all 200, the last three cached for a minute:
 *
 *   { configured: false }
 *       CODER_URL is absent, not an https URL, or still the unresolved
 *       `@Microsoft.KeyVault(…)` literal an unseeded reference arrives as. The
 *       card reads "not yet provisioned". No store read, no network.
 *   { configured: true, reachable: false, templates: [], capacity: { running: null, max }, asOf }
 *       `GET /api/v2/buildinfo` refused, timed out, or answered something
 *       that was not the documented shape.
 *   { configured: true, reachable: true, templates: [], capacity: { running: null, max }, asOf }
 *       Coder answers, and the detail is unknown: CODER_STATUS_TOKEN is
 *       absent or unresolved, Coder refused it (401 or 403, an expired or
 *       revoked token), or the detail calls failed. A warning names the
 *       setting, never its value.
 *   { configured: true, reachable: true, templates: [{ name, activeVersion }], capacity: { running, max }, asOf }
 *
 * `running: null` on a reachable answer is how the card tells "detail
 * unknown" from "no templates yet": with the token working, `running` is
 * always a number (readDetail throws on a missing count). An unknown count is
 * reported as unknown, never as zero.
 *
 * A FAILURE IS CACHED TOO, and it replaces whatever healthy entry was there.
 * A stale-but-healthy document served through a Coder outage would show
 * numbers that are no longer true, so the card says "unreachable" until the
 * next minute's attempt succeeds.
 *
 * Coder endpoints, from https://coder.com/docs/reference/api (retrieved
 * 2026-09-25) and Coder v2.37.3's router (coderd/coderd.go, read
 * 2026-09-28):
 *
 *   GET /api/v2/buildinfo
 *       Unauthenticated (registered outside the API-key middleware), and so
 *       sent with no token at all. `version` is a string.
 *
 * The detail calls carry the `Coder-Session-Token` header, which is how the
 * reference authenticates each of them:
 *
 *   GET /api/v2/templates
 *       codersdk.Template[] — `name`, `active_version_id`, … ; deprecated
 *       templates are omitted unless asked for, which is what the card wants.
 *   GET /api/v2/templateversions/{templateversion}
 *       codersdk.TemplateVersion — `name` is the version a reader recognises;
 *       the template row carries only the version's uuid.
 *   GET /api/v2/workspaces?q=status:running
 *       { count, workspaces[] } — `q` is documented as `key:value` search with
 *       `status` among its keys; `count` is the number matching.
 *
 * What the response carries and what it does not: template names are the
 * slugs the labs card lists, and version names are what an operator would
 * say aloud. No URL, no workspace name, no owner, no id —
 * nothing that describes the deployment beyond those names and two numbers.
 */

import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { isUnresolvedReference } from '../secrets-health.js';
import { createMinuteCache, jsonResponse, MINUTE_CACHE_SECONDS } from './minute-cache.js';

export const CODER_STATUS_CACHE_ID = 'labs:coder-status';
export const CODER_STATUS_CACHE_SECONDS = MINUTE_CACHE_SECONDS;
/** A Coder that has not answered in five seconds is reported unreachable, not waited for. */
export const CODER_TIMEOUT_MS = 5_000;
/** Community edition's concurrency cap (ADR 0032 §4), when CODER_MAX_WORKSPACES says nothing. */
export const DEFAULT_CODER_MAX_WORKSPACES = 5;
/** Templates shown, and therefore version lookups made, per refresh. */
export const MAX_TEMPLATES = 10;

/** The Integrations card turns red this many days before the status token expires (#763). */
export const TOKEN_RENEW_WARNING_DAYS = 30;

/**
 * The Coder scope that lets a token read its own record (`GET
 * /api/v2/users/me/keys/{id}`), documented by Coder as "View API keys". A
 * token scoped to `template:read` and `workspace:read` alone is refused that
 * read (403), so the card can only say "unknown" until the token is renewed
 * with this scope added (lab-host/README.md, "The status token for the site").
 */
export const TOKEN_SCOPE_FOR_EXPIRY = 'api_key:read';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An app setting that is actually set: non-empty, and not the literal an
 * unseeded Key Vault reference resolves to. Same normalisation as the AI
 * router's `readKey`, without importing the router into a public read.
 */
export function readSetting(env, name) {
  const raw = env?.[name];
  if (typeof raw !== 'string') return '';
  const value = raw.replace(/^﻿/, '').trim();
  return isUnresolvedReference(value) ? '' : value;
}

/** CODER_MAX_WORKSPACES as a positive integer, or the Community cap. */
export function readMaxWorkspaces(env) {
  const parsed = Number.parseInt(readSetting(env, 'CODER_MAX_WORKSPACES'), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CODER_MAX_WORKSPACES;
}

/**
 * The proxy's configuration, or null when it has none. Only the address
 * decides: `token` is '' when CODER_STATUS_TOKEN is absent or unresolved,
 * and the read then reports reachability without the detail.
 *
 * `CODER_URL` must be an `https:` URL: the token travels in a header, and a
 * plain-http address would send it in the clear to whatever answers. A URL
 * that fails that test is reported as unconfigured (and logged by the caller),
 * not used.
 *
 * @returns {{ base: string, token: string, max: number } | null}
 */
export function readCoderConfig(env = process.env) {
  const rawUrl = readSetting(env, 'CODER_URL');
  if (!rawUrl) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  return {
    base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    token: readSetting(env, 'CODER_STATUS_TOKEN'),
    max: readMaxWorkspaces(env),
  };
}

/** The address is set but unusable — worth one warning line. */
const hasCoderUrl = (env) => Boolean(readSetting(env, 'CODER_URL'));

/**
 * Coder API keys are `<id>-<secret>`; the id, before the dash, is what the
 * key record is read by. '' for anything that is not that shape.
 */
export function tokenKeyId(token) {
  const match = /^([A-Za-z0-9]{6,})-[A-Za-z0-9]+$/.exec(String(token || '').trim());
  return match ? match[1] : '';
}

/**
 * A GET to Coder, with the token only when one is given. Throws on anything
 * but 2xx, a redirect included: Coder's API does not redirect, and fetch
 * following one to another origin would carry `Coder-Session-Token` along,
 * because it drops only Authorization, Cookie and Proxy-Authorization.
 */
async function coderGet(fetchImpl, config, path, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers['Coder-Session-Token'] = token;
  const response = await fetchWithTimeout(fetchImpl, `${config.base}${path}`, {
    method: 'GET',
    headers,
    redirect: 'error',
    timeoutMs: CODER_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Coder answered ${response.status} for ${path}`), {
      status: response.status,
    });
  }
  return response.json();
}

/** Whether Coder answers: the unauthenticated build info, in its documented shape. Throws otherwise. */
async function readReachable(fetchImpl, config) {
  const info = await coderGet(fetchImpl, config, '/api/v2/buildinfo', '');
  if (typeof info?.version !== 'string' || !info.version) {
    throw new Error('Coder build info carried no version');
  }
}

/** The active version's name, or null when it cannot be resolved — never the uuid. */
async function resolveVersionName(fetchImpl, config, versionId, context) {
  if (typeof versionId !== 'string' || !UUID.test(versionId)) return null;
  try {
    const version = await coderGet(
      fetchImpl,
      config,
      `/api/v2/templateversions/${encodeURIComponent(versionId)}`,
      config.token
    );
    return typeof version?.name === 'string' && version.name ? version.name : null;
  } catch (error) {
    context?.warn?.(`coder-status: template version lookup failed: ${error?.message ?? error}`);
    return null;
  }
}

/**
 * The token's detail, shaped for the card. Throws on anything but the
 * documented shape, so the caller reports the detail as unknown rather than
 * guessing at fields.
 */
async function readDetail({ fetchImpl, config, context }) {
  const running = new URLSearchParams({ q: 'status:running' });
  const [templates, workspaces] = await Promise.all([
    coderGet(fetchImpl, config, '/api/v2/templates', config.token),
    coderGet(fetchImpl, config, `/api/v2/workspaces?${running}`, config.token),
  ]);

  if (!Array.isArray(templates)) throw new Error('Coder templates response was not a list');
  if (!workspaces || typeof workspaces !== 'object') {
    throw new Error('Coder workspaces response was not an object');
  }

  const shown = templates
    .filter((t) => typeof t?.name === 'string' && t.name.trim())
    .slice(0, MAX_TEMPLATES);
  const versions = await Promise.all(
    shown.map((t) => resolveVersionName(fetchImpl, config, t.active_version_id, context))
  );

  const count = Number.isInteger(workspaces.count)
    ? workspaces.count
    : Array.isArray(workspaces.workspaces)
      ? workspaces.workspaces.length
      : null;
  if (count === null) throw new Error('Coder workspaces response carried no count');

  return {
    templates: shown.map((t, i) => ({ name: t.name.trim(), activeVersion: versions[i] })),
    running: count,
  };
}

/**
 * The card's templates and capacity: the token's detail, or unknown with a
 * warning that names the setting and why. Never throws, because Coder has
 * already answered by the time this runs, and missing detail must not close
 * the panes.
 */
async function readDetailOrUnknown({ fetchImpl, config, context }) {
  const unknown = { templates: [], capacity: { running: null, max: config.max } };
  if (!config.token) {
    context?.warn?.(
      'coder-status: CODER_STATUS_TOKEN is not set or does not resolve; templates and running workspaces are reported as unknown'
    );
    return unknown;
  }
  try {
    const detail = await readDetail({ fetchImpl, config, context });
    return { templates: detail.templates, capacity: { running: detail.running, max: config.max } };
  } catch (error) {
    const refused = error?.status === 401 || error?.status === 403;
    context?.warn?.(
      refused
        ? `coder-status: Coder refused CODER_STATUS_TOKEN (${error.status}), so it has expired or been revoked; templates and running workspaces are reported as unknown`
        : `coder-status: the templates and workspaces read failed, and both are reported as unknown: ${error?.message ?? error}`
    );
    return unknown;
  }
}

/**
 * When CODER_STATUS_TOKEN expires, from Coder itself (#763). The token's
 * one-year lifetime is set at creation and nothing renews it; until this,
 * the only reminder was a calendar. Reads the token's own record; answers
 * `{ known: true, expiresAt, daysLeft, renewSoon, tokenName, scopes }`, or
 * `{ known: false, reason }` with `reason` one of `unset`, `shape` (not a
 * Coder key, or a record without a date), `scope` (403: the token lacks
 * TOKEN_SCOPE_FOR_EXPIRY), `refused` (401: expired or revoked) or `error`.
 * Never throws, never carries the token.
 */
export async function readTokenExpiry({ fetchImpl, config, context, now = () => Date.now() }) {
  if (!config?.token) return { known: false, reason: 'unset' };
  const keyId = tokenKeyId(config.token);
  if (!keyId) return { known: false, reason: 'shape' };
  try {
    const key = await coderGet(
      fetchImpl,
      config,
      `/api/v2/users/me/keys/${encodeURIComponent(keyId)}`,
      config.token
    );
    const ms = Date.parse(typeof key?.expires_at === 'string' ? key.expires_at : '');
    if (!Number.isFinite(ms)) return { known: false, reason: 'shape' };
    const daysLeft = Math.floor((ms - now()) / 86_400_000);
    return {
      known: true,
      expiresAt: new Date(ms).toISOString(),
      daysLeft,
      renewSoon: daysLeft <= TOKEN_RENEW_WARNING_DAYS,
      tokenName: typeof key.token_name === 'string' ? key.token_name : null,
      scopes: Array.isArray(key.scopes) ? key.scopes.filter((s) => typeof s === 'string') : [],
    };
  } catch (error) {
    if (error?.status === 403) return { known: false, reason: 'scope', scope: TOKEN_SCOPE_FOR_EXPIRY };
    if (error?.status === 401) return { known: false, reason: 'refused' };
    context?.warn?.(`coder-status: the token's own record could not be read: ${error?.message ?? error}`);
    return { known: false, reason: 'error' };
  }
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ requireRole: Function }} [deps.guard] - needed only by the admin token read
 * @param {Function} [deps.fetchImpl]
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {() => number} [deps.now] - epoch ms
 */
export function createCoderStatusHandlers({
  store,
  guard = null,
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = () => Date.now(),
}) {
  const cache = createMinuteCache({
    store,
    id: CODER_STATUS_CACHE_ID,
    kind: 'labs-coder-status',
    now,
    seconds: CODER_STATUS_CACHE_SECONDS,
  });

  /**
   * The status body — the same object the route returns, for the estate read
   * (estate.js) to fold in without a second Coder call or a second cache.
   */
  async function readStatus(context) {
    const config = readCoderConfig(env);
    if (!config) {
      if (hasCoderUrl(env)) {
        context?.warn?.('coder-status: CODER_URL is not an https URL; reporting unconfigured');
      }
      return { configured: false };
    }

    const cached = await cache.read(context);
    if (cached) return cached;

    const asOf = new Date(now()).toISOString();
    let body;
    try {
      await readReachable(fetchImpl, config);
      const detail = await readDetailOrUnknown({ fetchImpl, config, context });
      body = { configured: true, reachable: true, ...detail, asOf };
    } catch (error) {
      context?.warn?.(`coder-status: Coder unreachable: ${error?.message ?? error}`);
      body = {
        configured: true,
        reachable: false,
        templates: [],
        capacity: { running: null, max: config.max },
        asOf,
      };
    }

    await cache.write(body, context);
    return body;
  }

  return {
    readStatus,

    /**
     * GET /api/cms/labs/coder-token — editor. When the status token expires,
     * for the Integrations card (#763). Not cached: it is read on demand.
     */
    async getCoderToken(request, context) {
      if (!guard) return jsonResponse(500, { error: 'The token read is not wired with a guard' }, 0);
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const config = readCoderConfig(env);
      if (!config) return jsonResponse(200, { configured: false }, 0);
      try {
        const token = await readTokenExpiry({ fetchImpl, config, context, now });
        return jsonResponse(
          200,
          { configured: true, token, warningDays: TOKEN_RENEW_WARNING_DAYS },
          0
        );
      } catch (error) {
        context.error('cmsLabsCoderToken failed:', error);
        return jsonResponse(500, { error: 'Failed to read the Coder status token' }, 0);
      }
    },

    /** GET /api/public/labs/coder-status */
    async getCoderStatus(request, context) {
      try {
        const body = await readStatus(context);
        return jsonResponse(200, body, body.configured ? CODER_STATUS_CACHE_SECONDS : 0);
      } catch (error) {
        context.error('publicGetLabsCoderStatus failed:', error);
        return jsonResponse(500, { error: 'Failed to read Coder status' });
      }
    },
  };
}
