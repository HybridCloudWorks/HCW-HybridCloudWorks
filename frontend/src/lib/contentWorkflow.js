import { postJSON } from '@/lib/api';

export async function unpublishToInspected(contentId, currentStatus, reviewNotes) {
  return postJSON('unpublishContentToInspected', {
    contentId,
    currentStatus,
    reviewNotes,
  });
}

export async function requestContentInspection(contentId) {
  return postJSON('requestContentInspection', { contentId });
}

export async function saveContentSchedule({
  contentId,
  instantPublish = true,
  scheduledPublishDate = null,
  publishTarget = null,
}) {
  return postJSON('saveContentSchedule', {
    contentId,
    instantPublish,
    scheduledPublishDate,
    publishTarget,
  });
}

export async function resetContentReviewState(contentId) {
  return postJSON('resetContentReviewState', { contentId });
}
