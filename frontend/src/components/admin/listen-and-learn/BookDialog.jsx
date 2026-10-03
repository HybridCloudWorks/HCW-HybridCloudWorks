/**
 * Create or edit a book or course (ADR 0033 §4): kind, title, author,
 * description, tags, a cover from the Image Gallery, and the voice it is
 * read in. One dialog for both because the fields are the same; only the
 * provider and the code are fixed once a book exists, since they are its
 * route and its blob path.
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, ChevronRight, ImagePlus, Loader2, X } from 'lucide-react';
import { ImageGalleryPicker } from '@/components/admin/ImageGalleryPicker';
import { resolveMediaUrl } from '@/lib/functionsBase';
import { BOOK_PROVIDERS } from '@/lib/listenAndLearn';
import VoiceSettingsFields from './VoiceSettingsFields';

const field = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const emptyForm = (book) => ({
  kind: book?.kind || 'book',
  provider: book?.provider || 'azure',
  examCode: book?.examCode || '',
  title: book?.title || '',
  author: book?.author || '',
  description: book?.description || '',
  tags: Array.isArray(book?.tags) ? book.tags.join(', ') : '',
  coverImageUrl: book?.coverImageUrl || '',
  voice: book?.voice || null,
});

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} [props.book] the book to edit; null creates one
 * @param {object|null} props.catalog speech options for the voice fields
 * @param {(fields: object) => Promise<{error?: string}|null>} props.onSave
 * @param {() => void} props.onClose
 */
export default function BookDialog({ open, book = null, catalog, onSave, onClose }) {
  const editing = Boolean(book);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${book.kind === 'course' ? 'course' : 'book'}` : 'New book or course'}
          </DialogTitle>
          <DialogDescription>
            A book is a set of chapters you write or paste; a course is bound to a certification and
            its lessons come from the study guide. Both are read in the voice chosen below.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted fresh each time the dialog opens (Radix unmounts closed
            content), so the form starts from the book as it is now with no
            reset-on-open effect to get out of step. */}
        <BookForm book={book} catalog={catalog} onSave={onSave} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function BookForm({ book, catalog, onSave, onClose }) {
  const editing = Boolean(book);
  const [form, setForm] = useState(() => emptyForm(book));
  const [showGallery, setShowGallery] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const fields = {
      kind: form.kind,
      title: form.title.trim(),
      author: form.author.trim() || null,
      description: form.description.trim() || null,
      tags,
      coverImageUrl: form.coverImageUrl.trim() || null,
      ...(form.voice ? { voice: form.voice } : {}),
      ...(editing
        ? {}
        : {
            provider: form.provider,
            ...(form.kind === 'course' && form.examCode.trim()
              ? { examCode: form.examCode.trim() }
              : {}),
          }),
    };
    const result = await onSave(fields);
    setSaving(false);
    if (result?.error) setError(result.error);
    else onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="book-kind" className="block space-y-1 text-xs font-medium">
          <span>Kind</span>
          <select
            id="book-kind"
            className={field}
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value })}
          >
            <option value="book">Book — chapters from text</option>
            <option value="course">Course — lessons from a study guide</option>
          </select>
        </label>
        <label htmlFor="book-provider" className="block space-y-1 text-xs font-medium">
          <span>Provider (its public audio page)</span>
          <select
            id="book-provider"
            className={field}
            value={form.provider}
            disabled={editing}
            onChange={(e) => set({ provider: e.target.value })}
          >
            {BOOK_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor="book-title" className="block space-y-1 text-xs font-medium">
        <span>Title</span>
        <Input
          id="book-title"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          required
          maxLength={160}
        />
      </label>
      {!editing && form.kind === 'course' && (
        <label htmlFor="book-code" className="block space-y-1 text-xs font-medium">
          <span>Exam code (optional — the title&apos;s slug otherwise)</span>
          <Input
            id="book-code"
            value={form.examCode}
            onChange={(e) => set({ examCode: e.target.value })}
            placeholder="AZ-104"
          />
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="book-author" className="block space-y-1 text-xs font-medium">
          <span>{form.kind === 'course' ? 'Instructor' : 'Author'}</span>
          <Input
            id="book-author"
            value={form.author}
            onChange={(e) => set({ author: e.target.value })}
            maxLength={120}
          />
        </label>
        <label htmlFor="book-tags" className="block space-y-1 text-xs font-medium">
          <span>Tags, comma-separated</span>
          <Input
            id="book-tags"
            value={form.tags}
            onChange={(e) => set({ tags: e.target.value })}
            placeholder="azure, identity"
          />
        </label>
      </div>
      <label htmlFor="book-description" className="block space-y-1 text-xs font-medium">
        <span>Description</span>
        <Textarea
          id="book-description"
          rows={3}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          maxLength={2000}
        />
      </label>

      <div className="space-y-2">
        <p className="text-xs font-medium">Cover</p>
        <div className="flex flex-wrap items-center gap-3">
          {form.coverImageUrl ? (
            <img
              src={resolveMediaUrl(form.coverImageUrl)}
              alt=""
              className="h-20 w-20 rounded-md border border-border object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowGallery((v) => !v)}
            aria-expanded={showGallery}
          >
            {showGallery ? 'Hide gallery' : 'Choose from Image Gallery'}
          </Button>
          {form.coverImageUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => set({ coverImageUrl: '' })}
            >
              <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Remove cover
            </Button>
          )}
        </div>
        {showGallery && (
          <ImageGalleryPicker
            title="Pick a cover"
            provider={form.provider}
            onSelect={(item) => {
              set({ coverImageUrl: item?.imageUrl || '' });
              setShowGallery(false);
            }}
          />
        )}
      </div>

      <div className="rounded-lg border border-border/60">
        <button
          type="button"
          onClick={() => setShowVoice((v) => !v)}
          aria-expanded={showVoice}
          aria-controls="book-voice-fields"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
        >
          {showVoice ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Voice — provider, model, hosts, narrator, language, rate
        </button>
        {showVoice && (
          <div id="book-voice-fields" className="border-t border-border/60 p-3">
            <VoiceSettingsFields
              value={form.voice || book?.voice || catalogDefaults(catalog)}
              onChange={(voice) => set({ voice })}
              catalog={catalog}
              idPrefix="book-voice"
            />
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !form.title.trim()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {editing ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The defaults the server applies, so the fields open showing what will run. */
function catalogDefaults(catalog) {
  return {
    provider: 'auto',
    model: null,
    speakers: { Maya: 'Kore', Elena: 'Leda' },
    narrator: 'Kore',
    language: 'en-US',
    speakingRate: catalog?.speakingRate?.default ?? 1,
  };
}
