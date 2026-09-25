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
 * Three answers, all 200, the last two cached for a minute:
 *
 *   { configured: false }
 *       CODER_URL or CODER_STATUS_TOKEN is absent, or still the unresolved
 *       `@Microsoft.KeyVault(…)` literal an unseeded reference arrives as. The
 *       card reads "not yet provisioned". No store read, no network.
 *   { configured: true, reachable: false, templates: [], capacity: { running: null, max }, asOf }
 *       Coder refused, timed out, or answered something that was not the
 *       documented shape.
 *   { configured: true, reachable: true, templates: [{ name, activeVersion }], capacity: { running, max }, asOf }
 *
 * A FAILURE IS CACHED TOO, and it replaces whatever healthy entry was there.
 * A stale-but-healthy document served through a Coder outage would show
 * numbers that are no longer true, so the card says "unreachable" until the
 * next minute's attempt succeeds. `running` is null on that path: an unknown
 * count is reported as unknown, never as zero.
 *
 * Coder endpoints, from https://coder.com/docs/reference/api (Templates and
 * Workspaces pages, retrieved 2026-09-25). Every call carries the
 * `Coder-Session-Token` header, which is how the reference authenticates
 * each of them:
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
 * slugs the page's "Open in Coder" links use, and version names are what an
 * operator would say aloud. No URL, no workspace name, no owner, no id —
 * nothing that describes the deployment beyond those names and two numbers.
 */

import { fetchWithTimeout } from '../http/fetch-with-timeout.js';
import { isUnresolvedReference } from '../secrets-health.js';
import { createMinuteCache, MINUTE_CACHE_SECONDS } from './minute-cache.js';

export const CODER_STATUS_CACHE_ID = 'labs:coder-status';
export const CODER_STATUS_CACHE_SECONDS = MINUTE_CACHE_SECONDS;
/** A Coder that has not answered in five seconds is reported unreachable, not waited for. */
export const CODER_TIMEOUT_MS = 5_000;
/** Community edition's concurrency cap (ADR 0032 §4), when CODER_MAX_WORKSPACES says nothing. */
export const DEFAULT_CODER_MAX_WORKSPACES = 5;
/** Templates shown, and therefore version lookups made, per refresh. */
export const MAX_TEMPLATES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status, body, cacheSeconds = 0) => ({
  status,
  headers: {
    'Content-Type': 'application/json',
    ...(cacheSeconds > 0 ? { 'Cache-Control': `public, max-age=${cacheSeconds}` } : {}),
  },
  body: JSON.stringify(body),
});

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
 * The proxy's configuration, or null when it has none.
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
  const token = readSetting(env, 'CODER_STATUS_TOKEN');
  if (!rawUrl || !token) return null;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  return {
    base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    token,
    max: readMaxWorkspaces(env),
  };
}

/** Both settings present but the pair still unusable — worth one warning line. */
const hasCoderSettings = (env) =>
  Boolean(readSetting(env, 'CODER_URL') && readSetting(env, 'CODER_STATUS_TOKEN'));

async function coderGet(fetchImpl, config, path) {
  const response = await fetchWithTimeout(fetchImpl, `${config.base}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'Coder-Session-Token': config.token },
    timeoutMs: CODER_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Coder answered ${response.status} for ${path}`), {
      status: response.status,
    });
  }
  return response.json();
}

/** The active version's name, or null when it cannot be resolved — never the uuid. */
async function resolveVersionName(fetchImpl, config, versionId, context) {
  if (typeof versionId !== 'string' || !UUID.test(versionId)) return null;
  try {
    const version = await coderGet(
      fetchImpl,
      config,
      `/api/v2/templateversions/${encodeURIComponent(versionId)}`
    );
    return typeof version?.name === 'string' && version.name ? version.name : null;
  } catch (error) {
    context?.warn?.(`coder-status: template version lookup failed: ${error?.message ?? error}`);
    return null;
  }
}

/**
 * Coder's answer, shaped for the card. Throws on anything but the documented
 * shape, so the caller records "unreachable" rather than guessing at fields.
 */
async function readLive({ fetchImpl, config, context }) {
  const running = new URLSearchParams({ q: 'status:running' });
  const [templates, workspaces] = await Promise.all([
    coderGet(fetchImpl, config, '/api/v2/templates'),
    coderGet(fetchImpl, config, `/api/v2/workspaces?${running}`),
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
 * @param {object} deps
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {Function} [deps.fetchImpl]
 * @param {Record<string, string|undefined>} [deps.env]
 * @param {() => number} [deps.now] - epoch ms
 */
export function createCoderStatusHandlers({
  store,
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
      if (hasCoderSettings(env)) {
        context?.warn?.('coder-status: CODER_URL is not an https URL; reporting unconfigured');
      }
      return { configured: false };
    }

    const cached = await cache.read(context);
    if (cached) return cached;

    const asOf = new Date(now()).toISOString();
    let body;
    try {
      const live = await readLive({ fetchImpl, config, context });
      body = {
        configured: true,
        reachable: true,
        templates: live.templates,
        capacity: { running: live.running, max: config.max },
        asOf,
      };
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

    /** GET /api/public/labs/coder-status */
    async getCoderStatus(request, context) {
      try {
        const body = await readStatus(context);
        return json(200, body, body.configured ? CODER_STATUS_CACHE_SECONDS : 0);
      } catch (error) {
        context.error('publicGetLabsCoderStatus failed:', error);
        return json(500, { error: 'Failed to read Coder status' });
      }
    },
  };
}
