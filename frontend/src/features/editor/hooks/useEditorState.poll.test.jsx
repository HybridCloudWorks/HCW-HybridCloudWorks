/**
 * The editor's remote-document poll.
 *
 * Both defects here are consequences of one change: `onSnapshot` became a
 * twenty-second `setInterval`, and two pieces of logic that were correct at
 * millisecond latency stopped being correct at twenty seconds.
 *
 *   - T-208: "is the document I just fetched my own write?" was a one-shot
 *     boolean, consumed by whatever the next response happened to carry. At
 *     millisecond latency that was reliably our own write. At twenty seconds it
 *     can be a collaborator's — and the branch adopted THEIR edit marker as our
 *     baseline, so our next save passed the server's equality check and
 *     overwrote them silently.
 *   - T-209: the poll has no change detection, so every tick re-applied the
 *     remote document over `orderedImageUrls` — local, user-mutable, persisted
 *     only on save.
 *
 * These are lost-update and lost-work bugs, so the assertions are about what
 * survives and what is refused, not about rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const getJSON = vi.fn();
const postJSON = vi.fn();

vi.mock('@/lib/api', () => ({
  getJSON: (...args) => getJSON(...args),
  postJSON: (...args) => postJSON(...args),
}));
vi.mock('@/lib/auditLog', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/hooks/usePublicData', () => ({ usePublicData: () => ({ data: null, loading: false }) }));

const { useEditorState } = await import('./useEditorState.js');

const MINE = '2026-06-01T12:00:00.000Z';
const THEIRS = '2026-06-01T12:05:00.000Z';
const LOADED = '2026-06-01T11:00:00.000Z';

// The image order is derived from the document's slot fields, not stored as a
// list — lib/contentImages.js flattens hero + secondaries into the order the
// editor shows.
const doc = (over = {}) => ({
  id: 'c1',
  Title: 'Landing zone',
  blogDraft: 'body',
  blogEditedAt: LOADED,
  heroImageUrl: '/a.png',
  secondaryImageUrls: ['/b.png'],
  ...over,
});

/** Mount the hook and wait for its first load to settle. */
async function mountEditor(initial = doc()) {
  getJSON.mockResolvedValue({ item: initial });
  const view = renderHook(() => useEditorState('c1', vi.fn()));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  // Every test below reorders away from this; if the fixture stopped producing
  // it the reorders would be no-ops and the suite would pass vacuously.
  expect(view.result.current.orderedImages.map((image) => image.url)).toEqual(['/a.png', '/b.png']);
  return view;
}

/**
 * The image order the editor is holding.
 *
 * The hook exposes it as display objects, not the bare list it stores, so
 * these two helpers go through the same surface the drag-and-drop UI uses.
 */
const imageOrder = (view) => view.result.current.orderedImages.map((image) => image.url);

const reorderImages = (view, urls) =>
  act(() => view.result.current.updateOrderedImages(urls.map((url) => ({ url }))));

/** Drive one poll tick with a given document. */
async function tick(view, item) {
  getJSON.mockResolvedValue({ item });
  await act(async () => {
    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(getJSON).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('T-209 — unchanged ticks leave local state alone', () => {
  it('does not discard an in-progress image reorder', async () => {
    // The defect, in one assertion: reorder, wait twenty seconds, lose it.
    const view = await mountEditor();

    reorderImages(view, ['/b.png', '/a.png']);
    expect(imageOrder(view)).toEqual(['/b.png', '/a.png']);

    await tick(view, doc()); // same blogEditedAt — nothing actually changed

    expect(imageOrder(view)).toEqual(['/b.png', '/a.png']);
  });

  it('survives many idle ticks', async () => {
    const view = await mountEditor();
    reorderImages(view, ['/b.png', '/a.png']);

    for (let i = 0; i < 5; i += 1) await tick(view, doc());

    expect(imageOrder(view)).toEqual(['/b.png', '/a.png']);
    expect(view.result.current.externallyModified).toBe(false);
  });

  it('still adopts image order from a genuine remote change', async () => {
    // The early return must not turn into "ignore the remote document".
    const view = await mountEditor();
    reorderImages(view, ['/b.png', '/a.png']);

    // Older than our load time, so not flagged as a conflicting edit, but a
    // marker we have not seen.
    await tick(
      view,
      doc({
        blogEditedAt: '2026-06-01T10:00:00.000Z',
        heroImageUrl: '/c.png',
        secondaryImageUrls: [],
      })
    );

    expect(imageOrder(view)).toEqual(['/c.png']);
  });
});

describe('T-208 — a collaborator’s save is not mistaken for our own', () => {
  it('flags a remote edit that arrives after we saved', async () => {
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true, blogEditedAt: MINE });
    await act(async () => {
      await view.result.current.handleSave();
    });
    expect(view.result.current.externallyModified).toBe(false);

    // Someone else saves. Under the old one-shot flag this response was
    // consumed as "our pending save": externallyModified was cleared and their
    // marker became our baseline.
    await tick(view, doc({ blogEditedAt: THEIRS }));

    expect(view.result.current.externallyModified).toBe(true);
  });

  it('refuses the next save instead of overwriting them', async () => {
    // The consequence that made this a lost-update bug rather than a stale-UI
    // one: with their marker adopted, the next save passed the server's
    // equality check and their work disappeared with no warning to either
    // person.
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true, blogEditedAt: MINE });
    await act(async () => {
      await view.result.current.handleSave();
    });

    await tick(view, doc({ blogEditedAt: THEIRS }));
    postJSON.mockClear();

    await act(async () => {
      await view.result.current.handleSave();
    });

    expect(postJSON).not.toHaveBeenCalled();
    expect(view.result.current.saveError).toMatch(/changed remotely/i);
  });

  it('does not flag our own save when the poll returns it', async () => {
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true, blogEditedAt: MINE });
    await act(async () => {
      await view.result.current.handleSave();
    });

    await tick(view, doc({ blogEditedAt: MINE }));

    expect(view.result.current.externallyModified).toBe(false);
  });

  it('keeps a reorder made after saving', async () => {
    // The two fixes meet here: the poll returns our own write, which is both
    // "already seen" and "not a remote edit".
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true, blogEditedAt: MINE });
    await act(async () => {
      await view.result.current.handleSave();
    });
    reorderImages(view, ['/b.png', '/a.png']);

    await tick(view, doc({ blogEditedAt: MINE }));

    expect(imageOrder(view)).toEqual(['/b.png', '/a.png']);
  });
});

describe('T-208 — the save marker comes from the server', () => {
  it('sends the freshly written marker on an immediately following save', async () => {
    // Second save inside the poll window. The client used to keep the pre-save
    // value until the next tick, so this conflicted with the caller's own
    // previous write.
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true, blogEditedAt: MINE });
    await act(async () => {
      await view.result.current.handleSave();
    });
    await act(async () => {
      await view.result.current.handleSave();
    });

    expect(postJSON).toHaveBeenCalledTimes(2);
    expect(postJSON.mock.calls[0][1].expectedEditedAtMs).toBe(Date.parse(LOADED));
    expect(postJSON.mock.calls[1][1].expectedEditedAtMs).toBe(Date.parse(MINE));
  });

  it('falls back to the poll when the server returns no marker', async () => {
    // An older deployment. Adopting a 0 would make every later tick look like
    // a remote edit and wedge the editor in "changed remotely" forever.
    const view = await mountEditor();

    postJSON.mockResolvedValue({ success: true });
    await act(async () => {
      await view.result.current.handleSave();
    });

    await tick(view, doc());
    expect(view.result.current.externallyModified).toBe(false);
  });
});
