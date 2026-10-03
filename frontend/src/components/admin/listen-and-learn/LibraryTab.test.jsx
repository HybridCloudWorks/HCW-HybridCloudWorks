/**
 * The Library grid (ADR 0033 §4): books with their kind and counts, the
 * honest states around it, the archived toggle, and opening a book.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LibraryTab from './LibraryTab';

vi.mock('@/lib/functionsBase', () => ({ resolveMediaUrl: (u) => u }));
vi.mock('@/components/admin/ImageGalleryPicker', () => ({
  ImageGalleryPicker: () => <div>gallery</div>,
}));

const book = (over = {}) => ({
  id: 'azure_az-104',
  provider: 'azure',
  examCode: 'az-104',
  kind: 'course',
  title: 'Azure Administrator',
  author: null,
  tags: [],
  coverImageUrl: null,
  archivedAt: null,
  counts: { chapters: 5, published: 3, drafts: 2, failed: 0, archived: 0, durationSeconds: 2820 },
  ...over,
});

const hub = (over = {}) => ({
  sets: [],
  setsLoaded: true,
  selected: null,
  includeArchived: false,
  setIncludeArchived: vi.fn(),
  catalog: null,
  error: null,
  loadSets: vi.fn(),
  openSet: vi.fn(),
  createBook: vi.fn(),
  ...over,
});

describe('LibraryTab', () => {
  it('lists books with their kind, provider and summary, and opens one on click', () => {
    const h = hub({
      sets: [
        book(),
        book({
          id: 'aws_x',
          provider: 'aws',
          examCode: 'zero-trust',
          kind: 'book',
          title: 'Zero Trust',
          author: 'Saul',
        }),
      ],
    });
    render(<LibraryTab hub={h} />);
    const list = screen.getByRole('list', { name: 'Books and courses' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('5 lessons · 3 published · 47 min')).toBeInTheDocument();
    expect(screen.getByText('Course')).toBeInTheDocument();
    expect(screen.getByText('Book')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Zero Trust' }));
    expect(h.openSet).toHaveBeenCalledWith('aws', 'zero-trust');
  });

  it('says what would fill an empty library, and offers the action', () => {
    render(<LibraryTab hub={hub()} />);
    expect(screen.getByText('Nothing in the library yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New book or course/ }).length).toBeGreaterThan(0);
  });

  it('shows a loading line until the first answer, and a retry on failure', () => {
    const { rerender } = render(<LibraryTab hub={hub({ setsLoaded: false })} />);
    expect(screen.getByText(/Loading the library/)).toBeInTheDocument();
    const h = hub({ error: 'boom' });
    rerender(<LibraryTab hub={h} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(h.loadSets).toHaveBeenCalled();
  });

  it('filters by search and kind, and asks the hub for archived books', () => {
    const h = hub({
      sets: [
        book(),
        book({ id: 'aws_x', provider: 'aws', examCode: 'zt', kind: 'book', title: 'Zero Trust' }),
      ],
    });
    render(<LibraryTab hub={h} />);
    fireEvent.change(screen.getByLabelText('Search the library'), { target: { value: 'zero' } });
    expect(
      screen.getByRole('list', { name: 'Books and courses' }).querySelectorAll('li')
    ).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'course' } });
    expect(screen.getByText('No books match')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show archived'));
    expect(h.setIncludeArchived).toHaveBeenCalledWith(true);
  });
});
