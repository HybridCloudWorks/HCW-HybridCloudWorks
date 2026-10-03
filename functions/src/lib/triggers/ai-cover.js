/**
 * ai-cover.js — `generateAiCoverOnContentTrigger`: a content document whose
 * `altCoverImageTrigger` goes true gets up to four AI-generated images
 * (`aiImageTargets`, hero by default) through Replicate.
 *
 * Ported from Site-Main index.js (088f458) with the rising-edge claim. Not
 * carried over: the WebP responsive variants (sharp), the mascot
 * image-conditioned path (`character_profiles`), and the OpenAI image
 * fallback — the PNG original lands in `covers/` and is served through the
 * media route; `aiImageVariants` stays empty. Replicate is called over REST
 * (`Prefer: wait`, then polling) with no SDK dependency; a missing
 * `REPLICATE_API_KEY` fails the run with a clear `altCoverImageError`, and the
 * claim is released either way.
 *
 * ADR 0033 (Creative slice) changed two things about what this writes:
 *
 *   - THE PROMPT COMES FROM THE LIBRARY. `resolveCoverPrompt` uses the
 *     editor's override when one was typed, otherwise the Image Prompts set
 *     assigned to the document (its own lineage, then its provider's page),
 *     composed with the hero slot template, the set's style rules and the
 *     keyword matrix. The hardcoded "Lego minifigure" prompt is now the
 *     fallback for a document no set applies to, not the only path.
 *   - EVERY ROW IS A REAL FILE. The blob path carries the generation stamp
 *     (`{id}-ai-{slot}-{yyyymmddhhmmss}.png`), so regenerating no longer
 *     overwrites the previous cover's bytes and the history rows the gallery
 *     shows each point at their own image. Old rows keep their un-stamped
 *     paths and still resolve. Each row records its lineage (set, prompt,
 *     template version, final text), the provider and model, the blob path
 *     the delete route needs, and the measured bytes and dimensions.
 */
import { readKey } from '../ai/router.js';
import { mediaUrlFor } from '../blob-paths.js';
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import {
  composeSetPrompt,
  lineageFor,
  loadKeywordMatrix,
  resolvePromptSetForContent,
} from '../cms/image-prompts.js';
import { measureImage } from '../gallery-images.js';
import { claimRisingEdge, releaseRisingEdgeClaim, SKIP_REASONS } from './rising-edge-claim.js';
import { fetchImage as defaultFetchImage } from './fetch-image.js';
import { fetchWithTimeout } from '../http/fetch-with-timeout.js';

// Deadlines for the Replicate calls (T-712). This runs inside a change-feed
// handler, so a hung socket does not just fail one cover — it holds the lease
// and queues every subsequent change behind it.
const REPLICATE_POST_TIMEOUT_MS = 90_000; // clears the `Prefer: wait=60` hold
const REPLICATE_POLL_TIMEOUT_MS = 30_000;
const REPLICATE_POLL_BUDGET_MS = 5 * 60 * 1000; // wall clock for the whole poll loop

export const AI_COVER_CLAIM_FIELDS = Object.freeze({
  flagField: 'altCoverImageTrigger',
  claimField: 'altCoverImageRunId',
  claimedAtField: 'altCoverImageRunAt',
});

/** The one image provider this site generates with today. */
export const IMAGE_PROVIDER = 'replicate';

/**
 * The curated per-provider default heroes (T-606): admin_config/default_heroes
 * carries { heroes: { Azure: '/api/public/media/covers/…', AWS: …, Multi: … } }
 * — uploaded once by the owner through the image gallery. Absent doc or
 * provider key = no fallback, same behavior as before the feature.
 */
export const DEFAULT_HEROES_CONFIG_ID = 'default_heroes';

/** Case-insensitive provider → hero URL, with Multi as the catch-all. */
export function pickDefaultHero(heroes = {}, providerRaw = '') {
  const provider = String(providerRaw || '')
    .trim()
    .toLowerCase();
  const entries = Object.entries(heroes || {});
  const byKey = (wanted) =>
    entries.find(([key]) => key.toLowerCase() === wanted)?.[1] || null;
  if (provider) {
    const exact = byKey(provider);
    if (exact) return exact;
    if (provider.includes('google')) {
      const gcp = byKey('gcp');
      if (gcp) return gcp;
    }
  }
  return byKey('multi');
}

/** Mirrors applyPublishTimeCoverTrigger's "already has a cover" field list. */
function hasCover(data = {}) {
  return Boolean(
    data.altCoverImage ||
      data['Cover Image'] ||
      data.contentImageUrl ||
      data.aiImageUrls?.hero ||
      data.heroImageUrl ||
      data.coverImage
  );
}

export const PROVIDER_THEMES = Object.freeze({
  Azure: { color: 'blue and white', vibe: 'modern and corporate' },
  AWS: { color: 'orange and dark blue', vibe: 'professional and energetic' },
  GCP: { color: 'multicolor (blue, red, yellow, green)', vibe: 'playful and innovative' },
  GitHub: { color: 'purple and dark gray', vibe: 'developer-focused and sleek' },
  Terraform: { color: 'purple', vibe: 'technical and structured' },
  FinOps: { color: 'teal and green', vibe: 'financial and analytical' },
  // #775. Docker's blue is the site's --docker-blue, #1D63ED.
  Docker: { color: 'bright blue and white', vibe: 'modular and developer-friendly' },
  Multi: { color: 'multicolor gradient', vibe: 'versatile and integrated' },
});

/** The built-in prompt: the ultimate fallback when no set applies. */
export const BUILTIN_PROMPT_VERSION = 'builtin-lego-v1';

export function buildImagePrompt(article) {
  const provider =
    article.cloudProvider ||
    article['Cloud Provider'] ||
    article.provider ||
    article.Provider ||
    'Azure';
  const theme = PROVIDER_THEMES[provider] || PROVIDER_THEMES.Azure;
  if (article.keyTopics && article.visualTheme && article.summary) {
    return `Create a professional technical illustration in ${theme.color} color scheme with a ${theme.vibe} aesthetic.

Scene: 2-3 cute Lego minifigure-style characters collaborating to build cloud infrastructure.

They are constructing and working on: ${article.keyTopics.join(', ')}

Visual metaphor: ${article.visualTheme}

Context: ${article.summary}

Style requirements:
- Isometric 3D illustration, clean and modern design
- Modular building blocks with Lego brick aesthetic
- Characters actively building/connecting/deploying components
- Subtle ${provider} branding elements (colors, logo hints)
- Tech-focused and professional yet playful
- No text overlays, labels, or written words in the image
- Focus on the collaborative building activity

The scene should visually represent the article's core concepts through the Lego characters' construction work.`;
  }
  const resources =
    article.resources ||
    article.Resources ||
    article.title ||
    article.Title ||
    'cloud infrastructure';
  return `Create a professional technical illustration in ${theme.color} color scheme with a ${theme.vibe} aesthetic. The scene features cute Lego minifigure-style characters collaborating to build cloud infrastructure. Show 2-3 blocky characters working together on: ${resources}. The characters should be constructing these as modular building blocks, similar to Lego bricks. Include subtle ${provider} branding elements. Style: isometric 3D illustration, clean and modern, tech-focused, with a playful builder theme. No text or logos, just the visual scene.`;
}

/**
 * The prompt a cover generation sends, and where it came from.
 *
 *   override  the editor typed one (`altCoverImagePrompt`) — used verbatim
 *   library   the Image Prompts set resolved for this document
 *   builtin   the Lego prompt above
 *
 * Never throws: a library that cannot be read falls through to the built-in
 * prompt with the reason logged, because a cover is still owed.
 *
 * @returns {Promise<{ prompt: string, source: 'override'|'library'|'builtin', lineage: object, aspectRatio?: string }>}
 */
export async function resolveCoverPrompt({ store, log = {} }, data, { slot = 'hero' } = {}) {
  const provided =
    typeof data.altCoverImagePrompt === 'string' && data.altCoverImagePrompt.trim();
  if (provided) {
    return {
      prompt: provided,
      source: 'override',
      aspectRatio: undefined,
      lineage: lineageFor({ set: null, prompt: null, promptText: provided, slot, source: 'override' }),
    };
  }
  try {
    const resolved = await resolvePromptSetForContent(store, data);
    if (resolved?.set?.primaryPrompt) {
      const keyword = await loadKeywordMatrix(store, log);
      const prompt = composeSetPrompt({
        set: resolved.set,
        prompt: resolved.prompt,
        slot,
        article: data,
        keyword,
      });
      return {
        prompt,
        source: 'library',
        aspectRatio: String(resolved.set.aspectRatio || '').trim() || undefined,
        lineage: lineageFor({
          set: resolved.set,
          prompt: resolved.prompt,
          promptText: prompt,
          slot,
          source: resolved.source,
        }),
      };
    }
  } catch (error) {
    log.warn?.(`[generateAiCover] prompt library unavailable, using built-in prompt: ${error?.message || error}`);
  }
  const prompt = buildImagePrompt(data);
  return {
    prompt,
    source: 'builtin',
    aspectRatio: undefined,
    lineage: {
      ...lineageFor({ set: null, prompt: null, promptText: prompt, slot, source: 'builtin' }),
      promptTemplateVersion: BUILTIN_PROMPT_VERSION,
    },
  };
}

/** Requested image slots, capped at 4; hero-only when none are set. */
export function resolveAiCoverTargets(data) {
  return Array.isArray(data.aiImageTargets) && data.aiImageTargets.length > 0
    ? data.aiImageTargets.slice(0, 4)
    : ['hero'];
}

/** `2026-08-28T12:00:00.000Z` → `20260828120000`: safe in a blob name. */
export function compactStamp(iso) {
  return String(iso || '')
    .replace(/[-:TZ]/g, '')
    .replace(/\..*$/, '')
    .slice(0, 14);
}

/**
 * The blob path for one generated cover. Stamped so a regeneration writes a
 * new file beside the old one rather than over it (ADR 0033 §6.2).
 */
export function aiCoverBlobPath(contentId, target, stampIso) {
  return `${contentId}-ai-${target}-${compactStamp(stampIso)}.png`;
}

/**
 * Replicate over REST. `generate(prompt)` resolves to the image URL.
 * @param {{ env?: object, fetch?: typeof fetch, sleep?: Function }} deps
 */
export function createReplicateClient({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const apiKey = readKey(env, 'REPLICATE_API_KEY');
  const model =
    env.CONTENTFORGE_IMAGE_MODEL_HERO || env.CONTENTFORGE_IMAGE_MODEL || 'google/imagen-4-fast';
  // Per-image price for the usage display; Replicate bills per output, so
  // this is configuration, not a measurement. Absent = unknown, shown as such.
  const parsedCost = Number(env.CONTENTFORGE_IMAGE_COST_USD);
  const costPerImageUsd = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : null;

  async function generate(prompt, { aspectRatio } = {}) {
    if (!apiKey) throw new Error('REPLICATE_API_KEY is not configured');
    const input = {
      prompt,
      aspect_ratio: aspectRatio || '16:9',
      image_size: env.CONTENTFORGE_IMAGE_SIZE || '2K',
      output_format: 'png',
      safety_filter_level: 'block_medium_and_above',
    };
    const headers = {
      Authorization: `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    };
    let prediction;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetchWithTimeout(
        fetchImpl,
        `https://api.replicate.com/v1/models/${model}/predictions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ input }),
          // `Prefer: wait=60` asks Replicate to hold the connection for up to
          // 60s, so the deadline has to clear that plus slack — otherwise the
          // timeout would fire on the happy path (T-712).
          timeoutMs: REPLICATE_POST_TIMEOUT_MS,
        }
      );
      if (response.ok) {
        prediction = await response.json();
        break;
      }
      const retryable = [429, 503, 502, 504].includes(response.status);
      if (!retryable || attempt === 3) throw new Error(`Replicate HTTP ${response.status}`);
      await sleep(2 ** attempt * 1000);
    }
    // Prefer: wait returns a completed prediction in the common case; poll otherwise.
    // An iteration count alone does not bound wall-clock time: each iteration
    // sleeps 2s AND makes a request, so a run of slow-but-not-timing-out polls
    // could sit here far longer than the arithmetic suggests. The deadline is
    // the real bound (T-712).
    const pollDeadline = Date.now() + REPLICATE_POLL_BUDGET_MS;
    for (
      let poll = 0;
      poll < 60 && !['succeeded', 'failed', 'canceled'].includes(prediction.status);
      poll += 1
    ) {
      if (Date.now() > pollDeadline) {
        throw new Error(
          `Replicate prediction still ${prediction.status} after ${Math.round(REPLICATE_POLL_BUDGET_MS / 1000)}s`
        );
      }
      await sleep(2000);
      const response = await fetchWithTimeout(
        fetchImpl,
        prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: headers.Authorization }, timeoutMs: REPLICATE_POLL_TIMEOUT_MS }
      );
      if (!response.ok) throw new Error(`Replicate poll HTTP ${response.status}`);
      prediction = await response.json();
    }
    if (prediction.status !== 'succeeded')
      throw new Error(
        `Replicate prediction ${prediction.status}: ${prediction.error || 'unknown'}`
      );
    const output = prediction.output;
    const imageUrl =
      typeof output === 'string' ? output : Array.isArray(output) ? output[0] : output?.url;
    if (!imageUrl) throw new Error('No image URL returned from Replicate API');
    return imageUrl;
  }

  return { configured: Boolean(apiKey), provider: IMAGE_PROVIDER, model, costPerImageUsd, generate };
}

/**
 * The fields a generated image row carries about the bytes and the model —
 * shared by every generator so the gallery reads one shape (ADR 0033 §4).
 */
export function generatedImageRecordFields({ buffer, contentType, blobPath, replicate, lineage }) {
  const measured = measureImage(buffer, contentType);
  return {
    storagePath: `covers/${blobPath}`,
    bytes: buffer?.length ?? null,
    format: String(contentType || '').replace(/^image\//, '') || null,
    width: measured?.width ?? null,
    height: measured?.height ?? null,
    imageProvider: replicate?.provider || IMAGE_PROVIDER,
    imageModel: replicate?.model || '',
    ...(lineage || {}),
  };
}

/**
 * Generate + persist the requested cover slots for one content document:
 * Replicate per slot → blob in `covers/` → gallery record — and return the
 * content-doc `update` (URLs, history, stamps) WITHOUT writing it, so each
 * caller composes its own patch. Shared by the change-feed trigger (which
 * adds its claim-release fields) and the manual generateReviewHeroImage RPC
 * (lib/manual-images.js) — one generation path, not two (T-324 shape).
 *
 * @returns {Promise<{ generatedUrls: Record<string,string>, update: object, stamp: string, records: object[] }>}
 */
export async function generateCoversForContent(
  { store, storage, replicate, fetchImage = defaultFetchImage, now = () => new Date(), uuid },
  contentId,
  data,
  { targets, prompt, lineage = {}, aspectRatio }
) {
  const generatedUrls = {};
  const records = [];
  const stamp = now().toISOString();
  for (const target of targets) {
    const slotPrompt = `${prompt}\n\nImage slot: ${target}. Keep composition distinct while preserving style continuity.`;
    const imageUrl = await replicate.generate(slotPrompt, { aspectRatio });
    const fetched = await fetchImage(imageUrl);
    // A generation that came back as something other than an image is a failed
    // generation, so it fails the slot rather than being skipped (#415): the
    // caller's catch writes `altCoverImageError` and the doc never claims a
    // cover it has no bytes for.
    if (fetched.refused) throw new Error(`Generated ${target} cover refused: ${fetched.reason}`);
    const { buffer, contentType } = fetched;
    const blobPath = aiCoverBlobPath(contentId, target, stamp);
    await storage.uploadBlob('covers', blobPath, buffer, contentType, {
      contentId,
      slot: target,
    });
    const publicUrl = mediaUrlFor('covers', blobPath);
    generatedUrls[target] = publicUrl;
    const title = data.Title || data.title || 'Untitled';
    const record = {
      id: uuid(),
      contentId,
      articleId: contentId,
      slot: target,
      imageUrl: publicUrl,
      title,
      altText: title,
      provider: data['Cloud Provider'] || data.cloudProvider || '',
      contentType: data.type || data.contentType || 'blog',
      sourceCollection: 'content',
      approvalStatus: 'approved',
      folder: 'default',
      customTags: [],
      createdAt: stamp,
      ...generatedImageRecordFields({
        buffer,
        contentType,
        blobPath,
        replicate,
        lineage: { ...lineage, prompt: slotPrompt, promptSlot: target },
      }),
    };
    await store.upsertDoc('generated_content_images', record);
    records.push(record);
  }
  const history = { ...(data.aiImageHistory || {}) };
  for (const [target, url] of Object.entries(generatedUrls))
    history[target] = [...new Set([...(history[target] || []), url])];
  const update = {
    altCoverImagePrompt: prompt,
    altCoverImageGeneratedAt: stamp,
    altCoverImageError: null,
    aiImageUrls: { ...(data.aiImageUrls || {}), ...generatedUrls },
    aiImageHistory: history,
  };
  if (lineage.promptSet) {
    update.imagePromptSet = lineage.promptSet;
    update.imagePromptName = lineage.promptName || '';
    update.promptTemplateVersion = lineage.promptTemplateVersion || '';
  }
  if (generatedUrls.hero) update.altCoverImage = generatedUrls.hero;
  return { generatedUrls, update, stamp, records };
}

/**
 * @param {object} deps
 * @param {{ readDoc: Function, patchDoc: Function, upsertDoc: Function, replaceDocIfMatch: Function, queryDocs?: Function }} deps.store
 * @param {{ uploadBlob: Function }} deps.storage
 * @param {{ generate: Function }} deps.replicate
 * @param {Function} [deps.fetchImage]
 * @param {() => string} deps.uuid
 */
export function createAiCoverGenerator({
  store,
  storage,
  replicate,
  fetchImage = defaultFetchImage,
  now = () => new Date(),
  uuid,
  log = {},
}) {
  /**
   * @param {string} contentId
   * @param {string} eventId - stable across redeliveries (the item's _etag)
   * @returns {Promise<{ ran: boolean, reason: string, targets?: string[] }>}
   */
  async function run(contentId, eventId) {
    const claim = await claimRisingEdge(store, 'content', contentId, {
      ...AI_COVER_CLAIM_FIELDS,
      eventId,
      now,
    });
    if (!claim.claim) {
      if (claim.reason !== SKIP_REASONS.FLAG_NOT_SET)
        log.log?.(`[generateAiCover:content] content/${contentId} skipped: ${claim.reason}`);
      return { ran: false, reason: claim.reason };
    }
    const data = claim.data;
    try {
      const resolved = await resolveCoverPrompt({ store, log }, data);
      const targets = resolveAiCoverTargets(data);
      const { update } = await generateCoversForContent(
        { store, storage, replicate, fetchImage, now, uuid },
        contentId,
        data,
        {
          targets,
          prompt: resolved.prompt,
          lineage: resolved.lineage,
          aspectRatio: resolved.aspectRatio,
        }
      );
      await store.patchDoc('content', contentId, {
        ...releaseRisingEdgeClaim(AI_COVER_CLAIM_FIELDS),
        altCoverImageTrigger: false,
        altCoverImagePromptSource: resolved.source,
        ...update,
      });
      return { ran: true, reason: 'generated', targets, promptSource: resolved.source };
    } catch (err) {
      log.error?.(
        `[generateAiCover:content] Failed for content/${contentId}: ${err?.message || err}`
      );
      // Releasing the claim is required: a claim left behind blocks the next request for the whole window.
      const errorUpdate = {
        ...releaseRisingEdgeClaim(AI_COVER_CLAIM_FIELDS),
        altCoverImageTrigger: false,
        altCoverImageError: String(err?.message || err).slice(0, 500),
      };
      // Deterministic fallback (T-606): generation failed or is unconfigured,
      // but a post should still stage with a designed cover. Best effort — a
      // failure reading the mapping keeps the plain error patch.
      let fallbackApplied = false;
      if (!hasCover(data)) {
        try {
          const config = await store.readDoc(
            'admin_config',
            DEFAULT_HEROES_CONFIG_ID,
            ADMIN_CONFIG_PARTITION
          );
          const fallback = pickDefaultHero(
            config?.heroes,
            data['Cloud Provider'] || data.cloudProvider || ''
          );
          if (fallback) {
            // contentImageUrl too: the public list projection carries it but
            // not heroImageUrl (lib/public-reads.js PUBLIC_CONTENT_LIST_FIELDS).
            errorUpdate.altCoverImage = fallback;
            errorUpdate.contentImageUrl = fallback;
            errorUpdate.altCoverImageError = `fallback: default hero (${String(
              err?.message || err
            ).slice(0, 400)})`;
            fallbackApplied = true;
          }
        } catch (fallbackErr) {
          log.warn?.(
            `[generateAiCover:content] default-hero fallback failed for content/${contentId}: ${fallbackErr?.message || fallbackErr}`
          );
        }
      }
      await store.patchDoc('content', contentId, errorUpdate);
      return {
        ran: false,
        reason: fallbackApplied
          ? `error_with_default_hero: ${err?.message || err}`
          : `error: ${err?.message || err}`,
      };
    }
  }
  return { run };
}
