/**
 * Manual blocks (ADR 0033: "an issue can pull a chosen article"). What must
 * hold: a live content record becomes a manual item with its public URL, the
 * dialog searches live content and hands the chosen item to the section
 * picked, a custom block refuses a non-https link, and adding an item to
 * sections creates a manual section when the target is new.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import ManualBlockDialog, { NEW_SECTION, itemFromContent } from './ManualBlockDialog';
import { addItemToSections, toSectionsPayload } from './SectionEditor';

const getJSON = vi.fn();
vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));
vi.mock('@/components/admin/ImageGalleryPicker', () => ({
  ImageGalleryPicker: () => <div>gallery</div>,
}));

const LIVE = [
  {
    id: 'c1',
    Title: 'Landing zones',
    Summary: 'Hubs and spokes',
    'Cloud Provider': 'Azure',
    Live: true,
    slugPageUrl: 'https://hybridcloudworks.com/azure/blog/landing-zones',
  },
  { id: 'c2', title: 'No URL yet', Live: true },
];

beforeEach(() => {
  getJSON.mockReset();
  getJSON.mockResolvedValue({ success: true, items: LIVE });
});

describe('itemFromContent and addItemToSections', () => {
  it('maps a live record to a manual item, and drops one with no public URL', () => {
    expect(itemFromContent(LIVE[0])).toEqual({
      manual: true,
      title: 'Landing zones',
      url: 'https://hybridcloudworks.com/azure/blog/landing-zones',
      summary: 'Hubs and spokes',
      label: 'Azure',
      contentId: 'c1',
    });
    expect(itemFromContent(LIVE[1])).toBeNull();
  });

  it('appends to an existing section, or creates a manual section whose payload carries its title', () => {
    const stored = [{ id: 'articles', title: 'New', items: [{ title: 'A', url: 'https://x/a' }] }];
    const item = { manual: true, title: 'B', url: 'https://x/b' };
    expect(addItemToSections(stored, 'articles', null, item)[0].items).toHaveLength(2);
    const created = addItemToSections(stored, NEW_SECTION.id, NEW_SECTION.title, item);
    expect(created[1]).toEqual({
      id: 'manual-editor',
      title: 'From the editor',
      manual: true,
      items: [item],
    });
    expect(toSectionsPayload(created)).toEqual([
      { id: 'articles', items: stored[0].items },
      { id: 'manual-editor', title: 'From the editor', items: [item] },
    ]);
  });
});

describe('ManualBlockDialog', () => {
  it('searches live content and adds the chosen article to the section picked', async () => {
    const onAdd = vi.fn();
    render(
      <ManualBlockDialog
        sections={[{ id: 'articles', title: 'New' }]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByRole('button', { name: /Landing zones/ })).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith('cms/content?live=true&limit=200');
    // The record with no public URL is not offered.
    expect(screen.queryByRole('button', { name: /No URL yet/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search live content'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing live matches.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search live content'), {
      target: { value: 'landing' },
    });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: NEW_SECTION.id } });
    fireEvent.click(screen.getByRole('button', { name: /Landing zones/ }));
    expect(onAdd).toHaveBeenCalledWith(
      NEW_SECTION.id,
      NEW_SECTION.title,
      expect.objectContaining({ manual: true, contentId: 'c1' })
    );
  });

  it('a custom block needs an https link, and then lands in the section', async () => {
    const onAdd = vi.fn();
    render(
      <ManualBlockDialog
        sections={[{ id: 'articles', title: 'New' }]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Our webinar' } });
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: 'http://insecure.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this block' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/https/);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: 'https://hybridcloudworks.com/webinar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this block' }));
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith('articles', null, {
        manual: true,
        title: 'Our webinar',
        url: 'https://hybridcloudworks.com/webinar',
      })
    );
  });
});
