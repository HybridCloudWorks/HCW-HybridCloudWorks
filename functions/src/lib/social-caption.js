/**
 * social-caption.js — `generateSocialCaption` (the last unimplemented social
 * RPC; api-surface.json carried it in notImplemented since the import) and
 * the caption core the on-publish auto-queue trigger shares.
 *
 * The caption is written to be posted by a person: hook first, concrete,
 * no engagement-bait, at most two hashtags. The article link is appended by
 * the CALLER (SocialHubPage composes `caption\n\nurl`; the trigger does the
 * same) so the model never invents or mangles a URL.
 */

export const CAPTION_MAX_CHARS = 900;

export function buildCaptionPrompt({ title, summary, platforms = [] }) {
  const platformNote = platforms.length
    ? `It will be posted to: ${platforms.join(', ')}.`
    : 'It will be posted to professional social networks.';
  return `Write a short social-media caption announcing this article. ${platformNote}

Rules:
- First line is the hook: the article's sharpest concrete point, not "New blog post".
- 2 to 4 short lines total, under ${CAPTION_MAX_CHARS} characters.
- Sound like a practitioner sharing something useful, never like marketing.
- No emojis walls, no "link in bio", no engagement bait, no invented facts.
- At most two hashtags, only if they are genuinely standard for the topic.
- Do NOT include any URL — the link is appended separately.

Article title: ${title}
Article summary: ${summary}

Reply with the caption text only.`;
}

/**
 * The shared core: one model call, feature-gated as socialCaption.
 * @returns {Promise<string>} the caption (trimmed, capped)
 */
export async function generateCaptionText({ ai }, { title = '', summary = '', platforms = [] }) {
  const caption = await ai.generateTextResponse({
    prompt: buildCaptionPrompt({ title, summary, platforms }),
    purpose: 'general',
    feature: 'socialCaption',
  });
  return String(caption || '')
    .trim()
    .slice(0, CAPTION_MAX_CHARS);
}

const json = (status, body) => ({
  status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * POST /api/generateSocialCaption — { contentId?, title, summary, sourceUrl?,
 * platforms? } → { success, caption }. Title and summary come from the
 * caller's already-loaded content row (SocialHubPage sends both); when only a
 * contentId is sent, the document is read so the Telegram/portal callers can
 * stay thin.
 */
export function createSocialCaptionHandlers({ guard, store, ai }) {
  async function generateSocialCaption(request, context) {
    const auth = await guard.requireRole(request, 'editor');
    if (auth.error) return auth.error;
    try {
      const body = (await request.json().catch(() => null)) || {};
      let { title = '', summary = '' } = body;
      const platforms = Array.isArray(body.platforms) ? body.platforms.map(String) : [];

      if ((!title || !summary) && body.contentId) {
        const doc = await store.readDoc('content', String(body.contentId), String(body.contentId));
        title = title || doc?.Title || doc?.title || '';
        summary = summary || doc?.Summary || doc?.summary || '';
      }
      if (!String(title).trim() && !String(summary).trim()) {
        return json(400, { error: 'title or summary (or a resolvable contentId) required' });
      }

      const caption = await generateCaptionText({ ai }, { title, summary, platforms });
      if (!caption) return json(502, { error: 'Caption generation returned nothing' });
      return json(200, { success: true, caption });
    } catch (error) {
      context.error('generateSocialCaption failed:', error);
      return json(500, {
        error: 'Failed to generate caption',
        message: error?.message || 'Unknown error',
      });
    }
  }
  return { generateSocialCaption };
}
