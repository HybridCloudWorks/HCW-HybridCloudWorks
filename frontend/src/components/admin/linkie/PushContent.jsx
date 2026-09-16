/**
 * Push Published Content — the right column of the Links tab (#577).
 *
 * A live page becomes a Linkie post with its title, its public URL and its
 * cover image. Split out because it is a second, independent way to create the
 * same thing: its own list, its own busy state, and nothing shared with the
 * form beside it except the profile they both write to.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, ExternalLink, Loader2, Send } from 'lucide-react';
import { getLiveUrl } from './linkieView';

/**
 * `posts` and `loading` are both needed, and for one reason: `posts` is `[]`
 * while the fetch is in flight, so "already linked" cannot be told apart from
 * "not answered yet" without the flag. Pushing on a stale empty list creates
 * duplicates, which is what the disabled state prevents.
 */

/**
 * One published page, with the Push that adds it.
 *
 * `posts` is `[]` while the fetch is in flight, so "already linked" cannot be
 * told apart from "not answered yet" without `loading` — and lighting up Push
 * on an article already in Linkie lets a fast operator create duplicates.
 * Caught in review on #429.
 */
/**
 * Whether Push can run for one page, and what to say when it cannot.
 *
 * `posts` is `[]` while the fetch is in flight, so "already linked" cannot be
 * told apart from "not answered yet" without `loading` — and lighting up Push
 * on an article already in Linkie lets a fast operator create duplicates.
 * Caught in review on #429.
 */
function pushState({ item, url, canWrite, posts, loading, profileNotice, pushingId }) {
  const alreadyLinked = posts.some((post) => post.url === url);
  const pushing = pushingId === item.id;
  let title;
  if (!canWrite) title = profileNotice || 'No Linkie profile selected';
  else if (loading) title = 'Checking what is already linked…';
  return {
    alreadyLinked,
    pushing,
    title,
    disabled: !url || !canWrite || loading || alreadyLinked || pushing,
  };
}

/** The Push button's icon: in flight, already linked, or ready to send. */
function PushIcon({ pushing, alreadyLinked }) {
  if (pushing) return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (alreadyLinked) return <CheckCircle className="h-3.5 w-3.5" />;
  return <Send className="h-3.5 w-3.5" />;
}

function PushRow({ item, canWrite, posts, loading, profileNotice, pushingId, onPush }) {
  const title = item.Title || item.title || 'Untitled';
  const url = getLiveUrl(item);
  const push = pushState({ item, url, canWrite, posts, loading, profileNotice, pushingId });

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border hover:bg-muted/50">
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
        variant={push.alreadyLinked ? 'outline' : 'default'}
        className="gap-1.5 shrink-0"
        disabled={push.disabled}
        title={push.title}
        onClick={() => onPush(item)}
      >
        <PushIcon pushing={push.pushing} alreadyLinked={push.alreadyLinked} />
        {push.alreadyLinked ? 'Linked' : 'Push'}
      </Button>
    </div>
  );
}

export default function PushContent({
  recentContent,
  canWrite,
  pushingId,
  posts,
  loading,
  profileNotice,
  onPush,
}) {
  return (
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
        {recentContent.map((item) => (
          <PushRow
            key={item.id}
            item={item}
            canWrite={canWrite}
            posts={posts}
            loading={loading}
            profileNotice={profileNotice}
            pushingId={pushingId}
            onPush={onPush}
          />
        ))}
      </div>
    </div>
  );
}
