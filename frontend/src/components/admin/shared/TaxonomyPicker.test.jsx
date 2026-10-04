import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));

const { resetTaxonomyCache } = await import('@/lib/taxonomy');
const { default: TaxonomyPicker, WHY_IT_MATTERS } = await import('./TaxonomyPicker');
const { default: TaxonomyChips } = await import('./TaxonomyChips');

beforeEach(() => {
  getJSON.mockReset();
  resetTaxonomyCache();
});

describe('TaxonomyPicker', () => {
  it('offers the enabled entries, explains the chosen one, and says why it matters', async () => {
    getJSON.mockResolvedValue({
      value: {
        kinds: [
          { id: 'article', label: 'Article', description: 'A written piece.', enabled: true },
          { id: 'haiku', label: 'Haiku', description: 'Seventeen syllables.', enabled: false },
        ],
        ideaOrigins: [
          { id: 'manual', label: 'Manually entered', description: 'Typed in.', enabled: true },
        ],
      },
    });
    const onChange = vi.fn();
    render(<TaxonomyPicker kind="article" ideaOrigin="manual" onChange={onChange} />);

    const kind = screen.getByLabelText('Kind (what it becomes)');
    await waitFor(() => expect(kind).not.toBeDisabled());
    expect(screen.getByRole('option', { name: 'Article' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Haiku' })).not.toBeInTheDocument();
    expect(screen.getByText('A written piece.')).toBeInTheDocument();
    expect(screen.getByText(WHY_IT_MATTERS)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Idea origin (how it started)'), {
      target: { value: 'manual' },
    });
    expect(onChange).toHaveBeenCalledWith({ kind: 'article', ideaOrigin: 'manual' });
  });

  it('falls back to the defaults when the taxonomy cannot be read', async () => {
    getJSON.mockRejectedValue(new Error('offline'));
    render(<TaxonomyPicker kind="tutorial" ideaOrigin="rss-feed" onChange={() => {}} />);
    const kind = screen.getByLabelText('Kind (what it becomes)');
    await waitFor(() => expect(kind).not.toBeDisabled());
    expect(kind).toHaveValue('tutorial');
    expect(screen.getByRole('option', { name: 'Audiobook chapter' })).toBeInTheDocument();
  });

  it('shows a stored id the lists no longer offer, named, rather than changing it', async () => {
    getJSON.mockResolvedValue({ value: null });
    render(<TaxonomyPicker kind="retired-kind" ideaOrigin="manual" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Kind (what it becomes)')).not.toBeDisabled());
    expect(screen.getByRole('option', { name: 'retired-kind (disabled)' })).toBeInTheDocument();
  });
});

describe('TaxonomyChips', () => {
  it('labels the stored classification, and derives one for a record that predates it', async () => {
    getJSON.mockResolvedValue({ value: null });
    render(
      <>
        <TaxonomyChips item={{ kind: 'social-post', ideaOrigin: 'conference' }} />
        <TaxonomyChips item={{ type: 'framework', source: 'rss' }} />
      </>
    );
    await waitFor(() => expect(screen.getByText('Social post')).toBeInTheDocument());
    expect(screen.getByText('Conference or event')).toBeInTheDocument();
    expect(screen.getByText('Reference guide')).toBeInTheDocument();
    expect(screen.getByText('RSS or external feed')).toBeInTheDocument();
  });
});
