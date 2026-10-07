/**
 * The notifier's cooldown is claimed before the send, conditionally on the
 * document's ETag, so two callers racing on one source produce one message
 * and no source's stamp is ever overwritten by another's (review of #920).
 * Telegram's status travels in the result for the Test Telegram route.
 */
import { describe, it, expect, vi } from 'vitest';
import { COOLDOWN_MS, NOTIFY_STATE_ID, createNotifier } from './notify.js';

const NOW = new Date('2026-10-07T01:30:00.000Z');
const now = () => NOW;
const env = { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '1' };

/** A store over one `system` document, with ETags and a 412 on a stale claim. */
function stateStore(doc) {
  let current = doc ? { _etag: '"e1"', ...doc } : null;
  let version = 1;
  const store = {
    readDoc: vi.fn(async () => current),
    upsertDoc: vi.fn(async (_c, d) => {
      version += 1;
      current = { ...d, _etag: `"e${version}"` };
      return current;
    }),
    patchDoc: vi.fn(async (_c, _id, updates, options = {}) => {
      if (options.ifMatch && current && options.ifMatch !== current._etag) {
        throw Object.assign(new Error('412'), { code: 412 });
      }
      version += 1;
      current = { ...(current || { id: NOTIFY_STATE_ID }), ...updates, _etag: `"e${version}"` };
      for (const [k, v] of Object.entries(updates)) if (v === undefined) delete current[k];
      return current;
    }),
    get current() {
      return current;
    },
  };
  return store;
}

const ok = () => vi.fn(async () => ({ ok: true }));

describe('claiming the cooldown', () => {
  it('claims with the ETag it read before sending, and the stamp is the claim', async () => {
    const store = stateStore({ id: NOTIFY_STATE_ID });
    const fetch = ok();
    const result = await createNotifier({ store, env, fetch, now }).notifyTelegram({ title: 't', message: 'm', source: 'checkLiveLinks' });
    expect(result).toEqual({ sent: true });
    expect(store.patchDoc).toHaveBeenCalledTimes(1);
    const [container, id, updates, options] = store.patchDoc.mock.calls[0];
    expect([container, id]).toEqual(['system', NOTIFY_STATE_ID]);
    expect(updates).toEqual({ checkLiveLinks: { lastNotifiedAt: NOW.toISOString() } });
    expect(options).toEqual({ partitionKey: NOTIFY_STATE_ID, ifMatch: '"e1"' });
    // The claim comes first: fetch runs after the patch.
    expect(store.patchDoc.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
    // Nothing writes the whole document any more.
    expect(store.upsertDoc).not.toHaveBeenCalled();
  });

  it('is told cooldown, and sends nothing, when another writer claimed first (412)', async () => {
    const store = stateStore({ id: NOTIFY_STATE_ID });
    const fetch = ok();
    const n = createNotifier({ store, env, fetch, now });
    // Someone else wrote the document between our read and our claim.
    store.readDoc.mockImplementationOnce(async () => ({ id: NOTIFY_STATE_ID, _etag: '"stale"' }));
    expect(await n.notifyTelegram({ title: 't', message: 'm', source: 'a' })).toEqual({ sent: false, reason: 'cooldown' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honours an existing stamp inside the window without touching the store', async () => {
    const store = stateStore({
      id: NOTIFY_STATE_ID,
      a: { lastNotifiedAt: new Date(NOW.getTime() - COOLDOWN_MS + 1000).toISOString() },
    });
    const fetch = ok();
    expect(await createNotifier({ store, env, fetch, now }).notifyTelegram({ title: 't', message: 'm', source: 'a' })).toEqual({
      sent: false,
      reason: 'cooldown',
    });
    expect(store.patchDoc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("touches only its own source's field, so a concurrent source's stamp survives", async () => {
    const store = stateStore({ id: NOTIFY_STATE_ID, other: { lastNotifiedAt: '2026-10-07T01:00:00.000Z' } });
    await createNotifier({ store, env, fetch: ok(), now }).notifyTelegram({ title: 't', message: 'm', source: 'mine' });
    expect(store.current.other).toEqual({ lastNotifiedAt: '2026-10-07T01:00:00.000Z' });
    expect(store.current.mine).toEqual({ lastNotifiedAt: NOW.toISOString() });
  });

  it('creates the document on first use and then claims against its ETag', async () => {
    const store = stateStore(null);
    const result = await createNotifier({ store, env, fetch: ok(), now }).notifyTelegram({ title: 't', message: 'm', source: 'a' });
    expect(result).toEqual({ sent: true });
    expect(store.upsertDoc).toHaveBeenCalledWith('system', { id: NOTIFY_STATE_ID });
    expect(store.patchDoc.mock.calls[0][3].ifMatch).toBe('"e2"');
  });
});

describe('when Telegram does not take it', () => {
  it('returns the status and puts the previous stamp back, so a refusal does not silence the source', async () => {
    const before = { lastNotifiedAt: '2026-10-06T20:00:00.000Z' };
    const store = stateStore({ id: NOTIFY_STATE_ID, a: before });
    const fetch = vi.fn(async () => ({ ok: false, status: 403 }));
    const log = { error: vi.fn(), log: vi.fn(), warn: vi.fn() };
    const result = await createNotifier({ store, env, fetch, now, log }).notifyTelegram({ title: 't', message: 'm', source: 'a' });
    expect(result).toEqual({ sent: false, reason: 'telegram_error', status: 403 });
    expect(store.patchDoc).toHaveBeenCalledTimes(2);
    expect(store.patchDoc.mock.calls[1][2]).toEqual({ a: before });
    expect(store.current.a).toEqual(before);
    expect(log.error.mock.calls[0][0]).toBe('[notify] Telegram API error 403');
  });

  it('removes the stamp again when the source had never been said and the send threw', async () => {
    const store = stateStore({ id: NOTIFY_STATE_ID });
    const fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await createNotifier({ store, env, fetch, now, log: {} }).notifyTelegram({ title: 't', message: 'm', source: 'a' });
    expect(result).toEqual({ sent: false, reason: 'exception' });
    expect(store.patchDoc.mock.calls[1][2]).toEqual({ a: undefined });
    expect(store.current).not.toHaveProperty('a');
  });

  it('stays quiet when unconfigured, before any store call', async () => {
    const store = stateStore({ id: NOTIFY_STATE_ID });
    expect(await createNotifier({ store, env: {}, fetch: ok(), now }).notifyTelegram({ title: 't', message: 'm' })).toEqual({
      sent: false,
      reason: 'not_configured',
    });
    expect(store.readDoc).not.toHaveBeenCalled();
  });

  it('logs the source prefix only, never a dynamic suffix', async () => {
    const store = stateStore({
      id: NOTIFY_STATE_ID,
      'reminder:secret-id': { lastNotifiedAt: NOW.toISOString() },
    });
    const log = { log: vi.fn() };
    await createNotifier({ store, env, fetch: ok(), now, log }).notifyTelegram({ title: 't', message: 'm', source: 'reminder:secret-id' });
    expect(log.log.mock.calls[0][0]).toContain('source="reminder"');
    expect(log.log.mock.calls[0][0]).not.toContain('secret-id');
  });
});
