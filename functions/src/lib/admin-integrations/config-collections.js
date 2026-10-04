/**
 * config-collections.js — the client-id configuration collections of the
 * admin integrations surface (lib/aiEngine.js): ai_providers and
 * mcp_servers.
 *
 *   - Both use CLIENT-CHOSEN ids (`setDoc(doc(db, col, p.id))` with seed ids
 *     like 'vertex', 'replicate-mcp'), so PUT upserts at the route id —
 *     unlike the addDoc-style collections where the server mints the id.
 *   - mcp_servers documents can carry an OAuth token (setMcpOAuthToken). The
 *     aiEngine comment says the browser never reads it back and relied on
 *     rules to someday block it; here list/get responses actually strip
 *     `oauthToken` — writes accept it, reads never return it.
 *   - Every mcp_servers write passes the URL and key-name checks of
 *     ai/mcp-policy.js (ADR 0033, security finding).
 *
 * Each handler body is a module-level function over `ctx` (guard, store, now,
 * aiConfigChanged); the factory at the bottom only wires them.
 */
import { validateMcpApiKeyEnvVar, validateMcpUrl } from '../ai/mcp.js';
import { json, LIST_WINDOW, validBody } from '../http/admin-handler.js';

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

/** What a read of this container returns: tokens stripped for mcp_servers. */
const readableDoc = (container, doc) => (container === 'mcp_servers' ? stripOAuthToken(doc) : doc);

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

/** The write checks for this container: the error sentence, or null. */
const writeError = (container, fields) =>
  container === 'mcp_servers' ? mcpWriteError(fields) : null;

/**
 * putConfig is a full replace, and reads never return `oauthToken`
 * (deliberately — it is write-only). So a read-modify-write round trip
 * from any edit form would silently delete a stored token. Carry it
 * forward unless the caller explicitly supplied a new one; an explicit
 * empty string still clears it, which is how a token is revoked (T-314).
 * Same rule for the refresh token the 12-hour timer rotates with.
 */
function carryForwardTokens(doc, incoming, existing) {
  for (const key of ['oauthToken', 'oauthRefreshToken']) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key) && existing?.[key] !== undefined) {
      doc[key] = existing[key];
    }
  }
}

/**
 * A PUT body as the document it stores, less the read artefacts:
 * `{ incoming }` or `{ error }` (a sentence).
 *
 * `hasOauthToken` is a READ artefact — stripOAuthToken synthesises it so
 * consumers can render connection state without seeing the token. An edit
 * form round-tripping a read back into this handler would otherwise persist
 * the boolean into the stored document, where it would then shadow the real
 * value on the next read.
 */
function putDocumentOf(container, body) {
  const { hasOauthToken: _ignored, hasOauthRefreshToken: _ignored2, ...incoming } = body;
  const problem = writeError(container, incoming);
  return problem ? { error: problem } : { incoming };
}

/** Route id and checked body of a PUT: `{ id, incoming }` or `{ error }` holding the response. */
async function prepareConfigPut(container, request) {
  const id = String(request.params.id || '').trim();
  if (!id) return { error: json(400, { error: 'id required' }) };
  const body = validBody(await request.json().catch(() => null));
  if (!body) return { error: json(400, { error: 'Body must be a JSON object' }) };
  const checked = putDocumentOf(container, body);
  return checked.error
    ? { error: json(400, { error: checked.error }) }
    : { id, incoming: checked.incoming };
}

/**
 * The fields a PATCH body changes, less the id and the read artefacts:
 * `{ updates }` or `{ error }` (a sentence).
 *
 * `hasOauthToken` is dropped for the same reason putConfig drops it: it is
 * synthesised by stripOAuthToken on every read, so a form that PATCHes a
 * field it read back would persist a boolean snapshot of the token's
 * presence next to the token. Reads recompute it, so it never shadows the
 * real value — it is simply a stale copy of a secret's state, written into
 * the document, that a later revoke would not clear.
 */
function patchUpdatesOf(container, body) {
  const {
    id: _ignored,
    hasOauthToken: _readArtefact,
    hasOauthRefreshToken: _readArtefact2,
    ...updates
  } = body;
  if (Object.keys(updates).length === 0) {
    return { error: 'Body must contain at least one updatable field' };
  }
  const problem = writeError(container, updates);
  return problem ? { error: problem } : { updates };
}

/** Route id, stored document and checked body of a PATCH: `{ id, updates }` or `{ error }` holding the response. */
async function prepareConfigPatch(store, container, request) {
  const id = String(request.params.id || '').trim();
  if (!id) return { error: json(400, { error: 'id required' }) };
  const body = validBody(await request.json().catch(() => null));
  if (!body || Object.keys(body).length === 0) {
    return { error: json(400, { error: 'Body must be a non-empty JSON object' }) };
  }
  const existing = await store.readDoc(container, id, id);
  if (!existing) return { error: json(404, { error: `${container} ${id} not found` }) };
  const checked = patchUpdatesOf(container, body);
  return checked.error
    ? { error: json(400, { error: checked.error }) }
    : { id, updates: checked.updates };
}

/** GET /api/cms/{ai-providers|mcp-servers} — order asc; tokens stripped. */
async function listConfig(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  const container = CONFIG_COLLECTIONS[request.params.collection];
  if (!container) return json(404, { error: 'Unknown collection' });
  try {
    const rows = await ctx.store.queryDocs(container, `SELECT TOP ${LIST_WINDOW} * FROM c`, []);
    const items = rows
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map((doc) => readableDoc(container, doc));
    return json(200, { success: true, items, total: items.length });
  } catch (error) {
    context.error(`listConfig(${container}) failed:`, error);
    return json(500, { error: 'Failed to list configuration' });
  }
}

/** PUT /api/cms/{collection}/{id} — setDoc semantics at a client id. */
async function putConfig(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  const container = CONFIG_COLLECTIONS[request.params.collection];
  if (!container) return json(404, { error: 'Unknown collection' });
  try {
    const prepared = await prepareConfigPut(container, request);
    if (prepared.error) return prepared.error;
    const { id, incoming } = prepared;

    const existing = await ctx.store.readDoc(container, id, id);
    const nowIso = ctx.now().toISOString();
    const doc = {
      ...incoming,
      id,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    if (container === 'mcp_servers') carryForwardTokens(doc, incoming, existing);
    await ctx.store.upsertDoc(container, doc);
    if (container === 'ai_providers') ctx.aiConfigChanged();
    return json(200, { success: true, id, item: readableDoc(container, doc) });
  } catch (error) {
    context.error(`putConfig(${container}) failed:`, error);
    return json(500, { error: 'Failed to save configuration' });
  }
}

/** PATCH /api/cms/{collection}/{id} — setEnabled / model / token / url patches. */
async function patchConfig(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  const container = CONFIG_COLLECTIONS[request.params.collection];
  if (!container) return json(404, { error: 'Unknown collection' });
  try {
    const prepared = await prepareConfigPatch(ctx.store, container, request);
    if (prepared.error) return prepared.error;
    const updated = await ctx.store.patchDoc(container, prepared.id, {
      ...prepared.updates,
      updatedAt: ctx.now().toISOString(),
    });
    if (container === 'ai_providers') ctx.aiConfigChanged();
    return json(200, { success: true, item: readableDoc(container, updated) });
  } catch (error) {
    context.error(`patchConfig(${container}) failed:`, error);
    return json(500, { error: 'Failed to update configuration' });
  }
}

/** DELETE /api/cms/{collection}/{id} */
async function deleteConfig(ctx, request, context) {
  const auth = await ctx.guard.requireRole(request, 'editor');
  if (auth.error) return auth.error;
  const container = CONFIG_COLLECTIONS[request.params.collection];
  if (!container) return json(404, { error: 'Unknown collection' });
  try {
    const id = String(request.params.id || '').trim();
    if (!id) return json(400, { error: 'id required' });
    await ctx.store.deleteDoc(container, id);
    if (container === 'ai_providers') ctx.aiConfigChanged();
    return json(200, { success: true });
  } catch (error) {
    context.error(`deleteConfig(${container}) failed:`, error);
    return json(500, { error: 'Failed to delete configuration' });
  }
}

/** @param {{ guard: object, store: object, now: () => Date, aiConfigChanged: () => void }} ctx */
export function createConfigCollectionHandlers(ctx) {
  return {
    listConfig: (request, context) => listConfig(ctx, request, context),
    putConfig: (request, context) => putConfig(ctx, request, context),
    patchConfig: (request, context) => patchConfig(ctx, request, context),
    deleteConfig: (request, context) => deleteConfig(ctx, request, context),
  };
}
