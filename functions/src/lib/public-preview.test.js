import { describe, it, expect, vi } from 'vitest';
import {
  PREVIEW_TTL_MS,
  PREVIEWABLE_STATUSES,
  signPreviewToken,
  buildPreviewToken,
  verifyPreviewToken,
  createPublicPreviewHandlers,
} from './public-preview.js';

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000;

function makeRequest(contentId, token) {
  const query = new Map();
  if (token !== undefined) query.set('t', token);
  return { params: contentId !== undefined ? { contentId } : {}, query };
}

function makeHandlers(doc, { env, now = () => NOW } = {}) {
  const store = { readDoc: vi.fn(async () => doc) };
  const handlers = createPublicPreviewHandlers({
    store,
    env: env ?? { PREVIEW_SIGNING_SECRET: SECRET },
    now,
  });
  return { handlers, store };
}

describe('preview tokens', () => {
  it('round-trips: a freshly built token verifies for its contentId', () => {
    const token = buildPreviewToken(SECRET, 'doc-1', { now: () => NOW });
    expect(verifyPreviewToken(SECRET, 'doc-1', token, NOW)).toBe(true);
    // ... right up to (not including) the signed expiry
    expect(verifyPreviewToken(SECRET, 'doc-1', token, NOW + PREVIEW_TTL_MS - 1)).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = buildPreviewToken(SECRET, 'doc-1', { now: () => NOW });
    expect(verifyPreviewToken(SECRET, 'doc-1', token, NOW + PREVIEW_TTL_MS)).toBe(false);
  });

  it('rejects a token for a different contentId', () => {
    const token = buildPreviewToken(SECRET, 'doc-1', { now: () => NOW });
    expect(verifyPreviewToken(SECRET, 'doc-2', token, NOW)).toBe(false);
  });

  it('rejects a tampered expiry — the signature covers it', () => {
    const token = buildPreviewToken(SECRET, 'doc-1', { now: () => NOW });
    const [, sig] = token.split('.');
    const extended = `${NOW + 10 * PREVIEW_TTL_MS}.${sig}`;
    expect(verifyPreviewToken(SECRET, 'doc-1', extended, NOW)).toBe(false);
  });

  it('rejects a tampered signature, garbage, and empty inputs', () => {
    const expMs = NOW + PREVIEW_TTL_MS;
    const token = signPreviewToken(SECRET, 'doc-1', expMs);
    const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyPreviewToken(SECRET, 'doc-1', flipped, NOW)).toBe(false);
    expect(verifyPreviewToken(SECRET, 'doc-1', 'not-a-token', NOW)).toBe(false);
    expect(verifyPreviewToken(SECRET, 'doc-1', '', NOW)).toBe(false);
    expect(verifyPreviewToken(SECRET, 'doc-1', undefined, NOW)).toBe(false);
    expect(verifyPreviewToken('', 'doc-1', token, NOW)).toBe(false);
    expect(verifyPreviewToken(SECRET, '', token, NOW)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = buildPreviewToken('other-secret', 'doc-1', { now: () => NOW });
    expect(verifyPreviewToken(SECRET, 'doc-1', token, NOW)).toBe(false);
  });
});

describe('getPreview', () => {
  const validToken = (id) => buildPreviewToken(SECRET, id, { now: () => NOW });

  it('serves each previewable status with no-store and stripped internals', async () => {
    for (const contentStatus of PREVIEWABLE_STATUSES) {
      const { handlers } = makeHandlers({
        id: 'doc-1',
        contentStatus,
        Title: 'T',
        forgeGrade: { overall: 8.1 },
        forgeMeta: { promptVersion: 3 },
        _etag: 'x',
      });
      const res = await handlers.getPreview(makeRequest('doc-1', validToken('doc-1')));
      expect(res.status).toBe(200);
      expect(res.headers['Cache-Control']).toBe('no-store');
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.item.Title).toBe('T');
      // The preview banner needs the grade; internal fields stay internal.
      expect(body.item.forgeGrade).toEqual({ overall: 8.1 });
      expect(body.item.forgeMeta).toBeUndefined();
      expect(body.item._etag).toBeUndefined();
    }
  });

  it('normalizes retired statuses before gating (approved_news serves; published_news does not)', async () => {
    const approved = makeHandlers({ id: 'doc-1', contentStatus: 'approved_news' });
    expect((await approved.handlers.getPreview(makeRequest('doc-1', validToken('doc-1')))).status).toBe(200);
    const published = makeHandlers({ id: 'doc-1', contentStatus: 'published_news' });
    expect((await published.handlers.getPreview(makeRequest('doc-1', validToken('doc-1')))).status).toBe(404);
  });

  it('every refusal is the byte-identical 404', async () => {
    const doc = { id: 'doc-1', contentStatus: 'forge_ready' };
    const cases = [
      // bad token
      makeHandlers(doc).handlers.getPreview(makeRequest('doc-1', 'garbage')),
      // missing token
      makeHandlers(doc).handlers.getPreview(makeRequest('doc-1')),
      // expired token
      makeHandlers(doc, { now: () => NOW + 2 * PREVIEW_TTL_MS }).handlers.getPreview(
        makeRequest('doc-1', validToken('doc-1'))
      ),
      // unconfigured secret (unresolved Key Vault reference)
      makeHandlers(doc, {
        env: { PREVIEW_SIGNING_SECRET: '@Microsoft.KeyVault(SecretUri=x)' },
      }).handlers.getPreview(makeRequest('doc-1', validToken('doc-1'))),
      // missing document
      makeHandlers(null).handlers.getPreview(makeRequest('doc-1', validToken('doc-1'))),
      // soft-deleted document
      makeHandlers({ ...doc, softDeletedAt: '2026-01-01' }).handlers.getPreview(
        makeRequest('doc-1', validToken('doc-1'))
      ),
      // non-previewable statuses
      makeHandlers({ id: 'doc-1', contentStatus: 'published' }).handlers.getPreview(
        makeRequest('doc-1', validToken('doc-1'))
      ),
      makeHandlers({ id: 'doc-1', contentStatus: 'draft' }).handlers.getPreview(
        makeRequest('doc-1', validToken('doc-1'))
      ),
      // bare invocation (route-inventory calls handlers with empty params/query)
      makeHandlers(doc).handlers.getPreview({ params: {}, query: new Map() }),
    ];
    const results = await Promise.all(cases);
    const reference = JSON.stringify({
      status: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    });
    for (const res of results) {
      expect(JSON.stringify(res)).toBe(reference);
    }
  });

  it('does not touch the store when the token fails — no existence probing', async () => {
    const { handlers, store } = makeHandlers({ id: 'doc-1', contentStatus: 'forge_ready' });
    await handlers.getPreview(makeRequest('doc-1', 'garbage'));
    expect(store.readDoc).not.toHaveBeenCalled();
  });
});
