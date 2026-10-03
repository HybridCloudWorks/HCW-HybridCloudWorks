/**
 * ManualBlockDialog — put something of your own into an issue (ADR 0033
 * Amplify slice: "an issue can pull a chosen article"). Two sources:
 *
 *   Live content   search what the site has published (GET cms/content?live=true)
 *                  and add it with its title, summary and public URL
 *   Custom block   a title, a link, a summary and, optionally, an image from
 *                  the Image Gallery
 *
 * Either lands in a section of the issue, or in a new "From the editor"
 * section. The item carries `manual: true`, which is what the server accepts
 * as an addition (everything else in a section must be a stored item).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageGalleryPicker } from '@/components/admin/ImageGalleryPicker';
import { Loader2, Search } from 'lucide-react';
import { getJSON } from '@/lib/api';
import { getLiveUrl } from '@/lib/livePages';
import { resolveMediaUrl } from '@/lib/functionsBase';

export const LIVE_CONTENT_ROUTE = 'cms/content?live=true&limit=200';
export const NEW_SECTION = { id: 'manual-editor', title: 'From the editor' };

const titleOf = (item) => item.Title || item.title || 'Untitled';
const summaryOf = (item) => item.Summary || item.summary || '';

/** A live content record as a newsletter item. Null when it has no public URL. */
export function itemFromContent(item) {
  const url = getLiveUrl(item);
  if (!url) return null;
  return {
    manual: true,
    title: titleOf(item).slice(0, 160),
    url,
    summary: summaryOf(item).slice(0, 280),
    label: (item['Cloud Provider'] || item.cloudProvider || '').slice(0, 40) || undefined,
    contentId: item.id,
  };
}

function LiveContentPicker({ onPick }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let current = true;
    getJSON(LIVE_CONTENT_ROUTE)
      .then((res) => current && setItems(Array.isArray(res?.items) ? res.items : []))
      .catch((err) => current && setError(err.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => getLiveUrl(item))
      .filter(
        (item) => !needle || `${titleOf(item)} ${summaryOf(item)}`.toLowerCase().includes(needle)
      )
      .slice(0, 40);
  }, [items, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="pl-8"
          placeholder="Search live content by title"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search live content"
        />
      </div>
      {loading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live content…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!loading && !error && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing live matches.</p>
      )}
      <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Live content">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onPick(itemFromContent(item))}
              className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/50"
            >
              <span className="block truncate font-medium">{titleOf(item)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {summaryOf(item) || getLiveUrl(item)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomBlockForm({ onPick }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [showGallery, setShowGallery] = useState(false);
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (!title.trim()) return setError('Give the block a title.');
    if (!/^https:\/\//i.test(url.trim()) && !url.trim().startsWith('/'))
      return setError('The link must start with https:// (or be a site path starting with /).');
    setError('');
    return onPick({
      manual: true,
      title: title.trim().slice(0, 160),
      url: url.trim(),
      ...(summary.trim() ? { summary: summary.trim().slice(0, 280) } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="nl-block-title">Title</Label>
        <Input
          id="nl-block-title"
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nl-block-url">Link</Label>
        <Input
          id="nl-block-url"
          type="url"
          placeholder="https://"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="nl-block-summary">Summary (optional)</Label>
        <Textarea
          id="nl-block-summary"
          rows={2}
          maxLength={280}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Image (optional)</Label>
        {imageUrl ? (
          <div className="flex items-center gap-2">
            <img
              src={resolveMediaUrl(imageUrl)}
              alt=""
              className="h-12 w-20 rounded object-cover"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl('')}>
              Remove image
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowGallery((v) => !v)}
          >
            {showGallery ? 'Hide gallery' : 'Choose from the Image Gallery'}
          </Button>
        )}
        {showGallery && !imageUrl && (
          <ImageGalleryPicker
            title="Pick an image"
            onSelect={(item) => {
              setImageUrl(item.imageUrl || '');
              setShowGallery(false);
            }}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm">
        Use this block
      </Button>
    </form>
  );
}

/**
 * @param {{ sections: Array<{id, title}>, onAdd: (sectionId: string, sectionTitle: string|null, item: object) => void, onClose: () => void }} props
 */
export default function ManualBlockDialog({ sections, onAdd, onClose }) {
  const [source, setSource] = useState('live');
  const [target, setTarget] = useState(sections[0]?.id || NEW_SECTION.id);
  const hasNew = !sections.some((section) => section.id === NEW_SECTION.id);

  const pick = (item) => {
    if (!item) return;
    const existing = sections.find((section) => section.id === target);
    onAdd(target, existing ? null : NEW_SECTION.title, item);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a block</DialogTitle>
          <DialogDescription>
            A live article from the site, or a block of your own. It goes into the section you
            choose; save the issue afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nl-block-source">Source</Label>
            <select
              id="nl-block-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="live">Live content</option>
              <option value="custom">Custom block</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-block-section">Section</Label>
            <select
              id="nl-block-section"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title || section.id}
                </option>
              ))}
              {hasNew && <option value={NEW_SECTION.id}>New section: {NEW_SECTION.title}</option>}
            </select>
          </div>
        </div>
        {source === 'live' ? (
          <LiveContentPicker onPick={pick} />
        ) : (
          <CustomBlockForm onPick={pick} />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
