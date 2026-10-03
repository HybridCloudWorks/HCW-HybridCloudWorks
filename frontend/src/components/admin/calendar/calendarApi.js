/**
 * The Calendar's writes (ADR 0033 Amplify slice). Thin, named, and all in
 * one place so the page's actions read as what they do to the record.
 */
import { postJSON, sendJSON } from '@/lib/api';
import { saveContentSchedule } from '@/lib/contentWorkflow';

/** Schedule or move a content item: the existing publisher RPC, which also approves it. */
export function scheduleContent({ contentId, when, publishTarget = null }) {
  return saveContentSchedule({
    contentId,
    instantPublish: false,
    scheduledPublishDate: when.toISOString(),
    publishTarget,
  });
}

/** Clear a content schedule; the status stays. */
export function unscheduleContent(contentId) {
  return postJSON('unscheduleContent', { contentId });
}

/** Move or edit a social post record; the change feed pushes it to Publer. */
export function patchSocialPost(id, body) {
  return sendJSON(`cms/social-posts/${encodeURIComponent(id)}`, 'PATCH', body);
}

/** Delete a social post record and, best-effort, its Publer post. */
export function deleteSocialPost(id) {
  return sendJSON(`cms/social-posts/${encodeURIComponent(id)}`, 'DELETE');
}
