/**
 * The Linkie contract, tested where it is read rather than inside the page.
 *
 * The fixtures below are the two shapes that actually meet here, and the whole
 * point is that they are two:
 *
 *   - Linkie's own body, as Site-Main reads it — `{ data: { profiles: [...] } }`
 *     for profiles, a bare array or `{ data: [...] }` for posts. Site-Main is
 *     the system this repository was migrated from and has been calling this
 *     API in production since before the migration.
 *   - this repository's proxy envelope around it — `{ ok, status, data }` at
 *     HTTP 200 for every outcome (functions/src/lib/integrations/rest-proxy.js).
 *
 * A reader ported from Site-Main without the second is one level short, and a
 * reader that ignores `ok` turns a Linkie 401 into an empty list. Both of those
 * have shipped here before (#397, on the Publer side).
 */
import { describe, it, expect } from 'vitest';

import {
  EMPTY_POST_FORM,
  LINKIE_IMAGE_CONTAINER,
  LINKIE_NOT_CONFIGURED,
  LINKIE_POST_IMAGE_CANDIDATE_KEYS,
  LINKIE_POST_IMAGE_FIELD,
  buildPostPayload,
  contentItemPostPayload,
  createPostsBody,
  describeLinkieFailure,
  extractPostImage,
  extractPosts,
  extractProfiles,
  extractTrafficStats,
  linkieImagePath,
  linkiePaths,
  toPublicImageUrl,
  profileLabel,
  readLinkieBody,
  selectProfile,
  trafficStatCards,
  unwrapLinkie,
  validatePostForm,
  visibleLinksState,
} from './linkie';

/** One profile, as Linkie nests them, wrapped in the proxy envelope. */
const profilesEnvelope = (profiles) => ({ ok: true, status: 200, data: { data: { profiles } } });
/** Posts come back under `data` on the raw body, so twice down through the envelope. */
const postsEnvelope = (posts) => ({ ok: true, status: 200, data: { data: posts } });

describe('unwrapLinkie', () => {
  it('reads the proxy envelope, and keeps its four outcomes apart', () => {
    expect(unwrapLinkie({ ok: true, status: 200, data: { hello: 'world' } })).toEqual({
      body: { hello: 'world' },
      notConfigured: false,
      failed: false,
      status: 200,
      reason: '',
    });

    // An unseeded key. Not a fault — the Connections page renders this as
    // "not connected", so it must not be confused with a failure.
    expect(
      unwrapLinkie({
        ok: false,
        code: LINKIE_NOT_CONFIGURED,
        error: 'Linkie is not configured: LINKIE_API_KEY is not set',
      })
    ).toEqual({
      body: null,
      notConfigured: true,
      failed: false,
      status: null,
      reason: 'Linkie is not configured: LINKIE_API_KEY is not set',
    });

    // Linkie refused the key. This arrives as a RESOLVED promise at HTTP 200,
    // so nothing but `failed` stops a caller reading it as "no links".
    expect(unwrapLinkie({ ok: false, status: 401, data: { message: 'Unauthorized' } })).toEqual({
      body: null,
      notConfigured: false,
      failed: true,
      status: 401,
      reason: '',
    });

    // The proxy's own fetch threw; there is no upstream status to report.
    expect(unwrapLinkie({ ok: false, error: 'Linkie request failed: fetch failed' })).toEqual({
      body: null,
      notConfigured: false,
      failed: true,
      status: null,
      reason: 'Linkie request failed: fetch failed',
    });
  });
});

describe('readLinkieBody', () => {
  it('returns the body when Linkie answered', () => {
    expect(readLinkieBody({ ok: true, status: 200, data: { data: [] } })).toEqual({ data: [] });
  });

  it('throws on a refused key, so a write cannot report success', () => {
    // Create/edit/delete all resolve through the proxy whatever Linkie says.
    // Without this throw the page shows "Added to Linkie" and reloads a list
    // that never changed.
    expect(() => readLinkieBody({ ok: false, status: 401 })).toThrow('Linkie answered 401');
    expect(() => readLinkieBody({ ok: false, status: 403, error: 'Forbidden' })).toThrow(
      'Linkie answered 403 — Forbidden'
    );
    expect(() =>
      readLinkieBody({ ok: false, code: LINKIE_NOT_CONFIGURED, error: 'LINKIE_API_KEY is not set' })
    ).toThrow('LINKIE_API_KEY is not set');
    expect(() => readLinkieBody({ ok: false, error: 'fetch failed' })).toThrow('fetch failed');
  });
});

describe('describeLinkieFailure', () => {
  it('leads with the upstream status, because that is what names a bad key', () => {
    expect(describeLinkieFailure({ status: 401, reason: '' })).toBe('Linkie answered 401');
    expect(describeLinkieFailure({ status: null, reason: 'boom' })).toBe('boom');
    expect(describeLinkieFailure({})).toBe('the request failed');
  });
});

describe('extractProfiles', () => {
  it('reads through BOTH wrappers — the envelope and Linkie’s own', () => {
    const profiles = [{ _id: 'p1', username: 'hcw' }];
    // `response.data` is the envelope's; `.data.profiles` is Linkie's.
    expect(extractProfiles(profilesEnvelope(profiles))).toEqual(profiles);
  });

  it('tolerates a flatter body and an already-unwrapped caller', () => {
    const profiles = [{ _id: 'p1' }];
    expect(extractProfiles({ ok: true, status: 200, data: { profiles } })).toEqual(profiles);
    expect(extractProfiles({ data: { profiles } })).toEqual(profiles);
    expect(extractProfiles(profiles)).toEqual(profiles);
  });

  it('drops entries with no _id, since every posts path is built from it', () => {
    expect(extractProfiles(profilesEnvelope([{ _id: 'p1' }, { name: 'no id' }, null]))).toEqual([
      { _id: 'p1' },
    ]);
  });

  it('returns nothing for a failed call rather than an empty success', () => {
    expect(extractProfiles({ ok: false, status: 401 })).toEqual([]);
    expect(extractProfiles(profilesEnvelope([]))).toEqual([]);
  });
});

describe('selectProfile', () => {
  const profiles = [{ _id: 'p1' }, { _id: 'p2' }, { _id: 'p3' }];

  it('honours the operator’s choice when there is more than one profile', () => {
    expect(selectProfile(profiles, 'p2')).toEqual({ _id: 'p2' });
  });

  it('falls back to the first, and ignores a choice that is no longer there', () => {
    expect(selectProfile(profiles)).toEqual({ _id: 'p1' });
    expect(selectProfile(profiles, 'deleted')).toEqual({ _id: 'p1' });
  });

  it('returns null rather than a partial object when there is nothing to pick', () => {
    expect(selectProfile([])).toBeNull();
    expect(selectProfile(undefined)).toBeNull();
    expect(selectProfile([{ name: 'no id' }])).toBeNull();
  });
});

describe('profileLabel', () => {
  it('names a profile when it can, and falls back to the one proven field', () => {
    expect(profileLabel({ _id: 'p1', username: 'hcw' })).toBe('hcw');
    expect(profileLabel({ _id: 'p1', name: ' Hybrid ' })).toBe('Hybrid');
    expect(profileLabel({ _id: 'p1' })).toBe('p1');
    expect(profileLabel({ _id: 'p1', username: '   ' })).toBe('p1');
  });
});

describe('extractPosts', () => {
  it('reads the array Linkie nests under data, through the envelope', () => {
    const posts = [{ _id: 'x1', url: 'https://a.test', provider: 'wordpress' }];
    expect(extractPosts(postsEnvelope(posts))).toEqual(posts);
    expect(extractPosts({ ok: true, status: 200, data: posts })).toEqual(posts);
    expect(extractPosts(posts)).toEqual(posts);
  });

  it('is empty for a refused key, never a partially-read list', () => {
    expect(extractPosts({ ok: false, status: 401, data: { message: 'Unauthorized' } })).toEqual([]);
    expect(extractPosts({ ok: false, code: LINKIE_NOT_CONFIGURED })).toEqual([]);
  });
});

describe('buildPostPayload', () => {
  it('maps the form to Linkie’s snake_case fields', () => {
    expect(
      buildPostPayload({
        url: '  https://hybridcloudworks.com/a  ',
        provider: 'wordpress',
        accountName: 'HybridCloudWorks',
        postType: 'article',
        text: '  My latest article  ',
      })
    ).toEqual({
      url: 'https://hybridcloudworks.com/a',
      provider: 'wordpress',
      account_name: 'HybridCloudWorks',
      post_type: 'article',
      text: 'My latest article',
    });
  });

  it('omits an empty caption rather than sending one', () => {
    const payload = buildPostPayload({
      url: 'https://a.test',
      provider: 'wordpress',
      accountName: 'HybridCloudWorks',
      postType: 'link',
      text: '   ',
    });
    expect(payload).not.toHaveProperty('text');
  });

  it('pins the unconfirmed image field name, so changing it is a deliberate edit (#501)', () => {
    expect(LINKIE_POST_IMAGE_FIELD).toBe('thumbnail');
  });

  it('adds the image under LINKIE_POST_IMAGE_FIELD when one is set', () => {
    const payload = buildPostPayload({
      url: 'https://a.test',
      provider: 'wordpress',
      accountName: 'HybridCloudWorks',
      postType: 'article',
      imageUrl: '  https://cdn.test/cover.png  ',
    });
    expect(payload[LINKIE_POST_IMAGE_FIELD]).toBe('https://cdn.test/cover.png');
  });

  it('sends no image key at all when there is no image, blank or missing', () => {
    // A post without an image must be byte-identical to what was sent before
    // #501, so an unconfirmed field name never reaches Linkie by default.
    const base = {
      url: 'https://a.test',
      provider: 'wordpress',
      accountName: 'HybridCloudWorks',
      postType: 'article',
    };
    const expected = {
      url: 'https://a.test',
      provider: 'wordpress',
      account_name: 'HybridCloudWorks',
      post_type: 'article',
    };
    expect(buildPostPayload(base)).toEqual(expected);
    expect(buildPostPayload({ ...base, imageUrl: '   ' })).toEqual(expected);
    expect(JSON.stringify(buildPostPayload({ ...EMPTY_POST_FORM, url: 'https://a.test' }))).toBe(
      JSON.stringify({
        url: 'https://a.test',
        provider: 'wordpress',
        account_name: 'HybridCloudWorks',
        post_type: 'article',
      })
    );
  });
});

describe('extractPostImage', () => {
  it.each(LINKIE_POST_IMAGE_CANDIDATE_KEYS)('reads an https URL from `%s`', (key) => {
    expect(extractPostImage({ [key]: 'https://cdn.test/x.png' })).toBe('https://cdn.test/x.png');
  });

  it('reads media[0].url and media[0].path', () => {
    expect(extractPostImage({ media: [{ url: 'https://cdn.test/u.png' }] })).toBe(
      'https://cdn.test/u.png'
    );
    expect(extractPostImage({ media: [{ path: 'https://cdn.test/p.png' }] })).toBe(
      'https://cdn.test/p.png'
    );
  });

  it('takes the first candidate that is https, skipping ones that are not', () => {
    expect(
      extractPostImage({
        thumbnail: 'http://cdn.test/insecure.png',
        image: 'https://cdn.test/secure.png',
      })
    ).toBe('https://cdn.test/secure.png');
  });

  it('rejects non-https values and non-objects', () => {
    expect(extractPostImage({ thumbnail: 'http://cdn.test/x.png' })).toBe('');
    expect(extractPostImage({ image: 'javascript:alert(1)' })).toBe('');
    expect(extractPostImage({ image: 'data:image/png;base64,AAAA' })).toBe('');
    expect(extractPostImage({ picture: '/relative.png' })).toBe('');
    expect(extractPostImage({ image: { url: 'https://cdn.test/x.png' } })).toBe('');
    expect(extractPostImage({})).toBe('');
    expect(extractPostImage(null)).toBe('');
  });
});

describe('toPublicImageUrl', () => {
  const identity = (url) => url;

  it('keeps an absolute https URL the resolver produced', () => {
    const resolve = (url) => `https://api-azure.hybridcloudworks.com${url}`;
    expect(toPublicImageUrl('/api/public/media/covers/a.png', { resolve })).toBe(
      'https://api-azure.hybridcloudworks.com/api/public/media/covers/a.png'
    );
  });

  it('prefixes the page origin when the path stays relative', () => {
    expect(
      toPublicImageUrl('/api/public/media/covers/a.png', {
        resolve: identity,
        origin: 'https://www.hybridcloudworks.com/',
      })
    ).toBe('https://www.hybridcloudworks.com/api/public/media/covers/a.png');
  });

  it('returns empty for anything Linkie could not fetch', () => {
    expect(toPublicImageUrl('', { resolve: identity, origin: 'https://a.test' })).toBe('');
    expect(toPublicImageUrl('/x.png', { resolve: identity, origin: 'http://localhost:3000' })).toBe(
      ''
    );
    expect(toPublicImageUrl('/x.png', { resolve: identity })).toBe('');
    expect(
      toPublicImageUrl('//evil.test/x.png', { resolve: identity, origin: 'https://a.test' })
    ).toBe('');
  });
});

describe('linkieImagePath', () => {
  it('stores under linkie/ with a timestamped, randomised name and the given extension', () => {
    expect(linkieImagePath('webp', { now: 1700000000000, random: 'abc123' })).toBe(
      'linkie/1700000000000-abc123.webp'
    );
    expect(LINKIE_IMAGE_CONTAINER).toBe('covers');
  });
});

describe('createPostsBody', () => {
  it('wraps the post in the array the endpoint takes', () => {
    // POST /profiles/:id/posts is plural: the bare object is a 400 whose
    // message talks about a field rather than the shape.
    const post = buildPostPayload({ url: 'https://a.test', provider: 'wordpress' });
    expect(createPostsBody(post)).toEqual([post]);
  });
});

describe('contentItemPostPayload', () => {
  it('puts the article title in `text`, because a Linkie post has no title', () => {
    // This is the whole mapping the old form hid: it collected Title + URL and
    // posted them to an endpoint that does not exist. A post has url, provider,
    // account_name, post_type and text — and text is the caption.
    expect(
      contentItemPostPayload({
        title: 'Landing zones without the theatre',
        url: 'https://hybridcloudworks.com/blog/landing-zones',
      })
    ).toEqual({
      url: 'https://hybridcloudworks.com/blog/landing-zones',
      provider: 'wordpress',
      account_name: 'HybridCloudWorks',
      post_type: 'article',
      text: 'Landing zones without the theatre',
    });
  });

  it('sends the cover image under the image field when the item has one', () => {
    const payload = contentItemPostPayload({
      title: 'Landing zones',
      url: 'https://hybridcloudworks.com/blog/landing-zones',
      imageUrl: 'https://api-azure.hybridcloudworks.com/api/public/media/covers/a.png',
    });
    expect(payload[LINKIE_POST_IMAGE_FIELD]).toBe(
      'https://api-azure.hybridcloudworks.com/api/public/media/covers/a.png'
    );
  });

  it('still produces a valid post when the item has no title', () => {
    const payload = contentItemPostPayload({ url: 'https://a.test' });
    expect(payload).not.toHaveProperty('text');
    expect(payload.post_type).toBe('article');
  });
});

describe('validatePostForm', () => {
  it('requires the fields Linkie requires, and text only where it is the content', () => {
    expect(validatePostForm({ url: '', accountName: 'HCW', postType: 'article' })).toBe(
      'A URL is required'
    );
    expect(validatePostForm({ url: 'https://a.test', accountName: ' ', postType: 'article' })).toBe(
      'An account name is required'
    );
    expect(
      validatePostForm({ url: 'https://a.test', accountName: 'HCW', postType: 'text', text: '' })
    ).toBe('Text is required for this post type');
    expect(
      validatePostForm({ url: 'https://a.test', accountName: 'HCW', postType: 'article', text: '' })
    ).toBe('');
  });
});

describe('linkiePaths', () => {
  it('builds the profile-scoped shapes the proxy allowlist matches', () => {
    // The allowlist patterns are /^\/profiles\/[^/]+\/posts$/ and
    // /^\/profiles\/[^/]+\/posts\/[^/]+$/ — see
    // functions/src/functions/integrations-http.js. There is no /links.
    expect(linkiePaths.profiles()).toBe('/profiles');
    expect(linkiePaths.posts('p1')).toBe('/profiles/p1/posts');
    expect(linkiePaths.post('p1', 'x9')).toBe('/profiles/p1/posts/x9');
    expect(linkiePaths.trafficStats('p1')).toBe('/analytics/traffic-stats?link_in_bio_id=p1');
  });

  it('encodes ids so a stray separator cannot widen the match', () => {
    // `[^/]+` is one segment. An unencoded slash would make
    // /profiles/a/b/posts, which the allowlist rejects — loudly, but for the
    // wrong reason, and only after the id has already been mangled.
    expect(linkiePaths.posts('a/b')).toBe('/profiles/a%2Fb/posts');
    expect(linkiePaths.post('p1', 'x/9')).toBe('/profiles/p1/posts/x%2F9');
    expect(linkiePaths.trafficStats('a b&c')).toBe(
      '/analytics/traffic-stats?link_in_bio_id=a%20b%26c'
    );
  });
});

describe('extractTrafficStats and trafficStatCards', () => {
  it('reads the summary through both wrappers', () => {
    const summary = { total_visitors: 120, unique_visitors: 90, bounce_rate: 41 };
    expect(extractTrafficStats({ ok: true, status: 200, data: { data: summary } })).toEqual(
      summary
    );
    expect(extractTrafficStats({ ok: true, status: 200, data: summary })).toEqual(summary);
    expect(extractTrafficStats({ ok: false, status: 401 })).toEqual({});
  });

  it('shows a genuine zero and drops a metric Linkie did not return', () => {
    // Absent and zero are different facts: `unique_clicks: 0` is a measurement,
    // a missing `total_subscribers` is not.
    expect(trafficStatCards({ total_visitors: 120, unique_clicks: 0, bounce_rate: 0 })).toEqual([
      { label: 'Total Visitors', value: 120 },
      { label: 'Unique Clicks', value: 0 },
      { label: 'Bounce Rate', value: '0%' },
    ]);
    expect(trafficStatCards({})).toEqual([]);
    expect(trafficStatCards(null)).toEqual([]);
  });
});

describe('visibleLinksState', () => {
  const withPosts = { posts: [{ _id: 'x', url: 'https://a' }], error: 'boom' };

  it('shows nothing when there is no profile, even though a result is held', () => {
    // The regression: `loading` is false when profileId is null, so a naive
    // `loading ? [] : result.posts` leaks the previous profile's list into a
    // state where every write is gated. Caught in review on #429.
    expect(visibleLinksState({ profileId: null, loading: false, result: withPosts })).toEqual({
      posts: [],
      error: '',
    });
  });

  it('shows nothing while a fetch is in flight', () => {
    expect(visibleLinksState({ profileId: 'p1', loading: true, result: withPosts })).toEqual({
      posts: [],
      error: '',
    });
  });

  it('shows the result once a profile is selected and the fetch has settled', () => {
    expect(visibleLinksState({ profileId: 'p1', loading: false, result: withPosts })).toEqual({
      posts: withPosts.posts,
      error: 'boom',
    });
  });

  it('does not throw on a result it has never been given', () => {
    expect(visibleLinksState({ profileId: 'p1', loading: false, result: undefined })).toEqual({
      posts: [],
      error: '',
    });
  });
});
