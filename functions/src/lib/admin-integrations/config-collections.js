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
 *     ai/mcp-policy.js (ADR 0033, security finding), and since the 2026-10-06
 *     review (AP-B1) the key-to-host binding: a shared integration key may
 *     only be named on a server at its vendor's host, a write that moves
 *     where a credential is sent needs `super_admin`, and every write here
 *     leaves an `admin_audit_logs` row.
 *   - Since #995 (2026-10-07) a server may carry `allowedTools`, the only
 *     tools `mcpProxy` will call on it. A server whose key requires a list
 *     (PUBLER_API_KEY) cannot be saved without one, any write that names
 *     `allowedTools` needs `super_admin`, and so does switching such a
 *     server on or off: enabling it is what puts its tools in reach.
 *
 * Each handler body is a module-level function over `ctx` (guard, store, now,
 * aiConfigChanged); the factory at the bottom only wires them.
 */
import {
  requiresToolAllowlist,
  validateMcpKeyBinding,
  validateMcpToolPolicy,
  validateMcpUrl,
} from '../ai/mcp.js';
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
function mcpWriteError(fields, existing = null) {
  const touchesUrl = Object.prototype.hasOwnProperty.call(fields, 'url');
  const touchesKey = Object.prototype.hasOwnProperty.call(fields, 'apiKeyEnvVar');
  const touchesTools = Object.prototype.hasOwnProperty.call(fields, 'allowedTools');
  try {
    if (touchesUrl) validateMcpUrl(fields.url);
    // The key-to-host binding (AP-B1) is a property of the pair, so a PATCH
    // that moves one half is checked against the stored other half: a URL
    // change on a server holding a shared key, or a shared key placed on a
    // server at the wrong host, is refused either way.
    if (touchesUrl || touchesKey) {
      validateMcpKeyBinding({
        url: touchesUrl ? fields.url : existing?.url,
        apiKeyEnvVar: touchesKey ? fields.apiKeyEnvVar : existing?.apiKeyEnvVar,
      });
    }
    // The tool list is a property of the pair too (#995): a key that needs
    // a list placed on a server without one, or the list removed from a
    // server whose key needs it, is refused either way. A PUT that omits
    // the list keeps the stored one (carryForwardTokens), so the stored
    // half is the right one to check against.
    if (touchesKey || touchesTools) {
      validateMcpToolPolicy({
        apiKeyEnvVar: touchesKey ? fields.apiKeyEnvVar : existing?.apiKeyEnvVar,
        allowedTools: touchesTools ? fields.allowedTools : existing?.allowedTools,
      });
    }
  } catch (error) {
    return error.message;
  }
  return null;
}

/** The write checks for this container: the error sentence, or null. */
const writeError = (container, fields, existing = null) =>
  container === 'mcp_servers' ? mcpWriteError(fields, existing) : null;

/**
 * Whether a write on `mcp_servers` moves where a credential is sent (AP-B1):
 * a new server, a URL change, or a key-name change. Flipping `enabled`,
 * renaming, reordering or storing an OAuth token on an existing server is
 * not that. Writes that are need `super_admin`, the same role that seeds the
 * keys themselves (admin-secrets.js), because routing a stored key is the
 * other half of that decision.
 */
function movesCredentialRouting(container, fields, existing) {
  if (container !== 'mcp_servers') return false;
  if (!existing) return true;
  const changed = (key) =>
    Object.prototype.hasOwnProperty.call(fields, key) &&
    String(fields[key] ?? '').trim() !== String(existing[key] ?? '').trim();
  return changed('url') || changed('apiKeyEnvVar');
}

/**
 * Whether a write on `mcp_servers` changes which tools can be called (#995):
 * any body that names `allowedTools`, or one that names `enabled` on a
 * server whose key requires a tool list. Those need `super_admin` like a
 * routing move. An editor may still switch Firecrawl, Replicate and the
 * keyless servers on and off, as before.
 */
function changesToolReach(container, fields, existing) {
  if (container !== 'mcp_servers') return false;
  const has = (key) => Object.prototype.hasOwnProperty.call(fields, key);
  if (has('allowedTools')) return true;
  const keyName = has('apiKeyEnvVar') ? fields.apiKeyEnvVar : existing?.apiKeyEnvVar;
  return has('enabled') && requiresToolAllowlist(keyName);
}

/** The writes that need `super_admin` on top of `editor`. */
const needsSuperAdmin = (container, fields, existing) =>
  movesCredentialRouting(container, fields, existing) ||
  changesToolReach(container, fields, existing);

/** The `admin_audit_logs.action` every ai_providers / mcp_servers write records. */
export const CONFIG_AUDIT_ACTION = 'ai_config_updated';

/** The audit row for a config write: field names, and the routing values
 * (a URL and a setting NAME, neither a secret) before and after. Best
 * effort, like every audit writer here: the save has landed. */
async function auditConfigWrite(ctx, context, { container, id, user, existing, fields, action }) {
  try {
    const routing = (doc) => ({
      url: doc?.url ?? null,
      apiKeyEnvVar: doc?.apiKeyEnvVar ?? null,
      allowedTools: doc?.allowedTools ?? null,
    });
    await ctx.store.upsertDoc('admin_audit_logs', {
      id: ctx.uuid(),
      action: CONFIG_AUDIT_ACTION,
      userId: user?.oid || user?.sub || null,
      userName: user?.name || null,
      userEmail: user?.email || user?.preferred_username || null,
      timestamp: ctx.now().toISOString(),
      details: {
        collection: container,
        documentId: id,
        operation: action,
        fields: Object.keys(fields || {}).filter(
          (k) => !['oauthToken', 'oauthRefreshToken'].includes(k)
        ),
        before: existing ? routing(existing) : null,
        after: action === 'delete' ? null : routing({ ...existing, ...fields }),
      },
    });
  } catch (auditError) {
    context.warn?.(
      `${action} ${container}/${id} saved but the audit row failed: ${auditError?.message || auditError}`
    );
  }
}

/**
 * putConfig is a full replace, and reads never return `oauthToken`
 * (deliberately — it is write-only). So a read-modify-write round trip
 * from any edit form would silently delete a stored token. Carry it
 * forward unless the caller explicitly supplied a new one; an explicit
 * empty string still clears it, which is how a token is revoked (T-314).
 * Same rule for the refresh token the 12-hour timer rotates with.
 */
function carryForwardTokens(doc, incoming, existing) {
  // `allowedTools` rides along for a different reason (#995): a PUT that
  // omits it must not widen a server back to every tool, so an omitted list
  // keeps the stored one. Only a write that names it, at super_admin,
  // changes it.
  for (const key of ['oauthToken', 'oauthRefreshToken', 'allowedTools']) {
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
function putDocumentOf(container, body, existing = null) {
  const { hasOauthToken: _ignored, hasOauthRefreshToken: _ignored2, ...incoming } = body;
  const problem = writeError(container, incoming, existing);
  return problem ? { error: problem } : { incoming };
}

/** Route id, stored document and checked body of a PUT: `{ id, existing, incoming }` or `{ error }` holding the response. */
async function prepareConfigPut(store, container, request) {
  const id = String(request.params.id || '').trim();
  if (!id) return { error: json(400, { error: 'id required' }) };
  const body = validBody(await request.json().catch(() => null));
  if (!body) return { error: json(400, { error: 'Body must be a JSON object' }) };
  const existing = await store.readDoc(container, id, id);
  const checked = putDocumentOf(container, body, existing);
  return checked.error
    ? { error: json(400, { error: checked.error }) }
    : { id, existing, incoming: checked.incoming };
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
function patchUpdatesOf(container, body, existing = null) {
  const {
    id: _ignored,
    hasOauthToken: _readArtefact,
    hasOauthRefreshToken: _readArtefact2,
    ...updates
  } = body;
  if (Object.keys(updates).length === 0) {
    return { error: 'Body must contain at least one updatable field' };
  }
  const problem = writeError(container, updates, existing);
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
  const checked = patchUpdatesOf(container, body, existing);
  return checked.error
    ? { error: json(400, { error: checked.error }) }
    : { id, existing, updates: checked.updates };
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
    const prepared = await prepareConfigPut(ctx.store, container, request);
    if (prepared.error) return prepared.error;
    const { id, existing, incoming } = prepared;

    if (needsSuperAdmin(container, incoming, existing)) {
      const elevated = await ctx.guard.requireRole(request, 'super_admin');
      if (elevated.error) return elevated.error;
    }

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
    await auditConfigWrite(ctx, context, {
      container,
      id,
      user: auth.user,
      existing,
      fields: incoming,
      action: 'put',
    });
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
    if (needsSuperAdmin(container, prepared.updates, prepared.existing)) {
      const elevated = await ctx.guard.requireRole(request, 'super_admin');
      if (elevated.error) return elevated.error;
    }
    const updated = await ctx.store.patchDoc(container, prepared.id, {
      ...prepared.updates,
      updatedAt: ctx.now().toISOString(),
    });
    if (container === 'ai_providers') ctx.aiConfigChanged();
    await auditConfigWrite(ctx, context, {
      container,
      id: prepared.id,
      user: auth.user,
      existing: prepared.existing,
      fields: prepared.updates,
      action: 'patch',
    });
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
    const existing = await ctx.store.readDoc(container, id, id).catch(() => null);
    await ctx.store.deleteDoc(container, id);
    if (container === 'ai_providers') ctx.aiConfigChanged();
    await auditConfigWrite(ctx, context, {
      container,
      id,
      user: auth.user,
      existing,
      fields: {},
      action: 'delete',
    });
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
