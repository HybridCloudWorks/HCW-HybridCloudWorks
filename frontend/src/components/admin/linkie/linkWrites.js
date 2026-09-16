/**
 * The Links tab's four writes (#577).
 *
 * Module-level over one state bag, each with a single exit. Qlty counts a
 * closure's branches into the function that holds it, so handlers defined
 * inside the component were the component's complexity — the same shape #623
 * fixed on ComposeTab and #576 on PlaudRecordingCard.
 *
 * Every one of them reads the proxy's body through `readLinkieBody`, which is
 * what turns a 200-with-`ok:false` into a throw: the proxy answers HTTP 200
 * whatever Linkie said, so without it a refused write would toast success.
 */
import {
  EMPTY_POST_FORM,
  buildPostPayload,
  contentItemPostPayload,
  readLinkieBody,
  validatePostForm,
} from '@/lib/linkie';
import { ltCreatePost, ltDeletePost, ltUpdatePostUrl } from './linkieApi';
import { contentCoverImage, getLiveUrl } from './linkieView';

/** Add the post the form describes. Refuses while an image upload is in flight. */
export async function submitPost(state, uploadingImage) {
  const problem = validatePostForm(state.form) || (uploadingImage ? 'Image still uploading' : '');
  if (problem) {
    state.toast({ title: problem, variant: 'destructive' });
    return;
  }
  state.setBusyId('new');
  try {
    readLinkieBody(await ltCreatePost(state.profileId, buildPostPayload(state.form)));
    state.toast({ title: 'Added to Linkie' });
    state.setForm(EMPTY_POST_FORM);
    state.reload();
  } catch (err) {
    state.toast({ title: 'Add failed', description: err.message, variant: 'destructive' });
  } finally {
    state.setBusyId(null);
  }
}

export async function saveUrl(state, postId, url) {
  if (!url.trim()) {
    state.toast({ title: 'URL required', variant: 'destructive' });
    return;
  }
  state.setBusyId(postId);
  try {
    readLinkieBody(await ltUpdatePostUrl(state.profileId, postId, url));
    state.toast({ title: 'URL updated' });
    state.setEditingId(null);
    state.reload();
  } catch (err) {
    state.toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
  } finally {
    state.setBusyId(null);
  }
}

export async function deletePost(state, postId) {
  state.setBusyId(postId);
  try {
    readLinkieBody(await ltDeletePost(state.profileId, postId));
    state.dropPost(postId);
    state.toast({ title: 'Removed from Linkie' });
  } catch (err) {
    state.toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
  } finally {
    state.setBusyId(null);
  }
}

/** A published page as a Linkie post: its title, its public URL, its cover. */
export async function pushContent(state, item) {
  const url = getLiveUrl(item);
  const title = item.Title || item.title || 'Untitled';
  if (!url) {
    state.toast({ title: 'No public URL for this item', variant: 'destructive' });
    return;
  }
  state.setPushingId(item.id);
  try {
    const imageUrl = contentCoverImage(item);
    readLinkieBody(
      await ltCreatePost(state.profileId, contentItemPostPayload({ title, url, imageUrl }))
    );
    state.toast({ title: 'Pushed to Linkie', description: title });
    state.reload();
  } catch (err) {
    state.toast({ title: 'Push failed', description: err.message, variant: 'destructive' });
  } finally {
    state.setPushingId(null);
  }
}
