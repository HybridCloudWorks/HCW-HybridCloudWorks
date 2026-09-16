/**
 * Links — the posts on the Linkie profile, and the two ways to add one (#577).
 *
 * A post is either written here by hand, or pushed from a published page on the
 * site. Both end up as the same Linkie post; the difference is only where the
 * title, URL and image come from.
 *
 * `profileNotice` is the sentence to show when there is no profile to work
 * against — the tab renders it in place of the form rather than an empty state,
 * because "no posts" and "no profile" are different problems.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  EMPTY_POST_FORM,
  LINKIE_POST_TYPES,
  LINKIE_PROVIDERS,
  buildPostPayload,
  contentItemPostPayload,
  describeLinkieFailure,
  extractPostImage,
  extractPosts,
  readLinkieBody,
  unwrapLinkie,
  validatePostForm,
  visibleLinksState,
} from '@/lib/linkie';
import { ltCreatePost, ltDeletePost, ltListPosts, ltUpdatePostUrl } from './linkieApi';
import { contentCoverImage, getLiveUrl } from './linkieView';
import PostImageField from './PostImageField';

export default function LinksTab({ recentContent, profileId, profileNotice }) {
  const { toast } = useToast();
  const [reloadToken, setReloadToken] = useState(0);
  // One settled result, tagged with the request that produced it. `loading` is
  // DERIVED from that tag rather than set at the top of the effect: a
  // synchronous setState in an effect body is a cascading render, and the
  // React Compiler lint (react-hooks/set-state-in-effect) rejects it.
  const [result, setResult] = useState({ key: '', posts: [], error: '' });
  const [busyId, setBusyId] = useState(null); // post _id (or 'new') currently saving
  const [form, setForm] = useState(EMPTY_POST_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editingUrl, setEditingUrl] = useState('');
  const [pushingId, setPushingId] = useState(null);
  // Lifted out of PostImageField so Add Post can wait for an upload in flight.
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    if (!profileId) return undefined;
    let cancelled = false;
    const key = `${profileId}#${reloadToken}`;
    ltListPosts(profileId)
      .then((response) => {
        if (cancelled) return;
        // The proxy answers 200 whatever Linkie said, so `ok` is the only
        // signal. Without this branch a 401 renders as "No posts yet".
        const unwrapped = unwrapLinkie(response);
        if (unwrapped.notConfigured || unwrapped.failed) {
          const reason = unwrapped.notConfigured
            ? unwrapped.reason
            : describeLinkieFailure(unwrapped);
          setResult({ key, posts: [], error: reason });
          return;
        }
        setResult({ key, posts: extractPosts(response), error: '' });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, posts: [], error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadToken]);

  const requestKey = profileId ? `${profileId}#${reloadToken}` : '';
  const loading = Boolean(profileId) && result.key !== requestKey;
  const { posts, error } = visibleLinksState({ profileId, loading, result });

  const reload = () => setReloadToken((n) => n + 1);

  const handleSubmit = async () => {
    const problem = validatePostForm(form);
    if (problem) {
      toast({ title: problem, variant: 'destructive' });
      return;
    }
    setBusyId('new');
    try {
      readLinkieBody(await ltCreatePost(profileId, buildPostPayload(form)));
      toast({ title: 'Added to Linkie' });
      setForm(EMPTY_POST_FORM);
      reload();
    } catch (err) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveUrl = async (postId) => {
    const url = editingUrl.trim();
    if (!url) {
      toast({ title: 'A URL is required', variant: 'destructive' });
      return;
    }
    setBusyId(postId);
    try {
      readLinkieBody(await ltUpdatePostUrl(profileId, postId, url));
      toast({ title: 'URL updated' });
      setEditingId(null);
      reload();
    } catch (err) {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (postId) => {
    setBusyId(postId);
    try {
      readLinkieBody(await ltDeletePost(profileId, postId));
      setResult((prev) => ({ ...prev, posts: prev.posts.filter((post) => post._id !== postId) }));
      toast({ title: 'Removed from Linkie' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const handlePushContent = async (item) => {
    const url = getLiveUrl(item);
    const title = item.Title || item.title || 'Untitled';
    if (!url) {
      toast({ title: 'No public URL for this item', variant: 'destructive' });
      return;
    }
    setPushingId(item.id);
    try {
      const imageUrl = contentCoverImage(item);
      readLinkieBody(
        await ltCreatePost(profileId, contentItemPostPayload({ title, url, imageUrl }))
      );
      toast({ title: 'Pushed to Linkie', description: title });
      reload();
    } catch (err) {
      toast({ title: 'Push failed', description: err.message, variant: 'destructive' });
    } finally {
      setPushingId(null);
    }
  };

  const canWrite = Boolean(profileId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a Post</CardTitle>
            <CardDescription className="text-xs">
              A Linkie post has no title. Its caption is the nearest field, so that is where an
              article headline goes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs" htmlFor="linkie-post-url">
                URL
              </Label>
              <Input
                id="linkie-post-url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://hybridcloudworks.com/…"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs" htmlFor="linkie-post-provider">
                  Provider
                </Label>
                <select
                  id="linkie-post-provider"
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {LINKIE_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs" htmlFor="linkie-post-type">
                  Post Type
                </Label>
                <select
                  id="linkie-post-type"
                  value={form.postType}
                  onChange={(e) => setForm((f) => ({ ...f, postType: e.target.value }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {LINKIE_POST_TYPES.map((postType) => (
                    <option key={postType} value={postType}>
                      {postType}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs" htmlFor="linkie-post-account">
                Account Name
              </Label>
              <Input
                id="linkie-post-account"
                value={form.accountName}
                onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="linkie-post-text">
                Text (caption)
              </Label>
              <Input
                id="linkie-post-text"
                value={form.text}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                placeholder="My latest article"
              />
            </div>
            <PostImageField
              imageUrl={form.imageUrl}
              onImageChange={(imageUrl) => setForm((f) => ({ ...f, imageUrl }))}
              uploading={uploadingImage}
              onUploadingChange={setUploadingImage}
            />
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={busyId !== null || !canWrite || uploadingImage}
              className="gap-1.5"
            >
              {busyId === 'new' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add Post
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Current Posts
            {posts.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {posts.length}
              </Badge>
            )}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={reload}
            disabled={!canWrite}
            className="gap-1.5 h-7"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {!canWrite && profileNotice && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{profileNotice}</span>
          </div>
        )}
        {canWrite && loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {canWrite && error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error} — check the Connection tab.</span>
          </div>
        )}
        {canWrite && !loading && !error && posts.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">No posts yet.</p>
        )}

        {posts.map((post, index) => {
          const isBusy = busyId === post._id;
          const isEditing = editingId === post._id;
          const postImage = extractPostImage(post);
          return (
            <Card key={post._id || index} className="p-3">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editingUrl}
                    onChange={(e) => setEditingUrl(e.target.value)}
                    className="flex-1"
                    aria-label="Post URL"
                  />
                  <Button size="sm" disabled={isBusy} onClick={() => handleSaveUrl(post._id)}>
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {/*
                    Rendered from whichever candidate key the post carries, so
                    the owner's real posts show which one Linkie uses (#501).
                  */}
                  {postImage && (
                    <img
                      src={postImage}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover border"
                      loading="lazy"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{post.text || post.provider}</p>
                    <p className="text-xs text-muted-foreground truncate">{post.url}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {post.provider} · {post.post_type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={isBusy || !post._id}
                      title="Edit URL — the only field Linkie lets you change"
                      onClick={() => {
                        setEditingId(post._id);
                        setEditingUrl(post.url || '');
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      disabled={isBusy || !post._id}
                      title="Delete"
                      onClick={() => handleDelete(post._id)}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Push Published Content</h3>
        <p className="text-xs text-muted-foreground">
          Add the public URL of a recently published page as a Linkie post.
        </p>
        {recentContent.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No published content found.
          </p>
        )}
        <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
          {recentContent.map((item) => {
            const title = item.Title || item.title || 'Untitled';
            const url = getLiveUrl(item);
            // `posts` is [] while the fetch is in flight, so alreadyLinked is
            // false for EVERYTHING until it settles — which would light up
            // Push on articles already in Linkie and let a fast operator
            // create duplicates. "Not answered yet" is not "not linked", so
            // the button waits for the answer. Caught in review on PR #429.
            const alreadyLinked = posts.some((post) => post.url === url);
            const cannotTellYet = loading;
            let pushTitle;
            if (!canWrite) pushTitle = profileNotice || 'No Linkie profile selected';
            else if (cannotTellYet) pushTitle = 'Checking what is already linked…';
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <p className="text-xs text-muted-foreground truncate">{url || 'No public URL'}</p>
                </div>
                {url && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={alreadyLinked ? 'outline' : 'default'}
                  className="gap-1.5 shrink-0"
                  disabled={
                    !url || !canWrite || cannotTellYet || alreadyLinked || pushingId === item.id
                  }
                  title={pushTitle}
                  onClick={() => handlePushContent(item)}
                >
                  {pushingId === item.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {pushingId !== item.id && alreadyLinked && (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  {pushingId !== item.id && !alreadyLinked && <Send className="h-3.5 w-3.5" />}
                  {alreadyLinked ? 'Linked' : 'Push'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
