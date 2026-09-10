/**
 * connection-probe.test.js — the closed probe table, and the credential that
 * must not escape it (#483).
 *
 * The interesting assertions here are the negative ones. Two of the three
 * probes authenticate in the URL, so "the response did not contain the token"
 * is a security property, not a nicety, and it is asserted on every path that
 * can produce a string: a rejection, an unparseable body and a transport
 * failure.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PROBES,
  PROBE_NAMES,
  assertUrlSafe,
  createConnectionProbe,
  redactSecrets,
} from './connection-probe.js';

const TOKEN = '123456789:AAHreallylongtelegramtokenvalue';
const YT_KEY = 'AIzaSyDreallylongyoutubeapikeyvalue';
const RSS_KEY = 'rsscom-really-long-api-key-value';

const ENV = {
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_CHAT_ID: '-1001234567890',
  RSSCOM_API_KEY: RSS_KEY,
  RSSCOM_PODCAST_ID: '4242',
  YOUTUBE_API_KEY: YT_KEY,
};

const readKey = (env, name) => (typeof env?.[name] === 'string' ? env[name].trim() : '');

const allow = { requireRole: vi.fn(async () => ({ user: { role: 'editor' } })) };
const ctx = () => ({ error: vi.fn(), warn: vi.fn(), log: vi.fn() });

const req = (body) => ({ json: async () => body });

/** The parsed body of whatever the handler returned. */
const bodyOf = (res) => JSON.parse(res.body);

function respond({ ok = true, status = 200, text = '{}' }) {
  return vi.fn(async () => ({ ok, status, text: async () => text }));
}

describe('redactSecrets', () => {
  it('blanks a credential wherever it appears', () => {
    expect(redactSecrets(`GET /bot${TOKEN}/getMe failed`, [TOKEN])).toBe('GET /bot***/getMe failed');
  });

  it('leaves a short value alone rather than corrupting the sentence', () => {
    // Blanking every occurrence of "ab" would turn unrelated prose to noise,
    // and no real credential is two characters.
    expect(redactSecrets('a fabulous cabbage', ['ab'])).toBe('a fabulous cabbage');
  });

  it('survives a non-string and an absent secret', () => {
    expect(redactSecrets(undefined, [undefined, null, 12])).toBe('');
  });

  it('blanks the percent-encoded form too', () => {
    // A credential that travels in a URL is encoded on the way out, so an
    // upstream quoting its request target back shows `%3A` where the raw
    // value has a colon. Redacting only the raw string sails past it, which
    // is the leak this case exists to pin.
    const encoded = encodeURIComponent(TOKEN);
    expect(encoded).not.toBe(TOKEN);
    expect(redactSecrets(`target: /bot${encoded}/getMe`, [TOKEN])).toBe('target: /bot***/getMe');
  });
});

describe('assertUrlSafe', () => {
  it('passes a real bot token, colon and all', () => {
    // The colon MUST survive: Telegram's path is `/bot<digits>:<rest>/getMe`
    // and percent-encoding it would rely on the far end decoding before it
    // routes. A 404 from that would read as "your token is bad", which is a
    // wrong answer to the only question this button asks.
    expect(assertUrlSafe(TOKEN)).toBe(TOKEN);
  });

  it('refuses a value that could reshape the request target', () => {
    for (const bad of [`${TOKEN}
`, `${TOKEN}/x`, `${TOKEN}?a=1`, `${TOKEN}#f`, `${TOKEN} `]) {
      expect(() => assertUrlSafe(bad)).toThrow(/cannot appear in a URL/);
    }
  });
});

describe('the probe table', () => {
  it('is closed, and every entry is a GET with no caller-supplied component', () => {
    expect(PROBE_NAMES).toEqual(['telegram', 'rsscom', 'youtube']);
    for (const name of PROBE_NAMES) {
      const probe = PROBES[name];
      const { url, headers } = probe.buildRequest({ values: ENV });
      expect(url, `${name} must be https`).toMatch(/^https:\/\//);
      expect(headers).toBeTypeOf('object');
      // No `method` field anywhere: a probe that is not a GET is not a probe.
      expect(probe).not.toHaveProperty('method');
    }
  });

  it('reports a key verdict for Telegram alone', () => {
    // RSS.com's 401/403 split is unmeasured and YouTube answers 403 for an
    // exceeded quota as well as a bad key. Wiring either would turn a light
    // red for a reason that is not the key, which is #358.
    expect(PROBES.telegram.reportsKeyVerdict).toBe(true);
    expect(PROBES.rsscom.reportsKeyVerdict).toBe(false);
    expect(PROBES.youtube.reportsKeyVerdict).toBe(false);
  });

  it('judges Telegram on the token alone, never the chat id', () => {
    // getMe does not read the chat id, so a success must not turn its light
    // green and a 401 must not turn it red.
    expect(PROBES.telegram.settings).toEqual(['TELEGRAM_BOT_TOKEN']);
  });

  it('asks RSS.com for the call that needs only the key', () => {
    // `GET /v4/podcasts` is how RSSCOM_PODCAST_ID is discovered, so gating the
    // probe on the id would make it useless before the id is seeded.
    expect(PROBES.rsscom.settings).toEqual(['RSSCOM_API_KEY']);
    const { url, headers } = PROBES.rsscom.buildRequest({ values: ENV });
    expect(url).toBe('https://api.rss.com/v4/podcasts');
    expect(headers['X-Api-Key']).toBe(RSS_KEY);
  });

  it('keeps the YouTube probe to one result, because search.list costs ~100 units', () => {
    const { url } = PROBES.youtube.buildRequest({ values: ENV });
    expect(new URL(url).searchParams.get('maxResults')).toBe('1');
  });
});

describe('createConnectionProbe', () => {
  const build = (over = {}) =>
    createConnectionProbe({
      guard: allow,
      env: ENV,
      readKey,
      fetch: respond({ text: '{"ok":true,"result":{"username":"hcw_bot"}}' }),
      ...over,
    });

  it('refuses a name outside the table before reading anything', async () => {
    const fetchImpl = vi.fn();
    const res = await build({ fetch: fetchImpl })(req({ probe: 'evil' }), ctx());
    expect(res.status).toBe(400);
    expect(bodyOf(res).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an inherited property name', async () => {
    // `PROBES[requested]` would resolve `constructor` to something that is not
    // a probe; `Object.hasOwn` is why it does not.
    const fetchImpl = vi.fn();
    for (const name of ['constructor', '__proto__', 'toString']) {
      const res = await build({ fetch: fetchImpl })(req({ probe: name }), ctx());
      expect(res.status, name).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses before the call when the credential is not seeded', async () => {
    const fetchImpl = vi.fn();
    const handler = createConnectionProbe({
      guard: allow,
      env: { ...ENV, TELEGRAM_BOT_TOKEN: '' },
      readKey,
      fetch: fetchImpl,
    });
    const res = await handler(req({ probe: 'telegram' }), ctx());
    // 200, not 5xx: an unseeded key is a configuration state the page renders
    // as not-connected, not a fault.
    expect(res.status).toBe(200);
    expect(bodyOf(res)).toMatchObject({
      ok: false,
      code: 'INTEGRATION_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a token that cannot go in a URL, naming the setting not the value', async () => {
    // A trailing newline on a pasted secret is the common version of this.
    // Without the guard the URL silently changes shape and Telegram answers
    // 404, which the page would report as a bad token.
    const fetchImpl = vi.fn();
    const handler = createConnectionProbe({
      guard: allow,
      env: { ...ENV, TELEGRAM_BOT_TOKEN: `${TOKEN}/evil.test` },
      readKey: (env, name) => env?.[name] ?? '',
      fetch: fetchImpl,
    });
    const res = await handler(req({ probe: 'telegram' }), ctx());
    const parsed = bodyOf(res);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('TELEGRAM_BOT_TOKEN');
    expect(res.body).not.toContain(TOKEN);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the guard verdict through when the caller is not an editor', async () => {
    const denied = { error: { status: 403 } };
    const handler = createConnectionProbe({
      guard: { requireRole: vi.fn(async () => denied) },
      env: ENV,
      readKey,
      fetch: vi.fn(),
    });
    expect(await handler(req({ probe: 'telegram' }), ctx())).toBe(denied.error);
  });

  it('answers ok with the upstream body on success', async () => {
    const res = await build()(req({ probe: 'telegram' }), ctx());
    expect(bodyOf(res)).toMatchObject({
      ok: true,
      status: 200,
      data: { ok: true, result: { username: 'hcw_bot' } },
    });
  });

  it("carries the upstream's own sentence on a failure", async () => {
    // Telegram says `description`, which is why upstream-error.js learned that
    // field. A bare "HTTP 401" here would lose the point of the exercise.
    const res = await build({
      fetch: respond({
        ok: false,
        status: 401,
        text: '{"ok":false,"error_code":401,"description":"Unauthorized"}',
      }),
    })(req({ probe: 'telegram' }), ctx());
    expect(bodyOf(res)).toMatchObject({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('records a Telegram rejection against the bot token', async () => {
    const onKeyVerdict = vi.fn(async () => {});
    await build({
      onKeyVerdict,
      fetch: respond({ ok: false, status: 401, text: '{"description":"Unauthorized"}' }),
    })(req({ probe: 'telegram' }), ctx());
    expect(onKeyVerdict).toHaveBeenCalledWith(
      'TELEGRAM_BOT_TOKEN',
      expect.objectContaining({ ok: false, status: 401, detail: 'Unauthorized' })
    );
  });

  it('does not record a verdict for RSS.com or YouTube', async () => {
    for (const probe of ['rsscom', 'youtube']) {
      const onKeyVerdict = vi.fn(async () => {});
      await build({
        onKeyVerdict,
        fetch: respond({ ok: false, status: 403, text: '{"message":"quotaExceeded"}' }),
      })(req({ probe }), ctx());
      expect(onKeyVerdict, probe).not.toHaveBeenCalled();
    }
  });

  it('does not turn a light red for a 404 or a 500', async () => {
    for (const status of [404, 429, 500]) {
      const onKeyVerdict = vi.fn(async () => {});
      await build({
        onKeyVerdict,
        fetch: respond({ ok: false, status, text: '{"description":"nope"}' }),
      })(req({ probe: 'telegram' }), ctx());
      expect(onKeyVerdict, String(status)).not.toHaveBeenCalled();
    }
  });

  it('never returns the credential, on any failure path', async () => {
    const cases = [
      // A provider that echoes the request line back in its error body.
      {
        probe: 'telegram',
        secret: TOKEN,
        fetch: respond({
          ok: false,
          status: 401,
          text: `{"description":"bad request to /bot${TOKEN}/getMe"}`,
        }),
      },
      // A body that is not JSON at all, parked in `raw`.
      {
        probe: 'youtube',
        secret: YT_KEY,
        fetch: respond({
          ok: false,
          status: 400,
          text: `<html>API key ${YT_KEY} not valid</html>`,
        }),
      },
      // A transport error whose message quotes the target.
      {
        probe: 'youtube',
        secret: YT_KEY,
        fetch: vi.fn(async () => {
          throw new Error(`connect ECONNREFUSED for ?key=${YT_KEY}`);
        }),
      },
    ];
    for (const { probe, secret, fetch: fetchImpl } of cases) {
      const context = ctx();
      const res = await build({ fetch: fetchImpl })(req({ probe }), context);
      expect(res.body, `${probe} leaked its credential`).not.toContain(secret);
      const logged = context.error.mock.calls.flat().join(' ');
      expect(logged, `${probe} logged its credential`).not.toContain(secret);
    }
  });

  it('reports an unreachable upstream without inventing a status', async () => {
    const res = await build({
      fetch: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    })(req({ probe: 'rsscom' }), ctx());
    const parsed = bodyOf(res);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBeUndefined();
    expect(parsed.error).toContain('RSS.com could not be reached');
  });
});
