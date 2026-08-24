/**
 * aiProxy and testAiProvider — the two admin RPCs that call a model directly
 * (TODO.md #180).
 *
 * Both were listed `notImplemented` in `.azure/api-surface.json` while the AI
 * Engine page called them anyway, so the Playground and every provider's Test
 * button returned 404. Configuring providers worked — #181 wired that — and the
 * two controls for *checking whether the configuration is any good* did not.
 *
 * These are deliberately thin. `router.callProvider()` already does the work:
 * it validates the provider, refuses one whose key is absent, calls it, and
 * reports token counts. What is added here is the part the portal needs and the
 * router has no business knowing — an HTTP shape, a cost figure, a latency, a
 * usage record, and a status written back onto the provider document.
 *
 * NEITHER IS FEATURE-GATED. The AI feature switches (#181) decide whether the
 * SITE may call a model — the inspector, the forge, the Telegram bot. These are
 * an administrator testing their own configuration from the portal, behind the
 * editor role. Gating them would make a switched-off feature impossible to
 * diagnose, which is the opposite of what a test button is for.
 *
 * THEY BYPASS THE PREFERENCE ORDER TOO. `callProvider` takes an explicit
 * provider and does not fall through to the next one, because "test Anthropic"
 * that quietly succeeds against Gemini answers the wrong question.
 */

import { recordAiUsage } from './usage.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const PROVIDERS_CONTAINER = 'ai_providers';

/** A short, cheap prompt. The answer does not matter; reaching the model does. */
const TEST_PROMPT = 'Reply with the single word: ok';

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, upsertDoc: Function, patchDoc: Function }} deps.store
 * @param {{ callProvider: Function, getCostEstimate: Function }} deps.ai
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 * @param {() => number} [deps.clock] monotonic-ish source for latency
 */
export function createAiProxyHandlers({
  guard,
  store,
  ai,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
  clock = () => Date.now(),
}) {
  /**
   * Record what a call cost.
   *
   * The row shape lives in ai/usage.js, shared with the Listen & Learn run
   * since that became the second thing here that spends money on a model. The
   * portal's Usage tab does its arithmetic client-side over whatever rows it
   * finds — totalling `totalTokens` and `estimatedCostUsd`, grouping by
   * `provider` — so a second writer with a slightly different shape would not
   * error, it would silently total zero.
   *
   * A failure there must not fail the call: the model has already answered and
   * been paid for, and losing the record is better than losing the answer.
   */
  const recordUsage = (record) => recordAiUsage({ store, ai, uuid, now }, record);

  return {
    /** POST /api/aiProxy — one call to one named provider. */
    async aiProxy(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => null);
      const provider = String(body?.provider || '').trim();
      const prompt = String(body?.prompt || '');
      if (!provider) return json(400, { ok: false, error: 'provider is required' });
      if (!prompt.trim()) return json(400, { ok: false, error: 'prompt is required' });

      const startedAt = clock();
      try {
        const result = await ai.callProvider({
          provider,
          model: body?.model || null,
          prompt,
          systemPrompt: String(body?.systemPrompt || ''),
        });
        const latencyMs = clock() - startedAt;

        await recordUsage({
          provider,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          source: body?.source,
        });

        return json(200, {
          ok: true,
          text: result.text,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          estimatedCostUsd: ai.getCostEstimate(
            provider,
            result.model,
            result.promptTokens,
            result.completionTokens
          ),
          latencyMs,
        });
      } catch (error) {
        // 200 with ok:false, not 5xx. The caller is a Playground that renders
        // the message; an unconfigured provider is an answer, not a fault, and
        // AI_NOT_CONFIGURED already says exactly what to do about it.
        context.error?.('aiProxy failed:', error);
        return json(200, {
          ok: false,
          error: error?.message || 'The provider call failed',
          code: error?.code || null,
          latencyMs: clock() - startedAt,
        });
      }
    },

    /**
     * POST /api/testAiProvider — can we reach this provider right now?
     *
     * Writes the verdict back onto the provider document so the portal's status
     * badge survives a reload, which is what the page's `status`/`lastTested`
     * fields have always expected and nothing has ever set.
     */
    async testAiProvider(request, context) {
      const auth = await guard.requireRole(request, 'editor');
      if (auth.error) return auth.error;

      const body = await request.json().catch(() => null);
      const providerId = String(body?.providerId || '').trim();
      if (!providerId) return json(400, { ok: false, error: 'providerId is required' });

      const startedAt = clock();
      let outcome;
      try {
        const result = await ai.callProvider({
          provider: providerId,
          model: body?.model || null,
          prompt: TEST_PROMPT,
        });
        outcome = {
          ok: true,
          status: 'connected',
          latencyMs: clock() - startedAt,
          model: result.model,
        };
        await recordUsage({
          provider: providerId,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          source: 'admin_test',
        });
      } catch (error) {
        context.error?.(`testAiProvider(${providerId}) failed:`, error);
        outcome = {
          ok: false,
          status: 'error',
          latencyMs: clock() - startedAt,
          error: error?.message || 'The provider call failed',
          code: error?.code || null,
        };
      }

      // Best-effort: a provider that answered still answered, even if recording
      // that fact failed.
      try {
        await store.patchDoc(PROVIDERS_CONTAINER, providerId, {
          status: outcome.status,
          latencyMs: outcome.latencyMs,
          lastTested: now().toISOString(),
          lastTestError: outcome.error || null,
        });
      } catch (error) {
        context.error?.(`testAiProvider(${providerId}) could not save status:`, error);
      }

      return json(200, outcome);
    },
  };
}
