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
const postJSON = vi.fn();
const resolvePromptForPage = vi.fn();
let authState = { authReady: true, user: null };

vi.mock('@/lib/publicApi', () => ({
  fetchPublicCuratedImage: (...args) => fetchPublicCuratedImage(...args),
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

const anonymous = () => {
  authState = { authReady: true, user: null };
};
const signedIn = () => {
  authState = { authReady: true, user: { uid: 'admin-1' } };
};
const resolving = () => {
  authState = { authReady: false, user: null };
};

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
  postJSON.mockResolvedValue({ imageUrl: 'https://cdn.example/new.png' });
  resolvePromptForPage.mockResolvedValue({ primaryPrompt: 'house style' });
});

describe('anonymous visitor', () => {
  it('renders cached imagery — the regression, stated directly', async () => {
    fetchPublicCuratedImage.mockImplementation(async (id) => `https://cdn.example/${id}.png`);

    const view = await run();

    await waitFor(() =>
      expect(view.result.current.imageMap).toEqual({
        a1: 'https://cdn.example/a1.png',
        a2: 'https://cdn.example/a2.png',
      })
    );
  });

  it('reads the cache through the anonymous endpoint, once per article', async () => {
    await run();
    expect(fetchPublicCuratedImage.mock.calls.map(([id]) => id)).toEqual(['a1', 'a2']);
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
    fetchPublicCuratedImage.mockImplementation(async (id) =>
      id === 'a1' ? 'https://cdn.example/a1.png' : null
    );

    const view = await run();

    expect(view.result.current.imageMap).toEqual({ a1: 'https://cdn.example/a1.png' });
    expect(view.result.current.error).toBeNull();
  });

  it('survives the public endpoint failing', async () => {
    fetchPublicCuratedImage.mockRejectedValue(new Error('network down'));
    const view = await run();
    expect(view.result.current.imageMap).toEqual({});
    expect(view.result.current.error).toBeNull();
  });
});

describe('signed-in admin', () => {
  beforeEach(signedIn);

  it('still reads the cache anonymously before generating', async () => {
    fetchPublicCuratedImage.mockResolvedValue('https://cdn.example/cached.png');
    await run([{ id: 'a1' }]);
    expect(fetchPublicCuratedImage).toHaveBeenCalledWith('a1');
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

describe('before auth resolves', () => {
  it('makes no authenticated call while the session is unknown', async () => {
    resolving();
    await run([{ id: 'a1' }]);
    expect(postJSON).not.toHaveBeenCalled();
    expect(resolvePromptForPage).not.toHaveBeenCalled();
  });

  it('waits for admin status even once a user is known', async () => {
    // `useAdminAuth` sets `user` and then awaits the admin-status fetch before
    // flipping `authReady`, so there is a real render in between with a user
    // present and the session still indeterminate. Generating there would fire
    // an editor-gated request before knowing whether this account is an editor.
    // This is the case that makes `authReady` load-bearing rather than
    // redundant with `Boolean(user)`.
    authState = { authReady: false, user: { uid: 'admin-1' } };
    await run([{ id: 'a1' }]);
    expect(postJSON).not.toHaveBeenCalled();
  });

  it('generates once the session resolves', async () => {
    // The other direction: waiting must not become never.
    signedIn();
    await run([{ id: 'a1' }]);
    expect(postJSON).toHaveBeenCalledTimes(1);
  });
});
