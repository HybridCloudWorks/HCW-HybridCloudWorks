/**
 * Links — the posts on the Linkie profile, and the two ways to add one (#577).
 *
 * A post is either written here by hand (PostForm), or pushed from a published
 * page on the site (PushContent). Both end up as the same Linkie post; the
 * difference is only where the title, URL and image come from.
 *
 * `profileNotice` is the sentence to show when there is no profile to work
 * against — the tab renders it in place of the list rather than an empty state,
 * because "no posts" and "no profile" are different problems.
 *
 * This file is wiring and nothing else. The read is useLinkiePosts, the writes
 * are linkWrites, and the three panels are their own components: Qlty counts a
 * closure's branches into the function that holds it, so with the form and the
 * list inline this tab measured 20.
 */
import React, { useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { EMPTY_POST_FORM } from '@/lib/linkie';
import PostForm from './PostForm';
import PostList from './PostList';
import PushContent from './PushContent';
import useLinkiePosts from './useLinkiePosts';
import { deletePost, pushContent, saveUrl, submitPost } from './linkWrites';

export default function LinksTab({ recentContent, profileId, profileNotice }) {
  const { toast } = useToast();
  const { posts, error, loading, reload, dropPost } = useLinkiePosts(profileId);
  const [busyId, setBusyId] = useState(null); // post _id (or 'new') currently saving
  const [form, setForm] = useState(EMPTY_POST_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editingUrl, setEditingUrl] = useState('');
  const [pushingId, setPushingId] = useState(null);
  // Lifted out of PostImageField so Add Post can wait for an upload in flight.
  const [uploadingImage, setUploadingImage] = useState(false);

  const state = {
    toast,
    form,
    profileId,
    reload,
    dropPost,
    setForm,
    setBusyId,
    setPushingId,
    setEditingId,
  };

  const startEdit = (post) => {
    setEditingId(post._id);
    setEditingUrl(post.url || '');
  };

  const canWrite = Boolean(profileId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <PostForm
          form={form}
          setForm={setForm}
          busyId={busyId}
          canWrite={canWrite}
          uploadingImage={uploadingImage}
          onUploadingChange={setUploadingImage}
          onSubmit={() => submitPost(state, uploadingImage)}
        />

        <PostList
          posts={posts}
          loading={loading}
          error={error}
          canWrite={canWrite}
          profileNotice={profileNotice}
          busyId={busyId}
          editingId={editingId}
          editingUrl={editingUrl}
          onEditingUrlChange={setEditingUrl}
          onStartEdit={startEdit}
          onCancelEdit={() => setEditingId(null)}
          onSaveUrl={(postId) => saveUrl(state, postId, editingUrl)}
          onDelete={(postId) => deletePost(state, postId)}
          onReload={reload}
        />
      </div>

      <PushContent
        recentContent={recentContent}
        canWrite={canWrite}
        pushingId={pushingId}
        posts={posts}
        loading={loading}
        profileNotice={profileNotice}
        onPush={(item) => pushContent(state, item)}
      />
    </div>
  );
}
