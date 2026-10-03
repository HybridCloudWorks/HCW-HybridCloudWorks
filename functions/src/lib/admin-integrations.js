/**
 * Admin integrations CRUD — recordings, speaker events, settings, image
 * gallery reads, AI providers / MCP servers, and usage records
 * (api-surface adminReads + the remaining adminWrites slices).
 *
 * No backend source to port: these mirror the browser call sites —
 * RecordingsPage.jsx, SpeakingEventsPage.jsx, lib/adminSettings.js,
 * lib/imageGallery.js, lib/aiEngine.js — behind the editor role guard.
 *
 * Semantics worth naming:
 *   - ai_providers / mcp_servers use CLIENT-CHOSEN ids (`setDoc(doc(db, col,
 *     p.id))` with seed ids like 'vertex', 'replicate-mcp'), so PUT upserts
 *     at the route id — unlike the addDoc-style collections where the server
 *     mints the id.
 *   - mcp_servers documents can carry an OAuth token (setMcpOAuthToken). The
 *     aiEngine comment says the browser never reads it back and relied on
 *     rules to someday block it; here list/get responses actually strip
 *     `oauthToken` — writes accept it, reads never return it.
 *   - The settings doc (admin_settings/integrations) is a MERGE-save
 *     (`setDoc(..., { merge: true })`): patch when it exists, create when it
 *     doesn't — a replace would drop unrelated settings fields.
 *   - Every list sorts in memory (createdAt / order / timestamp) — Cosmos
 *     ORDER BY drops docs missing the property, the trap documented in
 *     public-reads.js.
 */
import { randomUUID } from 'node:crypto';
import {
  buildGalleryListing,
  CONTENT_USAGE_PROJECTION,
  GALLERY_MAX_LIMIT,
  parseGalleryListParams,
} from './gallery-images.js';
import {
  AI_FEATURES,
  DEFAULT_PROVIDER_ORDER,
  FEATURE_NAMES,
  FEATURES_DOC_ID,
  MAX_ROUTE_FALLBACKS,
  PER_FEATURE_PROVIDERS,
  PLACEMENTS,
  PROVIDER_PLACEMENT_DEFAULTS,
  ROUTING_DOC_ID,
  isPlacementConfigurable,
  normalizeRoute,
  normalizeRouting,
  placementFor,
} from './ai/ai-config.js';
import { validateMcpApiKeyEnvVar, validateMcpUrl } from './ai/mcp.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const MAX_DOC_JSON = 120_000;
const LIST_WINDOW = 1000;

function validBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (JSON.stringify(body).length > MAX_DOC_JSON) return null;
  return body;
}

const dateValue = (v) => {
  if (!v) return 0;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

/** Route-segment → container allowlist for the client-id config collections. */
const CONFIG_COLLECTIONS = {
  'ai-providers': 'ai_providers',
  'mcp-servers': 'mcp_servers',
};

// The token values are write-only, but consumers need to know whether one is
// stored (RecordingsPage renders 'connected' from status + token presence,
// and since 2026-09-05 shows whether the 12-hour refresh timer has a refresh
// token to work with) — so reads carry a boolean in place of each.
const stripOAuthToken = ({ oauthToken, oauthRefreshToken, ...rest }) => ({
  ...rest,
  hasOauthToken: Boolean(oauthToken),
  hasOauthRefreshToken: Boolean(oauthRefreshToken),
});

const SETTINGS_CONTAINER = 'admin_settings';
const SETTINGS_DOC_ID = 'integrations';
/**
 * The Change history row a settings save writes: the same action and shape
 * platform-settings.js uses (PLATFORM_SETTING_AUDIT_ACTION), with
 * `details.setting` naming this document, so the Platform Settings hub lists
 * the Sessionize speaker id beside every other setting (ADR 0033 Platform).
 */
export const INTEGRATIONS_SETTING_AUDIT_ACTION = 'platform_setting_updated';
export const INTEGRATIONS_SETTING_NAME = 'integrations';
/** Kept in step with the router's reader by ai-config.js exporting it. */
const AI_FEATURES_DOC_ID = FEATURES_DOC_ID;

/**
 * Validate one route of a PUT cms/ai-routing body. Returns the error
 * sentence, or null. Stricter than the router's normaliser on purpose: the
 * router drops what it cannot use so a stored oddity never breaks a call,
 * while a save names the mistake so it is never stored.
 */
function routeError(feature, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `routes.${feature} must be { provider, model?, fallbacks? } or null`;
  }
  const provider = String(raw.provider || '')
    .toLowerCase()
    .trim();
  if (!DEFAULT_PROVIDER_ORDER.includes(provider)) {
    return `routes.${feature}.provider must be one of ${DEFAULT_PROVIDER_ORDER.join(', ')}`;
  }
  if (raw.model !== undefined && raw.model !== null && typeof raw.model !== 'string') {
    return `routes.${feature}.model must be a string or null`;
  }
  if (raw.fallbacks !== undefined) {
    if (!Array.isArray(raw.fallbacks)) return `routes.${feature}.fallbacks must be an array`;
    if (raw.fallbacks.length > MAX_ROUTE_FALLBACKS) {
      return `routes.${feature}.fallbacks: at most ${MAX_ROUTE_FALLBACKS}`;
    }
    const seen = new Set([provider]);
    for (const entry of raw.fallbacks) {
      const fallback = String(entry?.provider || '')
        .toLowerCase()
        .trim();
      if (!DEFAULT_PROVIDER_ORDER.includes(fallback)) {
        return `routes.${feature}.fallbacks: unknown provider "${entry?.provider ?? ''}"`;
      }
      if (seen.has(fallback)) {
        return `routes.${feature}.fallbacks: ${fallback} is listed twice (or is the primary)`;
      }
      seen.add(fallback);
      if (entry.model !== undefined && entry.model !== null && typeof entry.model !== 'string') {
        return `routes.${feature}.fallbacks: model must be a string or null`;
      }
    }
  }
  return null;
}

/**
 * The checks every mcp_servers write passes (ADR 0033, security finding):
 * the URL is https (loopback excepted) and the key name is on the allowlist.
 * Only the fields present are checked, so a PATCH that flips `enabled` on a
 * server saved before the allowlist still goes through; the next Sync or
 * call refuses the bad field with the same sentence.
 */
function mcpWriteError(fields) {
  try {
    if (Object.prototype.hasOwnProperty.call(fields, 'url')) validateMcpUrl(fields.url);
    if (Object.prototype.hasOwnProperty.call(fields, 'apiKeyEnvVar')) {
      validateMcpApiKeyEnvVar(fields.apiKeyEnvVar);
    }
  } catch (error) {
    return error.message;
  }
  return null;
}

/**
 * Every per-feature provider's placement for every feature, as the router
 * will apply it — lock included — so the portal renders what will happen
 * rather than what was stored (#701).
 */
function resolvedPlacement(doc) {
  return Object.fromEntries(
    PER_FEATURE_PROVIDERS.map((provider) => [
      provider,
      Object.fromEntries(FEATURE_NAMES.map((name) => [name, placementFor(doc, provider, name)])),
    ])
  );
}

/**
 * Validate a `placement` patch: `{ <provider>: { <feature>: 'first'|'order'|'off' } }`.
 *
 * Returns the error sentence, or null. A locked feature accepts only 'off':
 * configuration can reorder and disable, never enable (ai-config.js), and
 * storing a 'first' the router will ignore would leave a setting in the
 * document that reads as working and governs nothing.
 */
function placementError(placement) {
  if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
    return 'placement must be { <provider>: { <feature>: "first" | "order" | "off" } }';
  }
  for (const [provider, byFeature] of Object.entries(placement)) {
    if (!PER_FEATURE_PROVIDERS.includes(provider)) {
      return `Unknown per-feature provider: ${provider}. Known: ${PER_FEATURE_PROVIDERS.join(', ')}`;
    }
    if (!byFeature || typeof byFeature !== 'object' || Array.isArray(byFeature)) {
      return `placement.${provider} must be { <feature>: "first" | "order" | "off" }`;
    }
    for (const [feature, value] of Object.entries(byFeature)) {
      if (!FEATURE_NAMES.includes(feature)) return `Unknown AI feature: ${feature}`;
      if (!PLACEMENTS.includes(value)) {
        return `placement.${provider}.${feature} must be one of ${PLACEMENTS.join(', ')}`;
      }
      if (value !== 'off' && !isPlacementConfigurable(provider, feature)) {
        return `${provider} is never used for ${feature}; that cannot be changed from the portal.`;
      }
    }
  }
  return null;
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ queryDocs: Function, readDoc: Function, upsertDoc: Function, patchDoc: Function, deleteDoc: Function }} deps.store
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createAdminIntegrationHandlers({
  guard,
  store,
  now = () => new Date(),
  uuid = randomUUID,
  // Called after any write the AI router reads (providers, features,
  // routing), so the router's 60 s cache is dropped in THIS process and a
  // change applies on the next call rather than after the TTL (ADR 0033).
  // Other warm instances converge within the TTL, as before.
  onAiConfigChanged = () => {},
}) {
  const aiConfigChanged = () => {
    try {
      onAiConfigChanged();
    } catch {
      // Invalidation is a convenience; the write already happened.
    }
  };

  return {
    // ── recordings (RecordingsPage.jsx) ────────────────────────────────────

    /** GET /api/cms/recordings — local library, newest first. */
    async listRecordings(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const limit = Math.min(Math.max(Number(request.query.get('limit')) || 100, 1), 500);
        const items = await store.queryDocs('recordings', `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
        const sorted = items
          .sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt))
          .slice(0, limit);
        return json(200, {
          success: true,
          items: sorted,
          total: sorted.length,
        });
      } catch (error) {
        context.error('listRecordings failed:', error);
        return json(500, { error: 'Failed to list recordings' });
      }
    },

    /** POST /api/cms/recordings — both page paths require title + transcript. */
    async createRecording(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });
        if (!String(body.title || '').trim() || !String(body.transcript || '').trim()) {
          return json(400, { error: 'title and transcript are required' });
        }
        const doc = {
          status: 'new',
          ...body,
          id: uuid(),
          createdAt: now().toISOString(),
        };
        await store.upsertDoc('recordings', doc);
        return json(200, { success: true, id: doc.id, item: doc });
      } catch (error) {
        context.error('createRecording failed:', error);
        return json(500, { error: 'Failed to create recording' });
      }
    },

    /** PATCH /api/cms/recordings/{id} — routing updates (status, contentId). */
    async patchRecording(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const body = validBody(await request.json().catch(() => null));
        if (!body || Object.keys(body).length === 0) {
          return json(400, { error: 'Body must be a non-empty JSON object' });
        }
        const existing = await store.readDoc('recordings', id, id);
        if (!existing) return json(404, { error: `recording ${id} not found` });
        const { id: _ignored, ...updates } = body;
        const updated = await store.patchDoc('recordings', id, updates);
        return json(200, { success: true, item: updated });
      } catch (error) {
        context.error('patchRecording failed:', error);
        return json(500, { error: 'Failed to update recording' });
      }
    },

    // ── speaker events (SpeakingEventsPage.jsx reads) ──────────────────────

    /** GET /api/cms/speakerevents — writes stay on the upsert/delete RPCs. */
    async listSpeakerEvents(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const items = await store.queryDocs(
          'speakerevents',
          `SELECT TOP ${LIST_WINDOW} * FROM c`,
          []
        );
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listSpeakerEvents failed:', error);
        return json(500, { error: 'Failed to list speaker events' });
      }
    },

    // ── settings (lib/adminSettings.js) ────────────────────────────────────

    /** GET /api/cms/settings — the integrations doc, {} when missing. */
    async getSettings(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const doc = await store.readDoc(SETTINGS_CONTAINER, SETTINGS_DOC_ID, SETTINGS_DOC_ID);
        return json(200, { success: true, settings: doc || {} });
      } catch (error) {
        context.error('getSettings failed:', error);
        return json(500, { error: 'Failed to get settings' });
      }
    },

    /** PUT /api/cms/settings — merge-save (setDoc merge:true semantics). */
    async putSettings(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        if (!body || Object.keys(body).length === 0) {
          return json(400, { error: 'Body must be a non-empty JSON object' });
        }
        const { id: _ignored, ...updates } = body;
        const nowIso = now().toISOString();
        const existing = await store.readDoc(SETTINGS_CONTAINER, SETTINGS_DOC_ID, SETTINGS_DOC_ID);
        let settings;
        if (existing) {
          settings = await store.patchDoc(SETTINGS_CONTAINER, SETTINGS_DOC_ID, {
            ...updates,
            updatedAt: nowIso,
          });
        } else {
          settings = await store.upsertDoc(SETTINGS_CONTAINER, {
            id: SETTINGS_DOC_ID,
            ...updates,
            updatedAt: nowIso,
          });
        }
        // The Sessionize speaker id is edited on the Integrations page but it
        // is a platform setting like any other, so its save joins the Platform
        // Settings Change history through the same `platform_setting_updated`
        // row platform-settings.js writes (ADR 0033 Platform). Best effort,
        // like that writer: the save has landed, and a failed audit row must
        // not report it as refused.
        if (Object.prototype.hasOwnProperty.call(updates, 'sessionizeSpeakerId')) {
          const before = String(existing?.sessionizeSpeakerId ?? '').trim();
          const after = String(updates.sessionizeSpeakerId ?? '').trim();
          try {
            await store.upsertDoc('admin_audit_logs', {
              id: uuid(),
              action: INTEGRATIONS_SETTING_AUDIT_ACTION,
              userId: auth.user?.oid || auth.user?.sub || null,
              userName: auth.user?.name || null,
              userEmail: auth.user?.email || auth.user?.preferred_username || null,
              timestamp: nowIso,
              // A public identifier (it is the Sessionize URL), so the value
              // itself is a choice the history can show.
              details: {
                setting: INTEGRATIONS_SETTING_NAME,
                sessionizeSpeakerId: after || null,
                changed: before !== after,
              },
            });
          } catch (auditError) {
            context.warn?.(
              `putSettings saved but the audit row failed: ${auditError?.message || auditError}`
            );
          }
        }
        return json(200, { success: true, settings });
      } catch (error) {
        context.error('putSettings failed:', error);
        return json(500, { error: 'Failed to save settings' });
      }
    },

    // ── AI feature switches (lib/ai/ai-config.js) ──────────────────────────

    /**
     * GET /api/cms/ai-features — which parts of the site may call a model.
     *
     * The catalogue travels with the answer so the portal renders its toggles
     * from the server's list rather than a copy of it. That copy is exactly how
     * the AI Engine page came to advertise Vertex as enabled and OpenAI as
     * deprecated while the router did the opposite — a second list nobody
     * updated. There is one list, and it is AI_FEATURES.
     */
    async getAiFeatures(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const doc = await store.readDoc(SETTINGS_CONTAINER, AI_FEATURES_DOC_ID, AI_FEATURES_DOC_ID);
        const stored = doc?.features || {};
        // Absent means on, the same rule the router applies. Resolving it here
        // means the UI renders real state instead of an empty object.
        const features = Object.fromEntries(
          FEATURE_NAMES.map((name) => [name, stored[name] !== false])
        );
        return json(200, {
          success: true,
          features,
          catalogue: AI_FEATURES,
          // #701: where each per-feature provider goes, and the code-level
          // defaults ('off' there is a lock the portal renders as such).
          placement: resolvedPlacement(doc),
          placementDefaults: PROVIDER_PLACEMENT_DEFAULTS,
        });
      } catch (error) {
        context.error('getAiFeatures failed:', error);
        return json(500, { error: 'Failed to read AI feature settings' });
      }
    },

    /**
     * PUT /api/cms/ai-features — body { features?: { <name>: boolean },
     * placement?: { <provider>: { <name>: 'first'|'order'|'off' } } }, at
     * least one of the two. Both merge; neither replaces.
     */
    async putAiFeatures(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        const hasPlacement = body?.placement !== undefined;
        const incoming = body?.features ?? (hasPlacement ? {} : undefined);
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return json(400, {
            error:
              'Body must be { features: { <name>: boolean } } and/or { placement: { <provider>: { <name>: "first" | "order" | "off" } } }',
          });
        }
        if (hasPlacement) {
          const problem = placementError(body.placement);
          if (problem) return json(400, { error: problem });
        }

        // An unknown name is either a typo or a hand-made request, and silently
        // storing it would leave a switch in the document that governs nothing.
        const unknown = Object.keys(incoming).filter((name) => !FEATURE_NAMES.includes(name));
        if (unknown.length > 0) {
          return json(400, {
            error: `Unknown AI feature(s): ${unknown.join(', ')}. Known: ${FEATURE_NAMES.join(', ')}`,
          });
        }

        // Stored as strict booleans. The router only treats an explicit false as
        // off, so a stray 0 or "false" would read as ON — coercing here means
        // the document cannot express that ambiguity in the first place.
        const features = Object.fromEntries(
          Object.entries(incoming).map(([name, value]) => [name, value !== false])
        );

        const nowIso = now().toISOString();
        const existing = await store.readDoc(
          SETTINGS_CONTAINER,
          AI_FEATURES_DOC_ID,
          AI_FEATURES_DOC_ID
        );
        const merged = { ...(existing?.features || {}), ...features };
        // Placement merges one level deeper: setting one feature's nvidia
        // placement must not clear another's.
        const placement = hasPlacement
          ? Object.fromEntries(
              [
                ...new Set([
                  ...Object.keys(existing?.placement || {}),
                  ...Object.keys(body.placement),
                ]),
              ].map((provider) => [
                provider,
                {
                  ...(existing?.placement?.[provider] || {}),
                  ...(body.placement[provider] || {}),
                },
              ])
            )
          : undefined;
        const fields = {
          features: merged,
          ...(placement ? { placement } : {}),
          updatedAt: nowIso,
        };
        const saved = existing
          ? await store.patchDoc(SETTINGS_CONTAINER, AI_FEATURES_DOC_ID, fields)
          : await store.upsertDoc(SETTINGS_CONTAINER, {
              id: AI_FEATURES_DOC_ID,
              ...fields,
            });
        const result = saved || { ...existing, ...fields };
        aiConfigChanged();
        return json(200, {
          success: true,
          features: result.features || merged,
          placement: resolvedPlacement(result),
        });
      } catch (error) {
        context.error('putAiFeatures failed:', error);
        return json(500, { error: 'Failed to save AI feature settings' });
      }
    },

    // ── AI routing by task (lib/ai/ai-config.js, ADR 0033 §4) ──────────────

    /**
     * GET /api/cms/ai-routing — which provider and model serve each feature.
     *
     * `routes` holds only the features that have one; a feature absent here
     * follows the global order of preference ("Simple mode"). The catalogue
     * travels with the answer for the same reason getAiFeatures sends it.
     */
    async getAiRouting(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const doc = await store.readDoc(SETTINGS_CONTAINER, ROUTING_DOC_ID, ROUTING_DOC_ID);
        return json(200, {
          success: true,
          routes: normalizeRouting(doc).routes,
          catalogue: AI_FEATURES,
          providers: DEFAULT_PROVIDER_ORDER,
          maxFallbacks: MAX_ROUTE_FALLBACKS,
          updatedAt: doc?.updatedAt || null,
        });
      } catch (error) {
        context.error('getAiRouting failed:', error);
        return json(500, { error: 'Failed to read AI routing' });
      }
    },

    /**
     * PUT /api/cms/ai-routing — body { routes: { <feature>: route | null } }.
     * Merges: a feature not in the body keeps its route; `null` removes one
     * (back to the global order). Same role as the feature switches.
     */
    async putAiRouting(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        const incoming = body?.routes;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return json(400, {
            error:
              'Body must be { routes: { <feature>: { provider, model?, fallbacks?: [{ provider, model? }] } | null } }',
          });
        }
        const unknown = Object.keys(incoming).filter((name) => !FEATURE_NAMES.includes(name));
        if (unknown.length > 0) {
          return json(400, {
            error: `Unknown AI feature(s): ${unknown.join(', ')}. Known: ${FEATURE_NAMES.join(', ')}`,
          });
        }
        for (const [feature, raw] of Object.entries(incoming)) {
          if (raw === null) continue;
          const problem = routeError(feature, raw);
          if (problem) return json(400, { error: problem });
        }

        const existing = await store.readDoc(SETTINGS_CONTAINER, ROUTING_DOC_ID, ROUTING_DOC_ID);
        const routes = { ...normalizeRouting(existing).routes };
        for (const [feature, raw] of Object.entries(incoming)) {
          if (raw === null) delete routes[feature];
          else routes[feature] = normalizeRoute(raw);
        }
        const nowIso = now().toISOString();
        const doc = { id: ROUTING_DOC_ID, routes, updatedAt: nowIso };
        // A full replace rather than a patch: `routes` is one map, and a
        // removed feature has to leave the stored document, not linger as a
        // key the patch never touched.
        await store.upsertDoc(SETTINGS_CONTAINER, existing ? { ...existing, ...doc } : doc);
        aiConfigChanged();
        return json(200, { success: true, routes, updatedAt: nowIso });
      } catch (error) {
        context.error('putAiRouting failed:', error);
        return json(500, { error: 'Failed to save AI routing' });
      }
    },

    // ── image gallery reads (lib/imageGallery.js) ──────────────────────────

    /**
     * GET /api/cms/images — the media library listing (ADR 0033). Query:
     * q, folder, source, provider, slot, tag, set, contentId, articleId,
     * state (active|archived|trash|all), sort (newest|oldest|title|most-used),
     * offset, limit (≤200), usage=1 (attach the content documents using each
     * image). Filtering, sorting and paging live in
     * lib/gallery-images.js buildGalleryListing; this does the reads.
     *
     * The read window is ORDER BY c._ts DESC — `_ts` exists on every row
     * where `createdAt` does not (curated rows never had one), so the newest
     * thousand are what the window holds. Within it, rows sort by createdAt
     * with a curated row's generatedAt standing in.
     *
     * `curated` and `generated` are still returned, newest first, for the
     * editor's gallery and the Submit URLs preview gallery, which read them.
     */
    async listImages(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const params = parseGalleryListParams((key) => request.query.get(key));
        const where = params.articleId ? ' WHERE c.articleId = @articleId' : '';
        const parameters = params.articleId
          ? [{ name: '@articleId', value: params.articleId }]
          : [];
        const query = `SELECT TOP ${LIST_WINDOW} * FROM c${where} ORDER BY c._ts DESC`;
        const [curated, generated, content] = await Promise.all([
          store.queryDocs('curated_article_images', query, parameters),
          store.queryDocs('generated_content_images', query, parameters),
          params.usage
            ? store
                .queryDocs(
                  'content',
                  `SELECT TOP 2000 ${CONTENT_USAGE_PROJECTION} FROM c WHERE NOT IS_DEFINED(c.softDeletedAt) AND (IS_DEFINED(c.heroImageUrl) OR IS_DEFINED(c.altCoverImage) OR IS_DEFINED(c.contentImageUrl) OR IS_DEFINED(c.coverImage) OR IS_DEFINED(c.aiImageUrls) OR IS_DEFINED(c.secondaryImageUrls))`,
                  []
                )
                .catch((error) => {
                  context.warn?.('listImages usage read failed:', error?.message);
                  return [];
                })
            : Promise.resolve([]),
        ]);
        const listing = buildGalleryListing({ curated, generated, content }, params);
        // The compatibility arrays: every matching row of each collection,
        // newest first, capped at `limit`.
        const matching = buildGalleryListing(
          { curated, generated, content },
          { ...params, offset: 0, limit: GALLERY_MAX_LIMIT * 5 }
        ).items;
        return json(200, {
          success: true,
          ...listing,
          curated: matching
            .filter((item) => item.galleryCollection === 'curated_article_images')
            .slice(0, params.limit),
          generated: matching
            .filter((item) => item.galleryCollection === 'generated_content_images')
            .slice(0, params.limit),
        });
      } catch (error) {
        context.error('listImages failed:', error);
        return json(500, { error: 'Failed to list images' });
      }
    },

    /**
     * GET /api/cms/images/curated/{id} — single cache lookup for
     * useGenerateCuratedImages (was a direct curated_article_images getDoc).
     * Missing docs answer 200 with item:null — the hook treats absence as
     * "generate a new one", not an error.
     */
    async getCuratedImage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const doc = await store.readDoc('curated_article_images', id, id);
        return json(200, { success: true, item: doc || null });
      } catch (error) {
        context.error('getCuratedImage failed:', error);
        return json(500, { error: 'Failed to get curated image' });
      }
    },

    // ── AI providers / MCP servers (lib/aiEngine.js) ───────────────────────

    /** GET /api/cms/{ai-providers|mcp-servers} — order asc; tokens stripped. */
    async listConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = CONFIG_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown collection' });
      try {
        const rows = await store.queryDocs(container, `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
        const items = rows
          .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
          .map(container === 'mcp_servers' ? stripOAuthToken : (d) => d);
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error(`listConfig(${container}) failed:`, error);
        return json(500, { error: 'Failed to list configuration' });
      }
    },

    /** PUT /api/cms/{collection}/{id} — setDoc semantics at a client id. */
    async putConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = CONFIG_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown collection' });
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const body = validBody(await request.json().catch(() => null));
        if (!body) return json(400, { error: 'Body must be a JSON object' });

        const existing = await store.readDoc(container, id, id);
        const nowIso = now().toISOString();

        // `hasOauthToken` is a READ artefact — stripOAuthToken synthesises it
        // so consumers can render connection state without seeing the token.
        // An edit form round-tripping a read back into this handler would
        // otherwise persist the boolean into the stored document, where it
        // would then shadow the real value on the next read.
        const { hasOauthToken: _ignored, hasOauthRefreshToken: _ignored2, ...incoming } = body;
        if (container === 'mcp_servers') {
          const problem = mcpWriteError(incoming);
          if (problem) return json(400, { error: problem });
        }

        const doc = {
          ...incoming,
          id,
          createdAt: existing?.createdAt || nowIso,
          updatedAt: nowIso,
        };

        // putConfig is a full replace, and reads never return `oauthToken`
        // (deliberately — it is write-only). So a read-modify-write round trip
        // from any edit form would silently delete a stored token. Carry it
        // forward unless the caller explicitly supplied a new one; an explicit
        // empty string still clears it, which is how a token is revoked
        // (T-314).
        if (
          container === 'mcp_servers' &&
          !Object.prototype.hasOwnProperty.call(incoming, 'oauthToken') &&
          existing?.oauthToken !== undefined
        ) {
          doc.oauthToken = existing.oauthToken;
        }
        // Same rule for the refresh token the 12-hour timer rotates with.
        if (
          container === 'mcp_servers' &&
          !Object.prototype.hasOwnProperty.call(incoming, 'oauthRefreshToken') &&
          existing?.oauthRefreshToken !== undefined
        ) {
          doc.oauthRefreshToken = existing.oauthRefreshToken;
        }
        await store.upsertDoc(container, doc);
        if (container === 'ai_providers') aiConfigChanged();
        const item = container === 'mcp_servers' ? stripOAuthToken(doc) : doc;
        return json(200, { success: true, id, item });
      } catch (error) {
        context.error(`putConfig(${container}) failed:`, error);
        return json(500, { error: 'Failed to save configuration' });
      }
    },

    /** PATCH /api/cms/{collection}/{id} — setEnabled / model / token / url patches. */
    async patchConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = CONFIG_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown collection' });
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        const body = validBody(await request.json().catch(() => null));
        if (!body || Object.keys(body).length === 0) {
          return json(400, { error: 'Body must be a non-empty JSON object' });
        }
        const existing = await store.readDoc(container, id, id);
        if (!existing) return json(404, { error: `${container} ${id} not found` });
        // `hasOauthToken` is dropped for the same reason putConfig drops it:
        // it is synthesised by stripOAuthToken on every read, so a form that
        // PATCHes a field it read back would persist a boolean snapshot of the
        // token's presence next to the token. Reads recompute it, so it never
        // shadows the real value — it is simply a stale copy of a secret's
        // state, written into the document, that a later revoke would not
        // clear.
        const {
          id: _ignored,
          hasOauthToken: _readArtefact,
          hasOauthRefreshToken: _readArtefact2,
          ...updates
        } = body;
        if (Object.keys(updates).length === 0) {
          return json(400, {
            error: 'Body must contain at least one updatable field',
          });
        }
        if (container === 'mcp_servers') {
          const problem = mcpWriteError(updates);
          if (problem) return json(400, { error: problem });
        }
        const updated = await store.patchDoc(container, id, {
          ...updates,
          updatedAt: now().toISOString(),
        });
        if (container === 'ai_providers') aiConfigChanged();
        const item = container === 'mcp_servers' ? stripOAuthToken(updated) : updated;
        return json(200, { success: true, item });
      } catch (error) {
        context.error(`patchConfig(${container}) failed:`, error);
        return json(500, { error: 'Failed to update configuration' });
      }
    },

    /** DELETE /api/cms/{collection}/{id} */
    async deleteConfig(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      const container = CONFIG_COLLECTIONS[request.params.collection];
      if (!container) return json(404, { error: 'Unknown collection' });
      try {
        const id = String(request.params.id || '').trim();
        if (!id) return json(400, { error: 'id required' });
        await store.deleteDoc(container, id);
        if (container === 'ai_providers') aiConfigChanged();
        return json(200, { success: true });
      } catch (error) {
        context.error(`deleteConfig(${container}) failed:`, error);
        return json(500, { error: 'Failed to delete configuration' });
      }
    },

    // ── usage records (aiEngine getUsageRecords) ───────────────────────────

    /** GET /api/cms/ai-usage?limit=&since= — timestamp desc. */
    async listUsage(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const limit = Math.min(Math.max(Number(request.query.get('limit')) || 100, 1), 500);
        const since = String(request.query.get('since') || '').trim();

        // Newest first IN THE QUERY (ADR 0033): `TOP 1000` with no ORDER BY
        // returned an arbitrary thousand, so once the container held more
        // rows than that the newest calls could be the ones left out. Every
        // row carries `timestamp` (usage.js writes it), so the ORDER BY
        // drops nothing; the in-memory sort below stays as the tiebreak.
        let query = `SELECT TOP ${LIST_WINDOW} * FROM c`;
        const parameters = [];
        if (since) {
          if (Number.isNaN(new Date(since).getTime())) {
            return json(400, { error: 'since must be a valid date' });
          }
          query += ' WHERE c.timestamp >= @since';
          parameters.push({ name: '@since', value: since });
        }
        query += ' ORDER BY c.timestamp DESC';
        const rows = await store.queryDocs('ai_usage', query, parameters);
        const items = rows
          .sort((a, b) => dateValue(b.timestamp) - dateValue(a.timestamp))
          .slice(0, limit);
        return json(200, { success: true, items, total: items.length });
      } catch (error) {
        context.error('listUsage failed:', error);
        return json(500, { error: 'Failed to list usage records' });
      }
    },
  };
}
