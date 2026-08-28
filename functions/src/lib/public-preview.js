/**
 * public-preview.js — the signed staging-preview read (T-606).
 *
 * `GET /api/public/preview/{contentId}?t={token}` serves a not-yet-published
 * content document to whoever holds a valid preview link — the Telegram
 * approval loop's "staging URL". The route is anonymous, so the token is the
 * entire access control:
 *
 *   token  = `${expMs}.${HMAC-SHA256(PREVIEW_SIGNING_SECRET, `${contentId}.${expMs}`)}`
 *   expiry = 72 hours from signing (the signer chooses; the verifier only
 *            trusts the signed expiry, never a client-supplied one)
 *
 * Design rules, mirroring lib/public-reads.js:
 *   1. Every failure answers the identical 404 — missing/invalid/expired
 *      token, unconfigured secret, missing document, wrong status. A caller
 *      must not be able to distinguish "no such document" from "bad token",
 *      or the route becomes an existence oracle for unpublished drafts.
 *   2. Only documents in {forge_ready, editing, approved} are served. A
 *      published document already has a public URL; everything else is not
 *      for eyes outside the admin portal.
 *   3. No guard modules — the token check IS the authorization
 *      (route-inventory.test.js asserts public routes never consult
 *      requireRole/requireUser).
 *
 * This lives outside lib/public-reads.js deliberately: that module keeps a
 * zero-imports invariant (see its header) and this one needs node:crypto.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readKey } from './ai/router.js';
import { stripInternalFields, isSoftDeleted } from './public-reads.js';
import { normalizeCurrentStatusForBlogOnly } from './cms/content-update-validation.js';

export const PREVIEW_TTL_MS = 72 * 60 * 60 * 1000;

/** Statuses a preview link may show. Keep in lockstep with the wiki Phase 5 spec. */
export const PREVIEWABLE_STATUSES = new Set(['forge_ready', 'editing', 'approved']);

/** Token for a caller-chosen expiry. Exposed for verification; prefer buildPreviewToken. */
export function signPreviewToken(secret, contentId, expMs) {
  const signature = createHmac('sha256', secret)
    .update(`${contentId}.${expMs}`)
    .digest('hex');
  return `${expMs}.${signature}`;
}

/** The token the notifier embeds in a staging link: 72 h from now. */
export function buildPreviewToken(secret, contentId, { now = Date.now, ttlMs = PREVIEW_TTL_MS } = {}) {
  return signPreviewToken(secret, contentId, now() + ttlMs);
}

/**
 * True only for an unexpired token whose signature covers this exact
 * contentId and the expiry it carries. Constant-time compare after a length
 * check (the bot.js secretMatches precedent — length is not secret, the
 * digest is always 64 hex chars).
 */
export function verifyPreviewToken(secret, contentId, token, nowMs) {
  if (!secret || !contentId || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expMs = Number(token.slice(0, dot));
  if (!Number.isFinite(expMs) || expMs <= nowMs) return false;
  const expected = signPreviewToken(secret, contentId, expMs);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// One shape for every refusal — see design rule 1 in the header.
function notFound() {
  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Not found' }),
  };
}

export function createPublicPreviewHandlers({ store, env = process.env, now = Date.now }) {
  /**
   * GET public/preview/{contentId}?t={token}
   * Success: { success: true, item } with Cache-Control: no-store — a preview
   * must always show the live draft, and the link is semi-secret; nothing
   * should cache it.
   */
  async function getPreview(request) {
    const contentId = String(request?.params?.contentId || '').trim();
    const token = String(request?.query?.get?.('t') || '').trim();
    const secret = readKey(env, 'PREVIEW_SIGNING_SECRET');

    if (!verifyPreviewToken(secret, contentId, token, now())) return notFound();

    const doc = await store.readDoc('content', contentId, contentId);
    if (!doc || isSoftDeleted(doc)) return notFound();
    if (!PREVIEWABLE_STATUSES.has(normalizeCurrentStatusForBlogOnly(doc.contentStatus))) {
      return notFound();
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: true, item: stripInternalFields(doc) }),
    };
  }

  return { getPreview };
}
