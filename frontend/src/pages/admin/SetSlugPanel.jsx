/**
 * "Slug" — the per-article URL control on the Publish page (#400).
 *
 * WHERE IT LIVES AND WHY. On PublishedPage's already-live list, inside the row
 * for the article being fixed. That list is where an operator goes to see what
 * is live and on what URL: every row already carries "View Live", the page
 * already owns the publish workflow, and the bulk image backfill already sits
 * on it. The editor at /admin/editor/:blogId was the alternative and is worse
 * for this job — it is about an article's body, it is reached by knowing an
 * id, and a URL collision is something you notice while looking across the
 * published set rather than while editing one article.
 *
 * WHAT IT SENDS. The raw input, to POST cms/content/slug. Normalisation is
 * `slugify` in functions/src/lib/cms/publish.js and there is no package shared
 * with this one, so a live client-side preview would mean a second copy of the
 * one function whose output IS the URL — which is the class of divergence that
 * caused #400 in the first place. The response names `requested` beside `slug`
 * instead, and this panel shows both whenever they differ, so an operator who
 * typed something loose sees exactly what was stored.
 *
 * WHAT COMES BACK is one atomic outcome, not two: the route sets the slug and
 * moves curatedSubpagePath / slugPageUrl / publishedUrl / publicUrl in a single
 * conditional patch. So there is no "half applied" state to render — every
 * response is a change, a truthful no-op, or a refusal that wrote nothing, and
 * all three are shown with their reason.
 */
import React, { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { postJSON } from '@/lib/api';
import { logAdminAction } from '@/lib/auditLog';

export const SET_SLUG_ROUTE = 'cms/content/slug';

/**
 * The value to offer. `Slug` FIRST, and that ordering is the whole point: on
 * every article in #400 `slug` holds the contested URL and `Slug` still holds
 * the source publisher's, which is the only surviving record of what the
 * article actually is — and therefore the right answer. `slug` is the fallback
 * for an article that only needs its URLs re-derived; neither present means
 * there is nothing to suggest and the operator types one.
 */
export function suggestedSlugFor(item = {}) {
  return String(item.Slug || item.slug || '').trim();
}

/** The slug the article is serving on today, for the "current" line. */
export function currentSlugOf(item = {}) {
  return String(item.slug || item.Slug || '').trim();
}

/**
 * The response as a line to render. Pure, so every branch is pinned by a test
 * rather than by clicking: a change, a no-op and a refusal read differently on
 * purpose, and none of them may read as nothing having happened.
 */
export function describeSetSlugResult(result = {}) {
  if (!result.changed) {
    return {
      tone: 'muted',
      message: `No change — ${result.reason || 'the article was already on that slug'}.`,
      publicUrl: result.publicUrl || '',
    };
  }
  const normalised =
    result.requested && result.requested.trim() !== result.slug
      ? ` (normalised from "${result.requested.trim()}")`
      : '';
  return {
    tone: 'ok',
    message: `Moved from "${result.previousSlug || 'no slug'}" to "${result.slug}"${normalised}. The manifest routes it on the next rebuild.`,
    publicUrl: result.publicUrl || '',
  };
}

export default function SetSlugPanel({ item, onApplied }) {
  const suggested = suggestedSlugFor(item);
  const current = currentSlugOf(item);
  const [value, setValue] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);

  const apply = async () => {
    setSaving(true);
    setError('');
    setOutcome(null);
    try {
      const result = await postJSON(SET_SLUG_ROUTE, { contentId: item.id, slug: value });
      setOutcome(describeSetSlugResult(result));
      await logAdminAction('content_slug_set', {
        contentId: item.id,
        requested: value,
        slug: result.slug || null,
        previousSlug: result.previousSlug || null,
        changed: Boolean(result.changed),
      });
      if (result.changed) onApplied?.(item.id, result);
    } catch (err) {
      // authedFetch throws the API's own `error` string, which for a refusal
      // names the holding document id or says the probe could not answer.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Current slug: <code>{current || 'none'}</code>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`slug-${item.id}`} className="sr-only">
          Slug for {item.Title || item.title || item.id}
        </label>
        <input
          id={`slug-${item.id}`}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
          placeholder="article-url-slug"
          className="flex-1 min-w-[16rem] rounded-md border bg-background px-2 py-1 font-mono text-xs"
        />
        <Button size="sm" onClick={apply} disabled={saving || !value.trim()}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Set slug &amp; republish
        </Button>
      </div>

      {suggested && suggested !== value && (
        <p className="text-xs text-muted-foreground">
          Suggested (this article&apos;s own <code>Slug</code> field): <code>{suggested}</code>{' '}
          <button
            type="button"
            onClick={() => setValue(suggested)}
            disabled={saving}
            className="underline"
          >
            Use it
          </button>
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Writes the slug and moves the article&apos;s URLs in one step. A slug another article holds
        is refused, and the value is normalised the way the publish pipeline would.
      </p>

      {error && <p className="text-sm text-destructive">Slug not set: {error}</p>}
      {outcome && (
        <p
          className={
            outcome.tone === 'ok'
              ? 'text-sm text-emerald-600 dark:text-emerald-400'
              : 'text-sm text-muted-foreground'
          }
        >
          {outcome.message}{' '}
          {outcome.publicUrl && (
            <a href={outcome.publicUrl} target="_blank" rel="noreferrer" className="underline">
              {outcome.publicUrl}
            </a>
          )}
        </p>
      )}
    </div>
  );
}

/** The row button that opens the panel, so the icon and label live with it. */
export function SetSlugButton({ open, onToggle }) {
  return (
    <Button size="sm" variant="outline" onClick={onToggle} aria-expanded={open}>
      <Link2 className="h-4 w-4 mr-2" />
      Slug
    </Button>
  );
}
