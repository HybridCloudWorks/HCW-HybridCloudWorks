/**
 * connection-probe.js — "does this credential work?" for the three services a
 * browser cannot ask (#483).
 *
 * Telegram, RSS.com and YouTube hold credentials that are only ever read on the
 * server, so the Integrations page had no beaker for them: testing from the
 * browser would mean sending a Key Vault secret to a browser, which that page
 * will not do. #481 made their globes point at the page where each credential
 * is minted, which is the best a card with no test can do. This module is the
 * test, so the globe stops being the only answer.
 *
 * ## Why this is not another rest-proxy integration
 *
 * `rest-proxy.js` takes `{ path, method, body }` from the caller. It spends a
 * long header explaining why that is a confused deputy — whoever controls the
 * path controls where the credential goes — and `assertSafePath` is the
 * boundary that makes it safe. It is a real boundary and it holds, but it is a
 * DENYLIST: it enumerates the shapes that could redirect a credential and
 * refuses those.
 *
 * Nothing here needs that latitude. The page asks one question, "is this
 * credential live", and there is exactly one call per service that answers it.
 * So the caller sends a NAME — `{ probe: 'telegram' }` — and the URL, method
 * and headers are built here from a frozen table. There is no caller-supplied
 * component in the outbound request at all, which is a stronger property than
 * any validator can give: not "the path was checked", but "the caller never
 * supplied one".
 *
 * ## Two of these put the credential in the URL
 *
 * Telegram authenticates in the PATH (`/bot<token>/getMe`) and YouTube in the
 * QUERY (`?key=<key>`). Only RSS.com uses a header. That makes the usual habit
 * of quoting a failed URL back into an error message a credential leak, and it
 * is the kind that ends up in a screenshot on the Integrations page or in
 * Application Insights forever.
 *
 * So: the built URL is never returned and never logged, and the upstream's
 * response is passed through `redactSecrets` BEFORE it is parsed — one choke
 * point, so every string derived from it downstream is already safe. That is
 * belt and braces on top of not interpolating the URL, because the interesting
 * leak is the one nobody wrote on purpose: an undici transport error whose
 * `cause` quotes the request target, or a provider that echoes the request
 * line back in its own error body. The second of those is not hypothetical —
 * the first draft redacted the error string and the log and passed the parsed
 * body through untouched, and its own test caught the token sitting in it.
 *
 * ## What reports a key verdict, and what deliberately does not
 *
 * Only Telegram. It answers 401 for a bad token, its `getMe` call takes no
 * other credential, and so a rejection blames exactly one setting.
 *
 * RSS.com and YouTube stay silent, and that is a decision rather than an
 * omission. #358 cost two days because a verdict was split across two settings
 * on Publer's DOCUMENTED semantics, which turned out to be the reverse of its
 * measured ones. RSS.com's 401/403 split has not been measured here. YouTube is
 * worse: the Data API answers 403 for a disabled API, for an exceeded quota and
 * for a referrer-restricted key, and only some of those mean "the key is
 * wrong". A light that goes red on a quota day would send the owner to remint a
 * key that is fine, which is the exact failure #358 was. Measure first, then
 * wire it; until then the beaker still reports the failure to the operator who
 * pressed it, which is the point of the button.
 */
import { createKeyVerdictReporter, isCredentialRejected } from '../key-verdict.js';
import { readUpstreamError } from './upstream-error.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Long enough for any upstream sentence, short enough for a toast. */
const MAX_ERROR_LENGTH = 300;

/**
 * A probe should answer in seconds or be reported as unreachable. Without a
 * deadline a hung upstream holds the request until the host's own timeout,
 * and the operator sees a spinner with no verdict.
 */
export const PROBE_TIMEOUT_MS = 10_000;

/**
 * Remove credential values from a string that is about to be shown or logged.
 *
 * Applied to every outbound string, not only the ones known to be risky. Two
 * of the three probes carry their credential in the URL, and the messages that
 * leak it are the ones nobody wrote deliberately — a transport error quoting
 * its request target, a proxy echoing the line it could not parse.
 *
 * Short values are left alone. A one or two character "secret" is not one, and
 * blanking every occurrence of it would corrupt unrelated text into nonsense;
 * an unseeded probe never reaches here anyway, because a missing key is
 * refused before the call is built.
 *
 * @param {string} text
 * @param {Array<string|undefined>} secrets
 * @returns {string}
 */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 8) continue;
    // Both the raw value and its percent-encoded form. A credential that
    // travels in a URL is encoded on the way out, so an upstream echoing its
    // request target back quotes the ENCODED bytes — and redacting only the
    // raw string would sail straight past it. A Telegram token's colon
    // becomes `%3A`, which is exactly enough difference to miss.
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(form).join('***');
    }
  }
  return out;
}

/** Thrown when a credential could not be put in a URL without reshaping it. */
export class UnusableCredentialError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnusableCredentialError';
  }
}

/**
 * A credential that is about to become part of a URL path, unencoded.
 *
 * Telegram's token sits in the path and must keep its literal colon (see the
 * probe below), so it cannot be run through `encodeURIComponent`. This is the
 * other half of that trade: anything that could END the path segment or start
 * a query, a fragment or a new authority is refused outright.
 *
 * The value comes from Key Vault, not from the caller, so this is not a
 * defence against an attacker choosing it — it is a defence against a
 * mis-pasted secret quietly changing which URL gets called and turning the
 * result into a confusing 404. Whitespace is included because a trailing
 * newline in a pasted value is the single most common version of that.
 *
 * @throws {UnusableCredentialError}
 */
export function assertUrlSafe(value) {
  if (/[\s/?#\\]/.test(value)) {
    throw new UnusableCredentialError('the value contains characters that cannot appear in a URL');
  }
  return value;
}

/**
 * One probe: the single read-only call that proves one service's credential.
 *
 * `buildRequest` returns the whole outbound request. It receives the resolved
 * credentials and returns `{ url, headers }`; there is no `method` because
 * every probe is a GET, and making that a field would invite a probe that is
 * not.
 *
 * `settings` is every app setting the probe needs, in the order the operator
 * should read them. The first is the one a rejection blames when
 * `reportsKeyVerdict` is on.
 */
export function createProbe({
  name,
  service,
  settings,
  buildRequest,
  reportsKeyVerdict = false,
}) {
  return Object.freeze({ name, service, settings, buildRequest, reportsKeyVerdict });
}

/**
 * The closed set. A name not in this table is refused before anything is read
 * from the environment, so an unknown probe cannot even confirm which settings
 * exist.
 */
export const PROBES = Object.freeze({
  /**
   * `GET /bot<token>/getMe` — Telegram's own "is this token live" call. It
   * takes no chat id, which is why only the token is judged: a success here
   * says nothing about whether `TELEGRAM_CHAT_ID` names a real conversation,
   * and reporting one would put a green light on a value nothing tested.
   */
  telegram: createProbe({
    name: 'telegram',
    service: 'Telegram',
    settings: ['TELEGRAM_BOT_TOKEN'],
    buildRequest: ({ values }) => ({
      // The token is the path. Never quote this URL anywhere.
      //
      // NOT percent-encoded, deliberately. A bot token is `<digits>:<rest>`
      // and `encodeURIComponent` turns that colon into `%3A`, which Telegram
      // would have to decode before routing. If it ever did not, the probe
      // would answer 404 and the page would tell the owner their token is
      // bad — a wrong diagnosis about the one thing this button exists to
      // diagnose. `assertUrlSafe` below is what makes the unencoded form
      // safe: a value that could alter the request target is refused with a
      // sentence naming the setting, rather than silently reshaping the URL.
      url: `https://api.telegram.org/bot${assertUrlSafe(values.TELEGRAM_BOT_TOKEN)}/getMe`,
      headers: { Accept: 'application/json' },
    }),
    reportsKeyVerdict: true,
  }),

  /**
   * `GET /v4/podcasts` — every show the key can see. The same call
   * `lib/podcast/rsscom.js` uses, and gated on the key alone for the reason
   * that client gives: this is how `RSSCOM_PODCAST_ID` is discovered, so it
   * must work before the id is seeded. Requiring the id here would make the
   * button useless at exactly the moment it is most wanted.
   */
  rsscom: createProbe({
    name: 'rsscom',
    service: 'RSS.com',
    settings: ['RSSCOM_API_KEY'],
    buildRequest: ({ values }) => ({
      url: 'https://api.rss.com/v4/podcasts',
      headers: { 'X-Api-Key': values.RSSCOM_API_KEY, Accept: 'application/json' },
    }),
  }),

  /**
   * `GET /youtube/v3/search` with `maxResults=1`.
   *
   * COSTS ~100 OF 10,000 DAILY QUOTA UNITS, whatever `maxResults` says — the
   * Data API prices search.list per call, not per result. That is the reason
   * this is a button and must never be a timer or a page-load check: a probe
   * on every render would spend the day's quota that Listen & Learn needs for
   * real episodes. `lib/listen-and-learn/videos.js` carries the same
   * arithmetic for the generator's side of the budget.
   */
  youtube: createProbe({
    name: 'youtube',
    service: 'YouTube',
    settings: ['YOUTUBE_API_KEY'],
    buildRequest: ({ values }) => {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      // A fixed query, not a caller's. The result is discarded; only the
      // status matters.
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('q', 'cloud');
      url.searchParams.set('maxResults', '1');
      url.searchParams.set('key', values.YOUTUBE_API_KEY);
      return { url: url.toString(), headers: { Accept: 'application/json' } };
    },
  }),
});

export const PROBE_NAMES = Object.freeze(Object.keys(PROBES));

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {Record<string,string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {(env: Record<string,string|undefined>, name: string) => string} deps.readKey
 * @param {Function|null} [deps.onKeyVerdict] The API-keys page's verdict writer.
 *   Consulted only for a probe that declared `reportsKeyVerdict`.
 * @returns {(request: object, context: object) => Promise<object>}
 */
export function createConnectionProbe({
  guard,
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  readKey,
  onKeyVerdict = null,
}) {
  return async function handler(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => null);
    const requested = String(body?.probe ?? '');
    // `Object.hasOwn`, not `PROBES[requested]`: a caller asking for
    // `constructor` or `__proto__` would otherwise reach an inherited member
    // and get something that is not a probe at all.
    if (!Object.hasOwn(PROBES, requested)) {
      return json(400, {
        ok: false,
        error: `probe must be one of ${PROBE_NAMES.join(', ')}`,
      });
    }
    const probe = PROBES[requested];

    // Per request, so a failed verdict write warns into this invocation's log.
    const reportVerdict = createKeyVerdictReporter({
      onKeyVerdict: probe.reportsKeyVerdict ? onKeyVerdict : null,
      log: context,
      source: `${probe.name}Probe`,
    });

    /** @type {Record<string,string>} */
    const values = {};
    for (const setting of probe.settings) {
      const value = readKey(env, setting);
      if (!value) {
        // 200 with ok:false, like the proxies: an unseeded key is a
        // configuration state the page renders as "not connected", not a
        // fault to page anyone about.
        return json(200, {
          ok: false,
          error: `${probe.service} is not configured: ${setting} is not set`,
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }
      values[setting] = value;
    }
    const secrets = Object.values(values);

    let request_;
    try {
      request_ = probe.buildRequest({ values });
    } catch (error) {
      // A credential that cannot go in a URL is a configuration state, not a
      // fault: 200 with ok:false, and a sentence that names the setting so the
      // operator knows which box to look in. The value itself is never quoted.
      const setting = probe.settings[0];
      context.warn?.(`${probe.name}Probe refused ${setting}: ${error.message}`);
      return json(200, {
        ok: false,
        error: `${probe.service} cannot be tested: ${setting} ${error.message}`,
        code: 'INTEGRATION_NOT_CONFIGURED',
      });
    }

    let response;
    let text;
    try {
      const { url, headers } = request_;
      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      // The URL is deliberately absent from this message, and redaction runs
      // over what is left. An undici failure quotes its request target in
      // `cause`, and for two of these three probes that target contains the
      // credential.
      const reason = redactSecrets(error?.message ?? String(error), secrets);
      context.error?.(`${probe.name}Probe could not reach ${probe.service}: ${reason}`);
      return json(200, {
        ok: false,
        error: `${probe.service} could not be reached: ${reason}`.slice(0, MAX_ERROR_LENGTH),
      });
    }

    // REDACTED BEFORE IT IS PARSED, which is the whole reason this is one
    // line rather than a call at each site that emits a string. The first
    // version redacted `error` and the log and passed the parsed `data`
    // through untouched — and `data` is the upstream's body, which for a
    // provider that echoes the request line back carries the credential
    // straight into the response. Its own test caught it. Everything
    // downstream now derives from this string, so there is one place to get
    // right instead of four.
    //
    // Replacing a substring inside a JSON string value leaves the document
    // valid. A credential containing a quote could in principle break the
    // parse, and that degrades into the `raw` branch below, which is the safe
    // direction to fail in.
    const safeText = redactSecrets(text, secrets);

    let data = null;
    try {
      data = safeText ? JSON.parse(safeText) : null;
    } catch {
      // Not every upstream error is JSON, and the raw text is more use to an
      // operator than discarding it.
      data = { raw: safeText.slice(0, 2000) };
    }

    if (response.ok) {
      // Only the settings this call actually exercised — which is why
      // `settings` is the probe's list and not "everything the service has".
      // Telegram's getMe never sees the chat id, so a success here must not
      // turn the chat id's light green.
      for (const setting of probe.settings) {
        await reportVerdict(setting, { ok: true });
      }
    } else if (isCredentialRejected(response.status)) {
      await reportVerdict(probe.settings[0], {
        ok: false,
        status: response.status,
        // Already safe: `data` was parsed from the redacted text above.
        detail: readUpstreamError(data),
      });
    }

    // `error` carries the upstream's own sentence, so the page prints what the
    // provider said rather than a bare status. `unwrapProxy` on the browser
    // side prefers this field, which is what keeps the three new runners from
    // needing to know each API's error shape (#463 item 4).
    const detail = readUpstreamError(data);
    return json(200, {
      ok: response.ok,
      status: response.status,
      data,
      ...(response.ok || !detail ? {} : { error: detail.slice(0, MAX_ERROR_LENGTH) }),
    });
  };
}
