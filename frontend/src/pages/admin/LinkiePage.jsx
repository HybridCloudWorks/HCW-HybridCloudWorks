/**
 * Linkie Hub - manage Linkie posts, view analytics, push published content.
 *
 * All Linkie API calls route through the `linkieProxy` Azure Function
 * (LINKIE_API_KEY lives in Azure Key Vault - never in the client bundle).
 *
 * ===========================================================================
 * WHY THIS PAGE WAS REWRITTEN
 * ===========================================================================
 * Four of its six calls went to endpoints that do not exist: `/links`,
 * `/links/:id` (POST, PUT and DELETE) and `/analytics`. The Links and
 * Analytics tabs could never have worked. `linkieProxy`'s allowlist is the
 * only reason they failed loudly — `/links is not an allowed Linkie endpoint`
 * — rather than silently.
 *
 * The allowlist was right and this page was wrong. Linkie has no top-level
 * link or analytics resource: links are profile-scoped POSTS and analytics is
 * `/analytics/traffic-stats`. The real shapes, and where each is proven, are
 * documented in `@/lib/linkie` — which also holds every pure part of this
 * page, because the mapping is what was got wrong and a mapping in a component
 * is a mapping nobody tests.
 *
 * Two consequences worth stating rather than hiding:
 *
 *   - REORDER AND HIDE ARE GONE. Both sent `PUT /links/:id` with `position` or
 *     `disabled`. Linkie's posts API has neither field and no ordering
 *     endpoint; the controls were operating on a resource that does not exist.
 *   - EDIT NOW CHANGES ONLY THE URL. `PATCH /profiles/:id/posts/:postId`
 *     accepts `url` and nothing else.
 *
 * Required Azure Function App setting (prefer a Key Vault reference):
 *   LINKIE_API_KEY - Linkie Admin API key
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuthReady } from '@/hooks/useAuthReady';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import ServicePageHeader from '@/components/admin/ServicePageHeader';
import {
  Link2,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  ExternalLink,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  BarChart3,
  Send,
} from 'lucide-react';
import { postJSON, getJSON } from '@/lib/api';
import {
  EMPTY_POST_FORM,
  LINKIE_POST_TYPES,
  LINKIE_PROVIDERS,
  buildPostPayload,
  contentItemPostPayload,
  createPostsBody,
  describeLinkieFailure,
  extractPosts,
  extractProfiles,
  extractTrafficStats,
  linkiePaths,
  profileLabel,
  readLinkieBody,
  selectProfile,
  trafficStatCards,
  unwrapLinkie,
  validatePostForm,
} from '@/lib/linkie';

const TABS = [
  { id: 'links', label: 'Links' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'connection', label: 'Connection' },
];

// ── Linkie proxy wrappers ─────────────────────────────────────────────────────
// One call each, named after the endpoint it reaches, so a path that does not
// exist cannot hide behind a plausible function name the way `ltListLinks` did.

const linkieFetch = (path, method = 'GET', body) => postJSON('linkieProxy', { path, method, body });

const ltGetProfiles = () => linkieFetch(linkiePaths.profiles());
const ltListPosts = (profileId) => linkieFetch(linkiePaths.posts(profileId));
const ltCreatePost = (profileId, post) =>
  linkieFetch(linkiePaths.posts(profileId), 'POST', createPostsBody(post));
const ltUpdatePostUrl = (profileId, postId, url) =>
  linkieFetch(linkiePaths.post(profileId, postId), 'PATCH', { url });
const ltDeletePost = (profileId, postId) =>
  linkieFetch(linkiePaths.post(profileId, postId), 'DELETE');
const ltGetTrafficStats = (linkInBioId) => linkieFetch(linkiePaths.trafficStats(linkInBioId));

// ── Published content helpers (same rule as SocialHubPage) ───────────────────

function isLiveRecord(item) {
  const status = String(item?.contentStatus || '');
  if (item?.softDeletedAt || item?.softDeleteExpiresAt) return false;
  return item?.Live === true || item?.Status === 'Live' || status.startsWith('published_');
}

function getLiveUrl(item) {
  return (
    item.slugPageUrl ||
    item.publishedUrl ||
    item.blogUrl ||
    item.publicUrl ||
    (item.curatedSubpagePath
      ? `https://hybridcloudworks.com${String(item.curatedSubpagePath).startsWith('/') ? item.curatedSubpagePath : `/${item.curatedSubpagePath}`}`
      : '')
  );
}

// ── Links Tab ─────────────────────────────────────────────────────────────────

function LinksTab({ recentContent, profileId, profileNotice }) {
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
  const posts = loading ? [] : result.posts;
  const error = loading ? '' : result.error;

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
      readLinkieBody(await ltCreatePost(profileId, contentItemPostPayload({ title, url })));
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
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={busyId !== null || !canWrite}
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
            const alreadyLinked = posts.some((post) => post.url === url);
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
                  disabled={!url || !canWrite || alreadyLinked || pushingId === item.id}
                  title={canWrite ? undefined : profileNotice || 'No Linkie profile selected'}
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

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ profileId, profileNotice }) {
  const [reloadToken, setReloadToken] = useState(0);
  // Same shape as the Links tab, for the same reason: loading is derived from
  // the settled request's key, never set synchronously in the effect body.
  const [result, setResult] = useState({ key: '', analytics: null, error: '' });

  useEffect(() => {
    if (!profileId) return undefined;
    let cancelled = false;
    const key = `${profileId}#${reloadToken}`;
    // Linkie's analytics endpoint takes a `link_in_bio_id`. The profile's own
    // `_id` is what Site-Main sends for it, and is the closest identifier this
    // API exposes — see the note in the PR: it is the one shape here that
    // repository evidence does not fully settle.
    ltGetTrafficStats(profileId)
      .then((response) => {
        if (cancelled) return;
        const unwrapped = unwrapLinkie(response);
        if (unwrapped.notConfigured || unwrapped.failed) {
          const reason = unwrapped.notConfigured
            ? unwrapped.reason
            : describeLinkieFailure(unwrapped);
          setResult({ key, analytics: null, error: reason });
          return;
        }
        // The whole envelope is kept, not just the body: the "Raw analytics
        // response" panel is the operator's only view of what Linkie actually
        // sent, and the upstream status belongs in it.
        setResult({ key, analytics: response, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, analytics: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadToken]);

  const requestKey = profileId ? `${profileId}#${reloadToken}` : '';
  const loading = Boolean(profileId) && result.key !== requestKey;
  const analytics = loading ? null : result.analytics;
  const error = loading ? '' : result.error;

  if (!profileId) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{profileNotice || 'No Linkie profile selected — check the Connection tab.'}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => setReloadToken((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const stats = trafficStatCards(extractTrafficStats(analytics));

  return (
    <div className="space-y-4 max-w-3xl">
      {stats.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map(({ label, value }) => (
            <Card key={label} className="p-4 text-center">
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <BarChart3 className="h-6 w-6 mx-auto mb-2 opacity-60" />
          Analytics connected, but no summary metrics were returned.
        </Card>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw analytics response</summary>
        <pre className="mt-2 p-3 rounded-lg bg-muted overflow-auto max-h-80">
          {JSON.stringify(analytics, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ── Connection Tab ────────────────────────────────────────────────────────────

function ConnectionTab({ onStatusChange }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null); // { ok, message, profile? }

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await ltGetProfiles();
      // `/profiles` was already the right endpoint, so this test has always
      // worked — but it read a resolved not-ok envelope as success. A refused
      // key now says so.
      const profile = readLinkieBody(response);
      const profiles = extractProfiles(response);
      setResult({
        ok: true,
        message: `Connected to the Linkie API — ${profiles.length} profile${profiles.length === 1 ? '' : 's'}.`,
        profile,
      });
      onStatusChange?.(true);
    } catch (err) {
      setResult({ ok: false, message: err.message });
      onStatusChange?.(false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linkie API Connection</CardTitle>
          <CardDescription>
            The LINKIE_API_KEY is stored in Azure Key Vault and used server-side by the linkieProxy
            Azure Function - it is never sent to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
            The button and the link share a flex row. `space-y-4` sets
            margin-top on a following sibling, and both render as `inline-flex`
            — so with no result panel between them they land on the same line
            with no separation at all. The result panel stays outside the row,
            as its own block child, because it is a full-width message.
          */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button onClick={handleTest} disabled={testing} className="gap-2">
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Test Connection
            </Button>
            <a
              href="https://linkie.bio/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Manage your Linkie <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          {result && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${
                result.ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {result.ok ? (
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p>{result.message}</p>
                {result.ok && result.profile && (
                  <pre className="mt-2 text-xs text-muted-foreground overflow-auto max-h-40">
                    {JSON.stringify(result.profile, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LinkiePage() {
  const { authReady } = useAuthReady();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'links';
  const preferredProfileId = searchParams.get('profile') || '';
  const [connected, setConnected] = useState('checking');
  const [profiles, setProfiles] = useState([]);
  const [profileNotice, setProfileNotice] = useState('');

  const [recentContent, setRecentContent] = useState([]);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    getJSON('cms/content?limit=500')
      .then((res) => {
        if (cancelled) return;
        const live = (res.items || []).filter(isLiveRecord).filter((item) => getLiveUrl(item));
        setRecentContent(live.slice(0, 50));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  // Readiness probe AND the profile resolve, because they are the same call:
  // every posts and analytics path is profile-scoped, so nothing else on this
  // page can run until `/profiles` has answered.
  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    ltGetProfiles()
      .then((response) => {
        if (cancelled) return;
        const unwrapped = unwrapLinkie(response);
        if (unwrapped.notConfigured || unwrapped.failed) {
          setConnected(false);
          setProfiles([]);
          setProfileNotice(
            (unwrapped.notConfigured ? unwrapped.reason : describeLinkieFailure(unwrapped)) ||
              'Linkie could not be reached'
          );
          return;
        }
        const list = extractProfiles(response);
        setConnected(true);
        setProfiles(list);
        setProfileNotice(
          list.length === 0
            ? 'This Linkie API key owns no profiles — check the Connection tab.'
            : ''
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setConnected(false);
        setProfiles([]);
        setProfileNotice(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const selectedProfile = selectProfile(profiles, preferredProfileId);
  const profileId = selectedProfile?._id || null;

  const updateParams = (patch) => {
    const next = { tab: activeTab };
    if (preferredProfileId) next.profile = preferredProfileId;
    setSearchParams({ ...next, ...patch });
  };

  return (
    <div className="space-y-6">
      <ServicePageHeader
        icon={Link2}
        title="Linkie Hub"
        service="Linkie"
        connected={connected}
        description="Manage your Linkie posts, push published content, and review link analytics."
        accent="emerald"
      />

      {profiles.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs" htmlFor="linkie-profile">
            Profile
          </Label>
          <select
            id="linkie-profile"
            value={profileId || ''}
            onChange={(e) => updateParams({ profile: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {profiles.map((profile) => (
              <option key={profile._id} value={profile._id}>
                {profileLabel(profile)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Posts and analytics are scoped to this profile.
          </span>
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => updateParams({ tab: id })}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === 'links' && (
          <LinksTab
            recentContent={recentContent}
            profileId={profileId}
            profileNotice={profileNotice}
          />
        )}
        {activeTab === 'analytics' && (
          <AnalyticsTab profileId={profileId} profileNotice={profileNotice} />
        )}
        {activeTab === 'connection' && <ConnectionTab onStatusChange={setConnected} />}
      </div>
    </div>
  );
}
