/**
 * Curated news images on the PUBLIC news pages.
 *
 * #63 moved the cache lookup off an anonymous Firestore read onto
 * `getJSON('cms/images/curated/...')` — an editor-gated endpoint reached
 * through `acquireApiToken`, which throws outright without an MSAL account.
 * The hook runs on `/{provider}/news`, so for every anonymous visitor the
 * lookups failed and the grid rendered no curated imagery where cached images
 * used to appear (TODO.md T-210).
 *
 * The assertions are about WHO calls WHAT, because that is the whole defect:
 * reading a cached image must be anonymous, and everything behind the admin
 * gate must not be attempted when nobody is signed in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fetchPublicCuratedImage = vi.fn();
const fetchPublicCuratedImages = vi.fn();
const postJSON = vi.fn();
const resolvePromptForPage = vi.fn();
/**
 * Mirrors `useAdminAuth`: `hasRole` answers from the admin status fetched after
 * sign-in, so it is false for an anonymous visitor AND false while that fetch
 * is still in flight. The role hierarchy is viewer < editor < publisher <
 * super_admin, and generation needs `editor`.
 */
const ROLE_RANK = { viewer: 1, editor: 2, publisher: 3, super_admin: 4 };
let authState;
const setAuth = ({ user = null, role = null } = {}) => {
  authState = {
    user,
    hasRole: (required) => (ROLE_RANK[role] || 0) >= (ROLE_RANK[required] || 999),
  };
};

vi.mock('@/lib/publicApi', () => ({
  fetchPublicCuratedImage: (...args) => fetchPublicCuratedImage(...args),
  fetchPublicCuratedImages: (...args) => fetchPublicCuratedImages(...args),
}));
vi.mock('@/lib/api', () => ({
  postJSON: (...args) => postJSON(...args),
  getJSON: () => {
    throw new Error('getJSON is authenticated — the public news path must not reach it');
  },
}));
vi.mock('@/hooks/useImagePrompts', () => ({
  useImagePrompts: () => ({ resolvePromptForPage }),
}));
vi.mock('@/hooks/useAdminAuth', () => ({ useAdminAuth: () => authState }));
vi.mock('@/lib/functionsBase', () => ({
  getFunctionsBase: () => 'https://hcw-functions.azurewebsites.net/api',
}));

const { useGenerateCuratedImages } = await import('./useGenerateCuratedImages.js');

const ARTICLES = [
  { id: 'a1', title: 'One' },
  { id: 'a2', title: 'Two' },
];

const anonymous = () => setAuth();
const signedIn = () => setAuth({ user: { uid: 'admin-1' }, role: 'editor' });
/** Signed in, but below the role the server requires. */
const viewer = () => setAuth({ user: { uid: 'viewer-1' }, role: 'viewer' });
/** Signed in, admin status still in flight — no role known yet. */
const resolving = () => setAuth({ user: { uid: 'admin-1' } });

async function run(articles = ARTICLES) {
  const view = renderHook(() => useGenerateCuratedImages('/aws/news', 'AWS'));
  await act(async () => {
    await view.result.current.generateImagesForArticles(articles);
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  anonymous();
  fetchPublicCuratedImage.mockResolvedValue(null);
  // The batched read is the path the grid actually takes (T-739). Default it
  // to "asked, nothing cached" so each test states its own cache state.
  fetchPublicCuratedImages.mockImplementation(async (ids) =>
    Object.fromEntries((ids || []).filter(Boolean).map((id) => [id, null]))
  );
  postJSON.mockResolvedValue({ imageUrl: 'https://cdn.example/new.png' });
  resolvePromptForPage.mockResolvedValue({ primaryPrompt: 'house style' });
});

/** Make the batched cache read answer with a url for every id it is asked. */
const cacheHasAll = () =>
  fetchPublicCuratedImages.mockImplementation(async (ids) =>
    Object.fromEntries(
      (ids || []).filter(Boolean).map((id) => [id, `https://cdn.example/${id}.png`])
    )
  );

describe('anonymous visitor', () => {
  it('renders cached imagery — the regression, stated directly', async () => {
    cacheHasAll();

    const view = await run();

    await waitFor(() =>
      expect(view.result.current.imageMap).toEqual({
        a1: 'https://cdn.example/a1.png',
        a2: 'https://cdn.example/a2.png',
      })
    );
  });

  it('reads the whole grid in ONE anonymous request, not one per article', async () => {
    // T-739: this used to issue one GET per card — twelve round trips for a
    // twelve-card grid, on a route that had already fetched the feed.
    await run();
    expect(fetchPublicCuratedImages).toHaveBeenCalledTimes(1);
    expect(fetchPublicCuratedImages).toHaveBeenCalledWith(['a1', 'a2']);
    expect(fetchPublicCuratedImage).not.toHaveBeenCalled();
  });

  it('never attempts generation', async () => {
    // Not merely "the request fails" — it must not be made. Generation is
    // editor-gated, so anonymously it is a guaranteed-failing call that also
    // drags MSAL onto the critical path of a public page.
    await run();
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('never reads the editor-only prompt configuration', async () => {
    // It used to: the call threw, a default prompt was substituted, and the
    // default was then used for nothing, because generation is gated too.
    await run();
    expect(resolvePromptForPage).not.toHaveBeenCalled();
  });

  it('leaves uncached articles without an image rather than erroring', async () => {
    fetchPublicCuratedImages.mockResolvedValue({ a1: 'https://cdn.example/a1.png', a2: null });

    const view = await run();

    expect(view.result.current.imageMap).toEqual({ a1: 'https://cdn.example/a1.png' });
    expect(view.result.current.error).toBeNull();
  });

  it('survives the public endpoint failing', async () => {
    fetchPublicCuratedImages.mockRejectedValue(new Error('network down'));
    fetchPublicCuratedImage.mockRejectedValue(new Error('network down'));
    const view = await run();
    expect(view.result.current.imageMap).toEqual({});
    expect(view.result.current.error).toBeNull();
  });

  it('falls back to the per-article read when the batch fails', async () => {
    // A failed batch must not be read as "no article has a cover" — that would
    // turn one bad request into a grid with no imagery, which is the T-210
    // regression this hook exists to prevent.
    fetchPublicCuratedImages.mockRejectedValue(new Error('batch endpoint down'));
    fetchPublicCuratedImage.mockImplementation(async (id) => `https://cdn.example/${id}.png`);

    const view = await run();

    await waitFor(() =>
      expect(view.result.current.imageMap).toEqual({
        a1: 'https://cdn.example/a1.png',
        a2: 'https://cdn.example/a2.png',
      })
    );
  });
});

describe('signed-in admin', () => {
  beforeEach(signedIn);

  it('still reads the cache anonymously before generating', async () => {
    fetchPublicCuratedImages.mockResolvedValue({ a1: 'https://cdn.example/cached.png' });
    await run([{ id: 'a1' }]);
    expect(fetchPublicCuratedImages).toHaveBeenCalledWith(['a1']);
    expect(postJSON).not.toHaveBeenCalled(); // cached — nothing to generate
  });

  it('generates the images the cache does not have', async () => {
    const view = await run([{ id: 'a1', title: 'One' }]);

    expect(postJSON).toHaveBeenCalledTimes(1);
    expect(postJSON.mock.calls[0][0]).toBe('generateCuratedArticleImage');
    expect(view.result.current.imageMap).toEqual({ a1: 'https://cdn.example/new.png' });
  });

  it('uses the configured prompt', async () => {
    await run([{ id: 'a1' }]);
    expect(resolvePromptForPage).toHaveBeenCalledWith('/aws/news');
    expect(postJSON.mock.calls[0][1].basePrompt).toBe('house style');
  });

  it('falls back to a provider default when no prompt is assigned', async () => {
    resolvePromptForPage.mockResolvedValue(null);
    await run([{ id: 'a1' }]);
    expect(postJSON.mock.calls[0][1].basePrompt).toMatch(/AWS/);
  });
});

describe('signed in below the required role', () => {
  beforeEach(viewer);

  it('reads the cache but attempts nothing editor-gated', async () => {
    // Generation and the prompt read are both `editor`-gated server-side, so a
    // viewer gated only on "somebody is signed in" would collect a 403 for the
    // prompt read and one per article — the same requests-that-cannot-succeed
    // defect as T-210, with a narrower audience.
    fetchPublicCuratedImages.mockResolvedValue({ a1: 'https://cdn.example/a1.png' });
    const view = await run([{ id: 'a1' }]);

    expect(view.result.current.imageMap).toEqual({ a1: 'https://cdn.example/a1.png' });
    expect(postJSON).not.toHaveBeenCalled();
    expect(resolvePromptForPage).not.toHaveBeenCalled();
  });
});

describe('before the session resolves', () => {
  it('attempts nothing editor-gated while the role is unknown', async () => {
    // `useAdminAuth` sets `user` and then awaits the admin-status fetch, so
    // there is a real render with a user present and no role yet. Acting there
    // would fire an editor-gated request before knowing the account is an
    // editor.
    resolving();
    await run([{ id: 'a1' }]);
    expect(postJSON).not.toHaveBeenCalled();
    expect(resolvePromptForPage).not.toHaveBeenCalled();
  });

  it('generates once the role is known', async () => {
    // The other direction: waiting must not become never.
    signedIn();
    await run([{ id: 'a1' }]);
    expect(postJSON).toHaveBeenCalledTimes(1);
  });
});
