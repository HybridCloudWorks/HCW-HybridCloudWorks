/**
 * forge-studio.js — the owner's voice, editable (Blog Machine T-604, the
 * T-409 remainder). Until this existed, `admin_config/forge_profile` and
 * `admin_config/forge_prompts` could only be seeded by hand in Cosmos, which
 * meant the single most load-bearing input to the forge — whose voice it
 * writes in — had no admin surface at all.
 *
 * Two RPCs and one job:
 *   getForgeConfig    — both documents (normalized), plus the read-only
 *                       context an editor needs beside them: the format
 *                       library summary and the forge_stats scoreboard.
 *   updateForgeConfig — whitelist-validated partial update of either
 *                       document. The whitelist is the normalizers the
 *                       PIPELINE already trusts (normalizeProfile /
 *                       normalizePrompts), so nothing can be stored that the
 *                       forge would not read back the same way. Audited.
 *   voice-calibration — (registered in functions/forge-jobs.js) reads the
 *                       owner's recent published posts and writes SUGGESTED
 *                       wordSoup additions and style hints onto the profile's
 *                       `suggestions` field. Never merged automatically: the
 *                       Studio renders them as accept/dismiss chips, and an
 *                       accept arrives back here as an ordinary
 *                       updateForgeConfig carrying the new wordSoup — so the
 *                       profile stays the owner's own, keystroke for
 *                       keystroke.
 *
 * Cache note: the pipeline's config loader caches for 5 minutes per process.
 * An update clears the cache in THIS process; other warm workers converge
 * within the TTL, which is acceptable for voice configuration and is the
 * same staleness the manual-Cosmos-seeding era had.
 */
import { ADMIN_CONFIG_PARTITION } from '../cosmos-client.js';
import { normalizeProfile, normalizePrompts } from './forge-config.js';
import { FORMAT_LIBRARY } from './voice.js';

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** The only fields an update may carry, per document. Anything else in the
 * request body is dropped, not stored — the difference between a whitelist
 * and a denylist is what happens to the field nobody thought of. */
const actorName = (user) =>
  user?.email || user?.preferred_username || user?.oid || user?.sub || 'editor';

const PROFILE_FIELDS = ['certifications', 'speakingTopics', 'interestAreas', 'wordSoup'];
const PROMPT_FIELDS = [
  'masterPrompt',
  'extraBannedPhrases',
  'styleRules',
  'publishThreshold',
  'autoForge',
];

export const MAX_WORD_SOUP_CHARS = 20000;
export const MAX_SUGGESTIONS = 20;

/** Calibration output, sanitized: short strings only, capped counts. */
export function normalizeSuggestions(raw = {}) {
  const list = (value, maxLen) =>
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .map((entry) => entry.slice(0, maxLen))
      .slice(0, MAX_SUGGESTIONS);
  return {
    generatedAt: String(raw.generatedAt || ''),
    postCount: Math.max(0, Number(raw.postCount) || 0),
    wordSoupAdditions: list(raw.wordSoupAdditions, 300),
    styleHints: list(raw.styleHints, 300),
    recurringPhrases: list(raw.recurringPhrases, 120),
  };
}

/**
 * @param {object} deps
 * @param {{ requireRole: Function }} deps.guard
 * @param {{ readDoc: Function, upsertDoc: Function }} deps.store
 * @param {{ clearForgeConfigCache: Function }} [deps.config] the pipeline's
 *   loader, so an update takes effect in this process immediately
 * @param {() => Date} [deps.now]
 * @param {() => string} [deps.uuid]
 */
export function createForgeStudioHandlers({
  guard,
  store,
  config = null,
  now = () => new Date(),
  uuid = () => crypto.randomUUID(),
}) {
  const readConfigDoc = (id) => store.readDoc('admin_config', id, ADMIN_CONFIG_PARTITION);

  async function audit(action, user, details) {
    await store.upsertDoc('admin_audit_logs', {
      id: uuid(),
      action,
      userId: user?.oid || user?.sub || null,
      userEmail: user?.email || user?.preferred_username || null,
      timestamp: now().toISOString(),
      details,
    });
  }

  /** GET/POST /api/getForgeConfig */
  async function getForgeConfig(request) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;

    const [profileRaw, promptsRaw, statsRaw] = await Promise.all([
      readConfigDoc('forge_profile').catch(() => null),
      readConfigDoc('forge_prompts').catch(() => null),
      readConfigDoc('forge_stats').catch(() => null),
    ]);

    return json(200, {
      ok: true,
      profile: normalizeProfile(profileRaw || {}),
      suggestions: normalizeSuggestions(profileRaw?.suggestions || {}),
      prompts: normalizePrompts(promptsRaw || {}),
      // Read-only context: what the rotation can pick, and what it has done.
      formats: FORMAT_LIBRARY.map((format) => ({
        key: format.key,
        label: format.label,
        wordRange: format.wordRange,
      })),
      stats: {
        totals: statsRaw?.totals || {},
        formats: statsRaw?.formats || {},
        updatedAt: statsRaw?.updatedAt || null,
      },
    });
  }

  /** POST /api/updateForgeConfig — { profile?, prompts?, clearSuggestions? } */
  async function updateForgeConfig(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || (!body.profile && !body.prompts)) {
      return json(400, { ok: false, error: 'Provide profile and/or prompts fields to update.' });
    }
    const changed = { profile: [], prompts: [] };
    try {
      if (body.profile && typeof body.profile === 'object') {
        const current = (await readConfigDoc('forge_profile')) || {};
        const merged = { ...current };
        for (const field of PROFILE_FIELDS) {
          if (field in body.profile) {
            merged[field] = body.profile[field];
            changed.profile.push(field);
          }
        }
        if ('wordSoup' in body.profile) {
          merged.wordSoup = String(body.profile.wordSoup || '').slice(0, MAX_WORD_SOUP_CHARS);
        }
        // Accepting or dismissing calibration chips trims the suggestion
        // list; the job is the only writer that ever grows it.
        if (body.clearSuggestions === true) {
          merged.suggestions = null;
          changed.profile.push('suggestions:cleared');
        } else if (Array.isArray(body.profile.suggestionsKept)) {
          merged.suggestions = normalizeSuggestions({
            ...(current.suggestions || {}),
            wordSoupAdditions: body.profile.suggestionsKept,
          });
          changed.profile.push('suggestions:trimmed');
        }
        const normalized = normalizeProfile(merged);
        // merged.suggestions is authoritative here: it starts as the current
        // value and clearSuggestions sets it to null DELIBERATELY, so no
        // nullish fallback to the old value.
        await store.upsertDoc('admin_config', {
          ...current,
          ...normalized,
          suggestions: 'suggestions' in merged ? merged.suggestions : null,
          id: 'forge_profile',
          configScope: ADMIN_CONFIG_PARTITION,
          updatedAt: now().toISOString(),
          updatedBy: actorName(auth.user),
        });
      }

      if (body.prompts && typeof body.prompts === 'object') {
        const current = (await readConfigDoc('forge_prompts')) || {};
        const merged = { ...current };
        for (const field of PROMPT_FIELDS) {
          if (field in body.prompts) {
            merged[field] = body.prompts[field];
            changed.prompts.push(field);
          }
        }
        const normalized = normalizePrompts(merged);
        normalized.version = (Number(current.version) || 0) + 1;
        await store.upsertDoc('admin_config', {
          ...current,
          ...normalized,
          id: 'forge_prompts',
          configScope: ADMIN_CONFIG_PARTITION,
          updatedAt: now().toISOString(),
          updatedBy: actorName(auth.user),
        });
      }
    } catch (error) {
      context?.error?.(`[updateForgeConfig] ${error?.message || error}`);
      return json(502, { ok: false, error: String(error?.message || error) });
    }

    config?.clearForgeConfigCache?.();
    await audit('forge_config_updated', auth.user, changed).catch(() => {});
    return getForgeConfig(request);
  }

  return { getForgeConfig, updateForgeConfig };
}

const CALIBRATION_PROMPT = `You are analysing a set of published articles by one author to help them tune an AI writing profile that must sound exactly like them. Study the writing itself: sentence rhythm, vocabulary, recurring analogies, opinions they keep returning to, how they open and close, what they never say.

Return strict JSON with keys:
- wordSoupAdditions: array of short third-person notes (max 15) capturing the author's perspective, recurring themes, opinions and domain anchors, each usable verbatim inside a "who this author is" context block.
- styleHints: array of short imperative style rules (max 10) an AI drafter should follow to sound like this author (e.g. sentence length habits, how they use examples, what they avoid).
- recurringPhrases: array of short phrases (max 10) the author genuinely reuses, worth keeping available.

Base every entry ONLY on the supplied articles. No generic writing advice. No code fences, only raw JSON.`;

/**
 * The voice-calibration job body (registered in functions/forge-jobs.js).
 * Reads the owner's most recent published posts, asks one model call for
 * profile suggestions, and writes them to forge_profile.suggestions — and
 * nothing else. A test pins that invariant.
 *
 * @param {{ postCount?: number }} payload
 * @param {object} deps — { store, ai, now, log }
 */
export async function runVoiceCalibration(payload, { store, ai, now = () => new Date(), log = {} }) {
  const postCount = Math.max(3, Math.min(15, Number(payload?.postCount) || 10));
  const posts = await store.queryDocs(
    'content',
    'SELECT TOP @n c.Title, c.blogDraft, c.content, c.Content, c.postContent FROM c WHERE c.Live = true ORDER BY c.publishedAt DESC',
    [{ name: '@n', value: postCount }]
  );
  const bodies = (posts || [])
    .map((post) => {
      const text = String(post.blogDraft || post.content || post.Content || post.postContent || '');
      return text ? `## ${post.Title || 'Untitled'}\n\n${text.slice(0, 6000)}` : '';
    })
    .filter(Boolean);
  if (bodies.length === 0) {
    throw new Error('No published posts with a body to calibrate from.');
  }

  const parsed = await ai.generateJsonResponse({
    prompt: `${CALIBRATION_PROMPT}\n\nArticles (${bodies.length}):\n\n${bodies.join('\n\n---\n\n')}`,
    purpose: 'analysis',
    feature: 'voiceCalibration',
  });

  const suggestions = normalizeSuggestions({
    ...parsed,
    generatedAt: now().toISOString(),
    postCount: bodies.length,
  });

  const current = (await store.readDoc('admin_config', 'forge_profile', ADMIN_CONFIG_PARTITION)) || {
    id: 'forge_profile',
  };
  await store.upsertDoc('admin_config', {
    ...current,
    id: 'forge_profile',
    configScope: ADMIN_CONFIG_PARTITION,
    suggestions,
  });
  log.log?.(
    `[voice-calibration] ${bodies.length} posts → ${suggestions.wordSoupAdditions.length} additions, ${suggestions.styleHints.length} hints`
  );
  return suggestions;
}
