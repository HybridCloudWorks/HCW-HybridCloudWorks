/**
 * Library — every book and course as a grid, opening to the book's chapters
 * (ADR 0033 §4). The one place a book is created, renamed, given a cover and
 * a voice, archived or deleted, and the one place a chapter is reordered,
 * regenerated, versioned, renamed, archived or deleted.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import EmptyState from '@/components/admin/shared/EmptyState';
import { Loader2, Plus } from 'lucide-react';
import BookCard from './BookCard';
import BookDetail from './BookDetail';
import BookDialog from './BookDialog';

const field = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

/** The grid, or the one honest state that stands in for it. */
function LibraryBody({ loaded, error, sets, books, onRetry, onCreate, onOpen }) {
  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the library…
      </p>
    );
  }
  if (error && sets.length === 0) {
    return (
      <EmptyState
        variant="error"
        title="The library could not be read"
        description={error}
        onRetry={onRetry}
      />
    );
  }
  if (sets.length === 0) {
    return (
      <EmptyState
        title="Nothing in the library yet"
        description="Create a book from text, or run a certification's study guide on the Generate tab to make a course."
        action={
          <Button size="sm" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New book or course
          </Button>
        }
      />
    );
  }
  if (books.length === 0) {
    return (
      <EmptyState
        variant="filtered"
        title="No books match"
        description="Clear the search or the kind filter, or show archived books."
      />
    );
  }
  return (
    <ul
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-label="Books and courses"
    >
      {books.map((book) => (
        <BookCard key={book.id} book={book} onOpen={onOpen} />
      ))}
    </ul>
  );
}

export default function LibraryTab({ hub }) {
  const {
    sets,
    setsLoaded,
    selected,
    includeArchived,
    setIncludeArchived,
    catalog,
    error,
    loadSets,
  } = hub;
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sets.filter(
      (book) =>
        (kind === 'all' || book.kind === kind) &&
        (!q ||
          [book.title, book.author, book.examCode, book.provider, ...(book.tags || [])]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q))
    );
  }, [sets, query, kind]);

  if (selected) return <BookDetail hub={hub} />;

  return (
    <div className="space-y-4 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title, author, exam, tag…"
          aria-label="Search the library"
          className="h-9 w-64"
        />
        <label htmlFor="library-kind" className="sr-only">
          Kind
        </label>
        <select
          id="library-kind"
          className={field}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">Books and courses</option>
          <option value="book">Books</option>
          <option value="course">Courses</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New book or course
        </Button>
      </div>

      <LibraryBody
        loaded={setsLoaded}
        error={error}
        sets={sets}
        books={books}
        onRetry={loadSets}
        onCreate={() => setCreating(true)}
        onOpen={(b) => hub.openSet(b.provider, b.examCode)}
      />

      <BookDialog
        open={creating}
        book={null}
        catalog={catalog}
        onSave={(fields) => hub.createBook(fields)}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
