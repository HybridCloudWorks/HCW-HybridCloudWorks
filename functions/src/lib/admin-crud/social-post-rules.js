/**
 * social-post-rules.js — what a social-post edit may change, and which
 * stored posts refuse one (ADR 0033 Amplify slice). Pure: the handlers are
 * in ./social-posts.js, and admin-crud.js re-exports the public names.
 */

export const SOCIAL_DEFAULT_STATUSES = ['scheduled', 'published'];
/** What PATCH may change on a social post; everything else is Publer's or the timer's. */
export const SOCIAL_EDITABLE = ['caption', 'url', 'scheduledAt'];
const MAX_CAPTION = 5000;

/** One editable field each: the cleaned value, or the sentence refusing it. */
const SOCIAL_FIELD_CLEANERS = {
  caption(value) {
    const caption = typeof value === 'string' ? value.trim() : '';
    if (!caption || caption.length > MAX_CAPTION) {
      return { error: `caption must be 1 to ${MAX_CAPTION} characters` };
    }
    return { value: caption };
  },
  url(value) {
    const url = value === null ? null : String(value).trim();
    if (url && !/^https?:\/\//i.test(url)) return { error: 'url must be absolute http(s)' };
    return { value: url || null };
  },
  scheduledAt(value, nowMs) {
    if (value === null) {
      return { error: 'scheduledAt cannot be cleared; delete the post to cancel it' };
    }
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return { error: 'scheduledAt must be an ISO instant' };
    if (when.getTime() <= nowMs) return { error: 'scheduledAt must be in the future' };
    return { value: when.toISOString() };
  },
};

/** The body of a social-post PATCH as `{ updates }`, or `{ error }` naming the first bad field. */
export function validateSocialPostPatch(body, nowMs) {
  const unknown = Object.keys(body).filter((key) => !SOCIAL_EDITABLE.includes(key));
  if (unknown.length) return { error: `Unknown field(s): ${unknown.join(', ')}` };
  const updates = {};
  for (const key of SOCIAL_EDITABLE) {
    if (body[key] === undefined) continue;
    const cleaned = SOCIAL_FIELD_CLEANERS[key](body[key], nowMs);
    if (cleaned.error) return cleaned;
    updates[key] = cleaned.value;
  }
  return { updates };
}

/** Why a stored post refuses this edit, or null. */
export function socialPostEditRefusal(existing, updates) {
  if (existing.status === 'published') return 'A published post cannot be edited or rescheduled.';
  if (updates.scheduledAt && existing.status !== 'scheduled') {
    return `Only a scheduled post can be rescheduled; this one is ${existing.status}.`;
  }
  return null;
}
