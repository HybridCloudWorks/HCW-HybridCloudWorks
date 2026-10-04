/**
 * The details dialog (ADR 0033 acceptance: "from an image you can see its
 * prompt and set"). The dialog was split into sections for PR #841; these
 * tests pin what the one component used to do: every field has a label, Save
 * sends the record shape, the usage list and the set link are reachable, and
 * the state buttons follow archive and trash.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageDetailsDialog from './ImageDetailsDialog';

const fetchImageUsage = vi.fn();
vi.mock('@/lib/imageGallery', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchImageUsage: (...args) => fetchImageUsage(...args),
}));

const ITEM = {
  id: 'img-1',
  galleryCollection: 'generated_content_images',
  title: 'Alpha',
  altText: 'A diagram',
  imageUrl: '/api/public/media/covers/a.png',
  customTags: ['cloud'],
  folder: 'default',
  provider: 'aws',
  slot: 'hero',
  source: 'ai-cover',
  promptSet: 'Azure Chibi',
  promptName: 'hero',
  prompt: 'A chibi cloud',
  createdAt: '2026-09-01T10:00:00Z',
};

function renderDialog(overrides = {}) {
  const props = {
    item: ITEM,
    folders: ['default', 'aws'],
    onClose: vi.fn(),
    onSave: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onTrash: vi.fn(),
    onDelete: vi.fn(),
    onReuse: vi.fn(),
    onCopy: vi.fn(),
    onOpenSet: vi.fn(),
    onOpenContent: vi.fn(),
    onOpenVariant: vi.fn(),
    copied: '',
    busy: false,
    ...overrides,
  };
  render(<ImageDetailsDialog {...props} />);
  return props;
}

describe('ImageDetailsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchImageUsage.mockResolvedValue({
      usedBy: [{ id: 'post-1', field: 'heroImage', title: 'Post one', status: 'published' }],
      variants: [{ id: 'img-2', title: 'Beta', imageUrl: '/api/public/media/covers/b.png' }],
    });
  });

  it('labels every field and sends the record shape on Save', async () => {
    const props = renderDialog();
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Alpha renamed' } });
    fireEvent.change(screen.getByLabelText('Tags (comma-separated)'), {
      target: { value: 'cloud, edge' },
    });
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'aws' } });
    expect(screen.getByLabelText('Alt text')).toHaveValue('A diagram');
    expect(screen.getByLabelText('Caption')).toBeInTheDocument();
    expect(screen.getByLabelText('Licence')).toBeInTheDocument();
    expect(screen.getByLabelText('Credit')).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('aws');
    expect(screen.getByLabelText('Slot')).toHaveValue('hero');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onSave).toHaveBeenCalledWith(ITEM, {
      title: 'Alpha renamed',
      altText: 'A diagram',
      caption: '',
      license: '',
      credit: '',
      customTags: ['cloud', 'edge'],
      folder: 'aws',
      provider: 'aws',
      slot: 'hero',
    });
    await waitFor(() => expect(screen.getByText('Post one')).toBeInTheDocument());
  });

  it('lists where the image is used and its variants once they load', async () => {
    const props = renderDialog();
    expect(screen.getByText(/Checking content/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Post one' }));
    expect(props.onOpenContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'post-1', field: 'heroImage' })
    );
    expect(screen.getByText('Used by (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Beta/ }));
    expect(props.onOpenVariant).toHaveBeenCalledWith('img-2');
  });

  it('links the image set and reveals the prompt on request', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Azure Chibi' }));
    expect(props.onOpenSet).toHaveBeenCalledWith('Azure Chibi');
    expect(screen.queryByText('A chibi cloud')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Show the prompt/ });
    fireEvent.click(toggle);
    expect(screen.getByText('A chibi cloud')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide the prompt/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await waitFor(() => expect(fetchImageUsage).toHaveBeenCalledWith(ITEM));
  });

  it('offers archive and trash for a live image, restore for a trashed one', async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(props.onArchive).toHaveBeenCalledWith(ITEM);
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(props.onTrash).toHaveBeenCalledWith(ITEM);
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchImageUsage).toHaveBeenCalled());
  });

  it('shows restore, and no reuse, for an image in the trash', async () => {
    const trashed = { ...ITEM, softDeletedAt: '2026-09-02T10:00:00Z' };
    const props = renderDialog({ item: trashed });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(props.onRestore).toHaveBeenCalledWith(trashed);
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use in new content/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchImageUsage).toHaveBeenCalled());
  });

  it('says how much content loses the image before deleting it', async () => {
    const props = renderDialog();
    await screen.findByText('Post one');
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(screen.getByText(/1 content item point at this image/)).toBeInTheDocument();
    const confirm = screen
      .getAllByRole('button', { name: 'Delete permanently' })
      .find((button) => button.closest('[role="alertdialog"], [role="dialog"]') !== null);
    fireEvent.click(confirm);
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(ITEM));
  });

  it('reports a usage lookup that failed instead of hanging on the spinner', async () => {
    fetchImageUsage.mockRejectedValue(new Error('usage route down'));
    renderDialog();
    expect(await screen.findByText('usage route down')).toBeInTheDocument();
    expect(screen.queryByText(/Checking content/)).not.toBeInTheDocument();
  });
});
