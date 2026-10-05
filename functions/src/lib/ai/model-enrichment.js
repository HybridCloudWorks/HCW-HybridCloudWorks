/**
 * model-enrichment.js — what the code knows about a model id: capabilities,
 * modality and context, keyed by id pattern (ADR 0034 slice 2, #857).
 *
 * Split from model-catalog.js in slice 3 (#858) so the resolver (select.js)
 * can judge a model the catalogue has not listed yet — a pinned id before the
 * first refresh — without importing the catalogue module, which imports the
 * router, which imports the resolver. Pricing is deliberately NOT here: it
 * reads COST_TABLE on the router, and model-catalog.js composes the two.
 *
 * Capabilities never come from a provider's free text (ADR 0034 §2). A model
 * no pattern names is text only; the catalogue marks it unpriced.
 */

const TEXT_JSON = Object.freeze(['text', 'json']);
const TEXT_JSON_VISION = Object.freeze(['text', 'json', 'vision']);

/**
 * Capabilities and context by id pattern, first match wins. Small and
 * honest: a context is written only where the provider publishes one for
 * the family, and a model that is not a chat model (speech, audio,
 * transcription, image generation, embeddings, moderation) carries no
 * capability at all until slice 5 names the audio and image modalities.
 *
 * `modality` is the kind of answer the model is listed for, in the task
 * registry's vocabulary (tasks.js MODALITIES); null for a model whose
 * modality that registry does not name yet.
 */
export const ENRICHMENT_TABLE = Object.freeze([
  {
    pattern: /(^|[-/])(tts|audio|realtime|transcribe|whisper|embedding|embed|moderation|image|imagen|veo|dall-e)([-/.]|$)/i,
    capabilities: [],
    modality: null,
    context: null,
  },
  // Gemini: every generateContent model reads images and returns JSON; the
  // Interactions API grounds on pages and YouTube (router.js header).
  { pattern: /^gemini-/, capabilities: ['text', 'json', 'vision', 'grounding'], modality: 'text', context: 1_048_576 },
  { pattern: /^gpt-5/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 400_000 },
  { pattern: /^gpt-4\.1/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 1_047_576 },
  { pattern: /^gpt-4/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 128_000 },
  { pattern: /^o\d/, capabilities: TEXT_JSON, modality: 'text', context: 200_000 },
  { pattern: /^claude-/, capabilities: TEXT_JSON_VISION, modality: 'text', context: 200_000 },
  // NVIDIA's catalogue ids are `<org>/<model>`; context is not published
  // per trial-tier model, so it stays null rather than guessed.
  { pattern: /^z-ai\/glm-/, capabilities: TEXT_JSON, modality: 'text', context: null },
  { pattern: /^(deepseek-ai\/)?deepseek-/, capabilities: TEXT_JSON, modality: 'text', context: null },
]);

/** The row for a model no pattern names: text only (ADR 0034 §2). */
export const DEFAULT_ENRICHMENT = Object.freeze({
  capabilities: Object.freeze(['text']),
  modality: 'text',
  context: null,
});

/** `{ capabilities, modality, context }` for a model id, from the table or the default row. */
export function enrichmentFor(id) {
  const row = ENRICHMENT_TABLE.find(({ pattern }) => pattern.test(String(id ?? ''))) || DEFAULT_ENRICHMENT;
  return { capabilities: [...row.capabilities], modality: row.modality, context: row.context };
}
