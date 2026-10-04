/**
 * Image Prompts as a library of image sets (ADR 0033). What these pin:
 *
 * - the grid shows every set with its prompt, image and page counts;
 * - a set's pages tab lists every provider section the server allows,
 *   VMware and Ansible included (they were unreachable from the old page);
 * - CHANGING THE PROMPT DROPDOWN SAVES NOTHING — only Assign writes, and it
 *   writes what the dropdown showed;
 * - switching between prompts resets the slot templates, so one prompt's
 *   text cannot leak into the next.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import ImagePromptsPage from './ImagePromptsPage';

const postJSON = vi.fn();
const getJSON = vi.fn();
const navigate = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
  sendJSON: vi.fn(),
}));
vi.mock('react-router', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: '/admin/image-prompts', search: '' }),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));
// The keyword matrix has its own panel; here it only needs to render.
vi.mock('@/components/admin/KeywordMatrixPanel', () => ({
  default: () => <div data-testid="keyword-matrix" />,
}));

const TREE = {
  success: true,
  sets: [
    {
      id: 'Azure Chibi',
      name: 'Azure Chibi',
      primaryPrompt: 'Chibi engineers',
      purpose: 'Covers for Azure posts',
      version: 2,
      tags: ['azure'],
    },
    { id: 'AWS Lego', name: 'AWS Lego', primaryPrompt: 'Lego builders', version: 1, tags: [] },
  ],
  prompts: [
    {
      id: 'Hero',
      name: 'Hero',
      setName: 'Azure Chibi',
      additionalParameters: 'one character',
      slotTemplates: { hero: 'Wide shot of the data centre' },
    },
    {
      id: 'Minimal',
      name: 'Minimal',
      setName: 'Azure Chibi',
      additionalParameters: '',
      slotTemplates: {},
    },
  ],
  pages: [
    { id: 'azure_blog', pagePath: '/azure/blog', setName: 'Azure Chibi', promptName: 'Hero' },
  ],
  legacyPages: [],
  legacySets: [],
  images: [
    {
      id: 'img1',
      imageUrl: '/api/public/media/covers/a.png',
      promptSet: 'Azure Chibi',
      createdAt: '2026-10-01T00:00:00Z',
      galleryCollection: 'generated_content_images',
    },
  ],
  allowedPages: ['/azure', '/azure/blog', '/vmware', '/vmware/blog', '/ansible', '/ansible/code'],
};

function manageCalls() {
  return postJSON.mock.calls.filter(([route]) => route === 'manageImagePromptConfig');
}

beforeEach(() => {
  vi.clearAllMocks();
  getJSON.mockImplementation((route) => {
    if (route.startsWith('cms/image-prompts')) return Promise.resolve(TREE);
    if (route.startsWith('cms/images')) return Promise.resolve({ items: [], total: 0 });
    return Promise.resolve({});
  });
  postJSON.mockResolvedValue({ success: true });
});

describe('the set grid', () => {
  it('shows every set with its counts', async () => {
    render(<ImagePromptsPage />);
    expect(await screen.findByRole('button', { name: /Azure Chibi/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AWS Lego/ })).toBeInTheDocument();
    expect(screen.getByText('2 prompts · 1 image · 1 page')).toBeInTheDocument();
    expect(screen.getByText('0 prompts · 0 images · 0 pages')).toBeInTheDocument();
  });
});

describe('an open set', () => {
  async function openAzure() {
    render(<ImagePromptsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Azure Chibi/ }));
    return screen.findByRole('tab', { name: /Pages/ });
  }

  it('lists VMware and Ansible pages, and a dropdown change saves nothing until Assign', async () => {
    const pagesTab = await openAzure();
    fireEvent.mouseDown(pagesTab);
    fireEvent.click(pagesTab);
    const select = await screen.findByLabelText('Prompt for VMware Blog');
    expect(screen.getByLabelText('Prompt for Ansible Code')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'Minimal' } });
    expect(manageCalls()).toHaveLength(0);

    const row = select.closest('li');
    fireEvent.click(within(row).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(manageCalls()).toHaveLength(1));
    expect(manageCalls()[0][1]).toEqual({
      action: 'savePageAssignment',
      pagePath: '/vmware/blog',
      setName: 'Azure Chibi',
      promptName: 'Minimal',
    });
  });

  it('resets the slot templates when switching prompts', async () => {
    await openAzure();
    const promptsTab = screen.getByRole('tab', { name: /Prompts/ });
    fireEvent.mouseDown(promptsTab);
    fireEvent.click(promptsTab);
    // The list button's name carries its "slot templates" hint.
    fireEvent.click(await screen.findByRole('button', { name: /^Hero/ }));
    expect(screen.getByLabelText('Hero slot template')).toHaveValue('Wide shot of the data centre');
    fireEvent.click(screen.getByRole('button', { name: 'Minimal' }));
    expect(screen.getByLabelText('Hero slot template')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    expect(screen.getByLabelText('Hero slot template')).toHaveValue('');
    expect(screen.getByLabelText(/Prompt name/)).toHaveValue('');
  });

  it('saves the set with its creative fields through saveSet', async () => {
    await openAzure();
    fireEvent.change(screen.getByLabelText('Style rules'), { target: { value: 'Soft gradients' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save set' }));
    await waitFor(() => expect(manageCalls()).toHaveLength(1));
    expect(manageCalls()[0][1]).toMatchObject({
      action: 'saveSet',
      setName: 'Azure Chibi',
      primaryPrompt: 'Chibi engineers',
      styleRules: 'Soft gradients',
      tags: ['azure'],
    });
  });
});
