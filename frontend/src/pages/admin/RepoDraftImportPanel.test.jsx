import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RepoDraftImportPanel, {
  CANDIDATES_ROUTE,
  IMPORT_ROUTE,
  describeCandidate,
  summarizeImport,
  toResultLine,
} from './RepoDraftImportPanel';

const postJSON = vi.fn();
const getJSON = vi.fn();
const logAdminAction = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: (...args) => getJSON(...args),
}));
vi.mock('@/lib/auditLog', () => ({
  logAdminAction: (...args) => logAdminAction(...args),
}));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast }) }));

const LAB = [
  'docs/content/blog-lab-01-landing-zone.md',
  'docs/content/blog-lab-02-one-container.md',
  'docs/content/blog-lab-03-agent-explains.md',
];
const candidate = (path, over = {}) => ({
  path,
  name: path.split('/').at(-1),
  size: 1000,
  blobSha: 'b'.repeat(40),
  imported: null,
  importable: true,
  ...over,
});
const LIVE_POST = candidate('docs/content/blog-how-to-01-infrastructure.md', {
  imported: { contentId: 'live-1', contentStatus: 'published', live: true },
  importable: false,
});
const CANDIDATES = [LIVE_POST, ...LAB.map((path) => candidate(path))];

const TITLES = {
  [LAB[0]]: 'Build a landing zone you can read',
  [LAB[1]]: 'Follow along in one container',
  [LAB[2]]: 'Let an agent explain it',
};
const created = (path) => ({
  path,
  outcome: 'created',
  contentId: `id-${path.slice(-8)}`,
  contentStatus: 'in_review',
  title: TITLES[path],
  warnings: ['links to repository files will not resolve on the site: x.md'],
});

function renderPanel(props = {}) {
  return render(
    <MemoryRouter>
      <RepoDraftImportPanel {...props} />
    </MemoryRouter>
  );
}

const openPanel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Import drafts from the repository' }));

describe('pure helpers', () => {
  it('describes each state a candidate can be in', () => {
    expect(describeCandidate(candidate(LAB[0]))).toEqual({ label: 'Not imported', tone: 'new' });
    expect(
      describeCandidate(
        candidate(LAB[0], { imported: { contentStatus: 'in_review', live: false } })
      )
    ).toEqual({ label: 'In Review — importing refreshes it', tone: 'review' });
    expect(describeCandidate(LIVE_POST)).toEqual({
      label: 'Live — re-import refused',
      tone: 'locked',
    });
    expect(
      describeCandidate(candidate(LAB[0], { imported: { contentStatus: 'approved', live: false } }))
        .label
    ).toBe('Approved — re-import refused');
    expect(describeCandidate(candidate(LAB[0], { ambiguous: true })).tone).toBe('locked');
  });

  it('turns a result into a line, linking only drafts that landed', () => {
    expect(toResultLine(created(LAB[0]))).toMatchObject({
      title: TITLES[LAB[0]],
      landed: true,
      text: 'Imported — In Review',
      contentId: `id-${LAB[0].slice(-8)}`,
    });
    expect(
      toResultLine({
        path: LAB[1],
        outcome: 'refused',
        code: 'LIVE',
        error: 'This article is live.',
      })
    ).toMatchObject({
      title: 'blog-lab-02-one-container.md',
      landed: false,
      contentId: null,
      text: 'Refused: This article is live.',
    });
    expect(toResultLine({ path: LAB[2], outcome: 'failed', code: 'TIMEOUT' }).text).toBe(
      'Failed: TIMEOUT'
    );
  });

  it('says In Review and says nothing was published', () => {
    expect(summarizeImport(LAB.map(created))).toEqual({
      title: '3 drafts In Review',
      description: 'Nothing was published.',
    });
    expect(
      summarizeImport([created(LAB[0]), { path: LAB[1], outcome: 'refused' }]).description
    ).toBe('Nothing was published. 1 refused or failed; see the list.');
    expect(summarizeImport([{ path: LAB[1], outcome: 'refused' }])).toMatchObject({
      title: 'Nothing imported',
      variant: 'destructive',
    });
  });
});

describe('RepoDraftImportPanel', () => {
  beforeEach(() => {
    postJSON.mockReset();
    getJSON.mockReset();
    logAdminAction.mockReset();
    logAdminAction.mockResolvedValue(undefined);
    toast.mockReset();
  });

  it('asks GitHub for nothing until opened, then lists the drafts with none ticked', async () => {
    getJSON.mockResolvedValue({ ok: true, candidates: CANDIDATES });
    renderPanel();
    expect(getJSON).not.toHaveBeenCalled();

    openPanel();
    expect(await screen.findByText('blog-lab-01-landing-zone.md')).toBeInTheDocument();
    expect(getJSON).toHaveBeenCalledWith(CANDIDATES_ROUTE);
    expect(screen.getByText('4 drafts on main.')).toBeInTheDocument();

    for (const path of LAB) {
      const box = screen.getByRole('checkbox', { name: `Select ${path.split('/').at(-1)}` });
      expect(box).not.toBeChecked();
      expect(box).toBeEnabled();
    }
    // A live article cannot be ticked: the API would only refuse it.
    const live = screen.getByRole('checkbox', { name: 'Select blog-how-to-01-infrastructure.md' });
    expect(live).toBeDisabled();
    expect(screen.getByText('Live — re-import refused')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Review blog-how-to-01-infrastructure.md' })
    ).toHaveAttribute('href', '/admin/queue/live-1');
    expect(screen.getByRole('button', { name: 'Import selected as In Review (0)' })).toBeDisabled();
  });

  it('imports the ticked drafts as In Review, toasts, lists the results and hands off to the queue', async () => {
    getJSON.mockResolvedValueOnce({ ok: true, candidates: CANDIDATES }).mockResolvedValueOnce({
      ok: true,
      candidates: [
        LIVE_POST,
        ...LAB.map((path) =>
          candidate(path, {
            imported: {
              contentId: `id-${path.slice(-8)}`,
              contentStatus: 'in_review',
              live: false,
            },
          })
        ),
      ],
    });
    const response = { ok: true, results: LAB.map(created), counts: { created: 3 } };
    postJSON.mockResolvedValue(response);
    const onImported = vi.fn();
    renderPanel({ onImported });

    openPanel();
    await screen.findByText('blog-lab-01-landing-zone.md');
    for (const path of LAB) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${path.split('/').at(-1)}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Import selected as In Review (3)' }));

    await waitFor(() => expect(postJSON).toHaveBeenCalledWith(IMPORT_ROUTE, { paths: LAB }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(response));
    expect(toast).toHaveBeenCalledWith({
      title: '3 drafts In Review',
      description: 'Nothing was published.',
    });
    expect(logAdminAction).toHaveBeenCalledWith('repo_drafts_imported', {
      requested: 3,
      created: 3,
    });

    const results = screen.getByRole('list', { name: 'Import results' });
    expect(within(results).getAllByText('Imported — In Review')).toHaveLength(3);
    expect(within(results).getByText(TITLES[LAB[0]])).toBeInTheDocument();
    expect(within(results).getAllByRole('link', { name: 'Open review' })[0]).toHaveAttribute(
      'href',
      `/admin/queue/id-${LAB[0].slice(-8)}`
    );
    expect(within(results).getAllByText(/links to repository files will not resolve/)).toHaveLength(
      3
    );

    // The list is re-read, and now says the three are In Review.
    expect(getJSON).toHaveBeenCalledTimes(2);
    expect(await screen.findAllByText('In Review — importing refreshes it')).toHaveLength(3);
  });

  it('reports refusals without handing off when nothing landed', async () => {
    getJSON.mockResolvedValue({ ok: true, candidates: CANDIDATES });
    postJSON.mockResolvedValue({
      ok: true,
      results: [
        {
          path: LAB[0],
          outcome: 'refused',
          code: 'PUBLISHED_ELSEWHERE',
          error: 'Already published.',
        },
      ],
      counts: { refused: 1 },
    });
    const onImported = vi.fn();
    renderPanel({ onImported });

    openPanel();
    await screen.findByText('blog-lab-01-landing-zone.md');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select blog-lab-01-landing-zone.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected as In Review (1)' }));

    expect(await screen.findByText('Refused: Already published.')).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nothing imported', variant: 'destructive' })
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  it('shows why the list could not be read, and why an import failed', async () => {
    getJSON.mockRejectedValueOnce(new Error("GitHub's unauthenticated rate limit is used up"));
    renderPanel();
    openPanel();
    expect(
      await screen.findByText(/Could not list the drafts: GitHub's unauthenticated rate limit/)
    ).toBeInTheDocument();

    getJSON.mockResolvedValue({ ok: true, candidates: CANDIDATES });
    fireEvent.click(screen.getByRole('button', { name: 'Import drafts from the repository' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import drafts from the repository' }));
    await screen.findByText('blog-lab-02-one-container.md');
    postJSON.mockRejectedValue(new Error('cms/content/import-repo failed with HTTP 500.'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select blog-lab-02-one-container.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected as In Review (1)' }));

    expect(
      await screen.findByText(/Import failed: cms\/content\/import-repo failed/)
    ).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Import failed', variant: 'destructive' })
    );
  });
});
