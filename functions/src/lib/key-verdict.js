/**
 * key-verdict.js — how an upstream service's answer reaches the API-keys page.
 *
 * `secrets-health.js` says in its own header what it cannot see: a setting
 * whose reference resolved to the WRONG secret. That value is a real string,
 * not a reference, and "only the upstream service can say it is wrong". This
 * module is the upstream service saying so. A 401 or 403 from a provider is
 * recorded against the setting's Key Vault secret and the page turns the
 * light red; a success records the opposite and turns it green again.
 *
 * Two callers report today — the AI router (`ai/router.js`) and the Publer
 * client and proxy (`timers/publer-sync.js`, `integrations/rest-proxy.js`).
 * They share this module so they cannot disagree about what a rejected
 * credential is, and so the catalogue's `probe` field — the page's promise
 * that something reports on a secret — has one list of reporters to name.
 *
 * Two rules, held here and nowhere else:
 *
 *   - **Failures are always reported.** They are rare and they are the whole
 *     point. Issue #358: a stale Publer key failed a five-minute timer 429
 *     times in 36 hours and no monitor could see it, because the only thing
 *     that knew was Publer, and it was saying so into a log nobody reads.
 *   - **Successes are reported once per reporter per setting, until a
 *     failure.** The hundredth successful call says what the first one did,
 *     and a Cosmos write per call is not free. A recorded failure re-arms it,
 *     so the first success after a rotation is written and the light turns
 *     green again in the same worker. The router's private reporter never
 *     re-armed — once it had reported a provider working, a later rejection
 *     stayed red until the worker restarted — so moving it here fixes the
 *     three AI providers' lights as well as Publer's. The process-wide
 *     `recordKeyVerdict` below is itself a reporter, so a worker writes a
 *     success once however many clients it builds.
 *
 * And one invariant: reporting can never fail the call it observed. A status
 * page that cannot record a verdict is a warning, not an outage.
 */

/** The statuses that say "the credential is wrong", as opposed to the request. */
const CREDENTIAL_REJECTED_STATUSES = Object.freeze([401, 403]);

/**
 * Does this HTTP status mean the credential was rejected?
 *
 * A 404 is a wrong path or model id and a 429 is a busy account; turning the
 * light red for those would send the operator rotating a key that is fine. A
 * 500 or a timeout is transient and stays a failure of the call, not of the
 * key.
 */
export function isCredentialRejected(status) {
  return CREDENTIAL_REJECTED_STATUSES.includes(Number(status));
}

/**
 * Wrap a verdict writer in the two rules above.
 *
 * @param {object} [deps]
 * @param {((settingName: string, verdict: { ok: boolean, status?: number, detail?: string }) => Promise<void>) | null} [deps.onKeyVerdict]
 *   The writer. `null` — how every unit test constructs a client — makes the
 *   reporter a no-op.
 * @param {{ warn?: Function }} [deps.log]
 * @param {string} [deps.source] Names the caller in the warning when a write fails.
 * @returns {(settingName: string, verdict: { ok: boolean, status?: number, detail?: string }) => Promise<void>}
 *   `detail` is the upstream's own error sentence, carried through to the
 *   API-keys page unchanged (#463 item 4). It is a provider's message about a
 *   rejection, never a secret value; reporters pass whatever the provider
 *   said and `recordSecretVerdict` caps its length.
 */
export function createKeyVerdictReporter({ onKeyVerdict = null, log = console, source = 'key-verdict' } = {}) {
  const successReported = new Set();
  return async function report(settingName, verdict) {
    if (!onKeyVerdict) return;
    if (verdict.ok && successReported.has(settingName)) return;
    if (!verdict.ok) {
      // A failure re-arms the success report. Without this, a worker that had
      // already reported "the key works" would swallow the first success after
      // a rotation, and the light would stay red until the process restarted —
      // the one moment the page most needs to say green. (Copilot review of
      // 5967cbe7; the router's private reporter had the same hole.)
      successReported.delete(settingName);
    }
    try {
      await onKeyVerdict(settingName, verdict);
      // Marked only once the write has landed. Marking before the await would
      // let a Cosmos hiccup on the first success count as reported, and the
      // light would stay red until the next failure or restart (Copilot review
      // of 9f388d69). Two successes racing before the first resolves may both
      // write; one spare upsert is the cheaper side of that trade.
      if (verdict.ok) successReported.add(settingName);
    } catch (error) {
      log.warn?.(`[${source}] could not record a key verdict: ${error?.message ?? error}`);
    }
  };
}

/**
 * The raw Cosmos write, behind the process-wide reporter below.
 *
 * Imported lazily, and for two reasons. It keeps the Cosmos client off the
 * cold-start path of every function that imports a module which merely
 * mentions verdicts — `readKey` alone is imported from the router by six
 * modules, none of which touch a model. And it keeps every module in this
 * chain importable in tests and in tooling without a Cosmos connection string:
 * the store is only constructed when a verdict is actually recorded.
 */
async function writeKeyVerdict(settingName, verdict) {
  const [{ recordSecretVerdict, settingToSecret }, cosmos] = await Promise.all([
    import('./admin-secrets.js'),
    import('./cosmos-client.js'),
  ]);
  await recordSecretVerdict(
    { readDoc: cosmos.readDoc, upsertDoc: cosmos.upsertDoc },
    settingToSecret(settingName),
    verdict
  );
}

/**
 * Process-wide writer for production call sites.
 *
 * What the AI router's default instance, the Publer timer and the Publer
 * proxy hand over as `onKeyVerdict`. Already a reporter, so it never throws
 * and it writes a success once per worker per setting — a timer that builds
 * a fresh client every five minutes still records "the key works" once, not
 * 288 times a day.
 */
export const recordKeyVerdict = createKeyVerdictReporter({
  onKeyVerdict: writeKeyVerdict,
  source: 'key-verdict',
});
