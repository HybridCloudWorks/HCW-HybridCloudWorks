/**
 * publerProxy, klaviyoProxy, linkieProxy — authenticated pass-through to three
 * third-party REST APIs (#180).
 *
 * All three were listed `notImplemented` while the admin UI called them, so the
 * Connections, Social Hub, Mailing List and Linkie pages were dead. They share
 * one shape: the browser sends `{ path, method, body }` and the server forwards
 * it upstream with a credential the browser must never see.
 *
 * THE CREDENTIAL IS THE WHOLE POINT, and it is also the hazard. A proxy that
 * attaches a Key Vault secret to an outbound request, with the path chosen by
 * the caller, is a confused deputy: whoever controls `path` controls where the
 * secret goes. `assertSafePath` is therefore not defensive tidiness, it is the
 * security boundary —
 *
 *   - an absolute URL would send the key to a host of the caller's choosing;
 *   - a protocol-relative `//evil.test/x` is an absolute URL that does not look
 *     like one;
 *   - `..` segments can climb out of an API's versioned prefix;
 *   - a backslash is a path separator to some servers and not to URL parsers,
 *     which is exactly the disagreement a bypass lives in.
 *
 * The role gate in front of this is `editor`, not `admin`, so "they are trusted
 * already" is not an argument that survives contact with an XSS bug in the
 * portal or a stolen editor session.
 *
 * WHAT IS NOT PROXIED: the response is returned as-is, including upstream error
 * bodies, because these pages show upstream errors to the operator and a
 * flattened "request failed" would remove the only useful information. Status
 * codes are passed through for the same reason.
 */

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const ALLOWED_METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * @throws {Error} when `path` could redirect the credential off its own API.
 */
export function assertSafePath(path) {
  const value = String(path ?? '');
  if (!value.startsWith('/')) {
    throw new Error('path must start with "/"');
  }
  // `//host` is protocol-relative and resolves to another origin.
  if (value.startsWith('//')) {
    throw new Error('path must not be protocol-relative');
  }
  // Catches `https://`, `http:/x`, and anything else with a scheme.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error('path must not contain a scheme');
  }
  if (value.includes('..')) {
    throw new Error('path must not contain ".." segments');
  }
  if (value.includes('\\')) {
    throw new Error('path must not contain backslashes');
  }
  // Control characters, including a newline that could inject a second
  // request line or a header into the outbound call. Written as escapes:
  // the first version embedded the raw bytes, which works but makes the
  // file read as binary to git and grep.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('path must not contain control characters');
  }
  return value;
}

/**
 * One upstream API: where it lives, how it authenticates, and which env var
 * holds its key.
 *
 * Base URLs carry no trailing slash and paths always start with one, so the
 * join is unambiguous. Publer's base is taken from the existing client rather
 * than repeated — `lib/timers/publer-sync.js` has been calling this API since
 * the port and is the one place that already knows the answer.
 */
export function createIntegration({ name, baseUrl, keyEnv, headers, extraEnv = [] }) {
  return { name, baseUrl, keyEnv, headers, extraEnv };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {Record<string,string|undefined>} [deps.env]
 * @param {typeof fetch} [deps.fetch]
 * @param {(env: string) => string} deps.readKey
 */
export function createRestProxy({ guard, env = process.env, fetch: fetchImpl = globalThis.fetch, readKey }) {
  /** @returns {Function} an Azure Functions handler for one integration. */
  return function handlerFor(integration) {
    return async function handler(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      const apiKey = readKey(env, integration.keyEnv);
      if (!apiKey) {
        // Named, and 200-with-ok:false rather than 5xx: an unseeded key is a
        // configuration state the Connections page renders as "not connected",
        // not a fault to page anyone about.
        return json(200, {
          ok: false,
          error: `${integration.name} is not configured: ${integration.keyEnv} is not set`,
          code: 'INTEGRATION_NOT_CONFIGURED',
        });
      }
      for (const name of integration.extraEnv) {
        if (!readKey(env, name)) {
          return json(200, {
            ok: false,
            error: `${integration.name} is not configured: ${name} is not set`,
            code: 'INTEGRATION_NOT_CONFIGURED',
          });
        }
      }

      const body = await request.json().catch(() => null);
      const method = String(body?.method || 'GET').toUpperCase();
      if (!ALLOWED_METHODS.includes(method)) {
        return json(400, { ok: false, error: `method must be one of ${ALLOWED_METHODS.join(', ')}` });
      }

      let path;
      try {
        path = assertSafePath(body?.path);
      } catch (error) {
        // Logged at error, not warn: a caller reaching for another origin
        // through a credentialed proxy is worth seeing in telemetry whether it
        // was a bug or an attempt.
        context.error?.(`${integration.name}Proxy rejected path: ${error.message}`, {
          path: String(body?.path ?? '').slice(0, 200),
        });
        return json(400, { ok: false, error: error.message });
      }

      const options = {
        method,
        headers: { 'Content-Type': 'application/json', ...integration.headers({ apiKey, env, readKey }) },
      };
      if (body?.body !== undefined && !['GET', 'HEAD'].includes(method)) {
        options.body = JSON.stringify(body.body);
      }

      try {
        const response = await fetchImpl(`${integration.baseUrl}${path}`, options);
        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // Not every upstream error is JSON. Returning the raw text is more
          // use to an operator than discarding it.
          data = { raw: text.slice(0, 2000) };
        }
        return json(200, { ok: response.ok, status: response.status, data });
      } catch (error) {
        context.error?.(`${integration.name}Proxy ${method} ${path} failed:`, error);
        return json(200, {
          ok: false,
          error: `${integration.name} request failed: ${error?.message || error}`,
        });
      }
    };
  };
}
