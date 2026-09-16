/**
 * Queue — what Publer is holding to post, and the hub's own records of it
 * (#575). Its one duty is the schedule that has not happened yet.
 *
 * Two lists, because they can disagree: Publer's queue is the truth about what
 * will publish, and the local `social_posts` records are what this hub believes
 * it scheduled. A post deleted in Publer's own UI leaves a record here, which
 * is the point of showing both.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { AlertCircle, CheckCircle, Clock, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import {
  deleteSocialPostDoc,
  listSocialPosts,
  publerCallFailed,
  publerDeletePost,
  publerListPosts,
  readPublerPosts,
} from './publerApi';
import { firstText, fmtDate } from './socialView';
import { PlatformBadge } from './shared';

/** One post Publer is holding, with the delete that removes it there. */
function PublerQueueCard({ post, deleting, onDelete }) {
  const text = firstText([post.caption, post.text, post.description], '—');
  const provider = firstText([post.network, post.provider]);
  const accts = Array.isArray(post.accounts) ? post.accounts : [];
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-2">{text}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {provider && <PlatformBadge provider={provider} />}
            {accts.map((a, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">
                {firstText([a?.name, a?.id], 'account')}
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmtDate(post.scheduled_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="capitalize text-[10px]">
            {firstText([post.status, post.state], 'scheduled')}
          </Badge>
          <DeleteButton disabled={!post.id} busy={deleting} onClick={() => onDelete(post.id)} />
        </div>
      </div>
    </Card>
  );
}

/** One social_posts record this hub wrote when it scheduled something. */
function LocalRecordCard({ post, deleting, onDelete }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium line-clamp-2">{post.caption || '—'}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {(post.platforms || []).map((platform) => (
              <PlatformBadge key={platform} provider={platform} />
            ))}
            {post.scheduledAt && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {fmtDate(post.scheduledAt)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="secondary"
            className={`capitalize text-[10px] ${
              post.status === 'published'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : ''
            }`}
          >
            {post.status || 'scheduled'}
          </Badge>
          <DeleteButton busy={deleting} onClick={() => onDelete(post.id)} />
        </div>
      </div>
    </Card>
  );
}

/** The trash button both cards use, spinner and all. */
function DeleteButton({ busy, disabled = false, onClick }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-destructive hover:bg-destructive/10"
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
    </Button>
  );
}

export default function QueueTab() {
  const { toast } = useToast();

  const [publerPosts, setPublerPosts] = useState([]);
  const [publerNotice, setPublerNotice] = useState('');
  const [localPosts, setLocalPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [publerRes, snap] = await Promise.all([
        publerListPosts('scheduled').catch(publerCallFailed),
        listSocialPosts(),
      ]);
      const { posts, notice } = readPublerPosts(publerRes);
      setPublerPosts(posts);
      setPublerNotice(notice);
      setLocalPosts(Array.isArray(snap) ? snap : []);
    } catch (err) {
      // A failed read empties both lists rather than leaving rows beside an
      // error saying they could not be read (#555).
      setPublerPosts([]);
      setLocalPosts([]);
      setError(err?.message || 'Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      load();
    });
  }, [load]);

  const refresh = () => {
    setLoading(true);
    load();
  };

  const handleDeletePubler = async (postId) => {
    // Ignore a second click while the first delete is unanswered rather than
    // sending it twice (#555).
    if (deletingId) return;
    setDeletingId(postId);
    try {
      await publerDeletePost(postId);
      setPublerPosts((prev) => prev.filter((p) => p.id !== postId));
      toast({ title: 'Post deleted from Publer' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteLocal = async (docId) => {
    if (deletingId) return;
    setDeletingId(docId);
    try {
      await deleteSocialPostDoc(docId);
      setLocalPosts((prev) => prev.filter((p) => p.id !== docId));
      toast({ title: 'Post record removed' });
    } catch (err) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-8 gap-3 text-destructive">
        <AlertCircle className="h-6 w-6" />
        <p className="text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    );
  }

  const totalPubler = publerPosts.length;
  const totalLocal = localPosts.length;

  return (
    <div className="space-y-6">
      {/* Publer live queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Publer Queue
            {totalPubler > 0 && (
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {totalPubler}
              </Badge>
            )}
          </h3>
          <Button variant="ghost" size="sm" onClick={refresh} className="gap-1.5 h-7">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        {publerNotice && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {publerNotice}
          </p>
        )}

        {!publerNotice && totalPubler === 0 && (
          <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
            <p className="text-sm font-medium">No scheduled posts in Publer</p>
          </div>
        )}

        {publerPosts.map((post, index) => (
          <PublerQueueCard
            key={post.id ?? `publer-${index}`}
            post={post}
            deleting={deletingId === post.id}
            onDelete={handleDeletePubler}
          />
        ))}
      </div>

      {/* Local social-post records */}
      {totalLocal > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Local Records
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {totalLocal}
            </Badge>
          </h3>
          {localPosts.map((post) => (
            <LocalRecordCard
              key={post.id}
              post={post}
              deleting={deletingId === post.id}
              onDelete={handleDeleteLocal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
