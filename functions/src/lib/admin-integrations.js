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
import { AI_FEATURES, FEATURE_NAMES, FEATURES_DOC_ID } from './ai/ai-config.js';

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
/** Kept in step with the router's reader by ai-config.js exporting it. */
const AI_FEATURES_DOC_ID = FEATURES_DOC_ID;

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
}) {
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
        return json(200, { success: true, items: sorted, total: sorted.length });
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
        const items = await store.queryDocs('speakerevents', `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
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
        return json(200, { success: true, features, catalogue: AI_FEATURES });
      } catch (error) {
        context.error('getAiFeatures failed:', error);
        return json(500, { error: 'Failed to read AI feature settings' });
      }
    },

    /** PUT /api/cms/ai-features — body { features: { <name>: boolean } }. */
    async putAiFeatures(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const body = validBody(await request.json().catch(() => null));
        const incoming = body?.features;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
          return json(400, { error: 'Body must be { features: { <name>: boolean } }' });
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
        const saved = existing
          ? await store.patchDoc(SETTINGS_CONTAINER, AI_FEATURES_DOC_ID, {
              features: merged,
              updatedAt: nowIso,
            })
          : await store.upsertDoc(SETTINGS_CONTAINER, {
              id: AI_FEATURES_DOC_ID,
              features: merged,
              updatedAt: nowIso,
            });
        return json(200, { success: true, features: saved?.features || merged });
      } catch (error) {
        context.error('putAiFeatures failed:', error);
        return json(500, { error: 'Failed to save AI feature settings' });
      }
    },

    // ── image gallery reads (lib/imageGallery.js) ──────────────────────────

    /**
     * GET /api/cms/images?limit=&articleId= — both galleries, newest first
     * each; articleId narrows to one article's images (SubmitUrls preview
     * gallery watches generated rows for its session id).
     */
    async listImages(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;
      try {
        const limit = Math.min(Math.max(Number(request.query.get('limit')) || 60, 1), 200);
        const articleId = String(request.query.get('articleId') || '').trim();
        const query = articleId
          ? `SELECT TOP ${LIST_WINDOW} * FROM c WHERE c.articleId = @articleId`
          : `SELECT TOP ${LIST_WINDOW} * FROM c`;
        const parameters = articleId ? [{ name: '@articleId', value: articleId }] : [];
        const [curated, generated] = await Promise.all([
          store.queryDocs('curated_article_images', query, parameters),
          store.queryDocs('generated_content_images', query, parameters),
        ]);
        const newestFirst = (rows) =>
          rows.sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt)).slice(0, limit);
        return json(200, {
          success: true,
          curated: newestFirst(curated),
          generated: newestFirst(generated),
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
        // (TODO.md T-314).
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
          return json(400, { error: 'Body must contain at least one updatable field' });
        }
        const updated = await store.patchDoc(container, id, {
          ...updates,
          updatedAt: now().toISOString(),
        });
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

        let query = `SELECT TOP ${LIST_WINDOW} * FROM c`;
        const parameters = [];
        if (since) {
          if (Number.isNaN(new Date(since).getTime())) {
            return json(400, { error: 'since must be a valid date' });
          }
          query += ' WHERE c.timestamp >= @since';
          parameters.push({ name: '@since', value: since });
        }
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
