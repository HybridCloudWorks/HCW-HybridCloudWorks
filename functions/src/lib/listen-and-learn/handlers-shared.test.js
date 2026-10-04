/**
 * The route and body readers every Listen & Learn route goes through
 * (PR #841 split of handlers.js). The routes themselves stay pinned in
 * handlers.test.js and handlers.library.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseBody, readRequest, readRoute, truthyQuery } from './handlers-shared.js';

const request = (params, body, query = {}) => ({
  params,
  query: { get: (name) => query[name] },
  json: vi.fn(async () => body),
});

describe('readRoute', () => {
  it('lower-cases the platform and refuses a route with a part missing', () => {
    const route = readRoute(request({ platform: 'Azure', examCode: 'AZ-104' }));
    expect(route).toMatchObject({ ok: true, ref: { platform: 'azure', examCode: 'AZ-104' } });
    expect(readRoute(request({ platform: 'azure' }))).toEqual({
      ok: false,
      status: 400,
      error: 'platform and examCode are required',
    });
  });

  it('validates the chapter and version ids as far as the route goes', () => {
    const base = { platform: 'azure', examCode: 'AZ-104' };
    expect(readRoute(request({ ...base, chapterId: 'Bad Id' }), { chapter: true })).toMatchObject({
      ok: false,
      error: 'platform, examCode and chapterId are required',
    });
    expect(
      readRoute(request({ ...base, chapterId: 'intro', versionId: 'v-1' }), {
        chapter: true,
        version: true,
      })
    ).toMatchObject({
      ok: false,
      error: 'platform, examCode, chapterId and versionId are required',
    });
    expect(
      readRoute(request({ ...base, chapterId: 'intro', versionId: 'abc123' }), {
        chapter: true,
        version: true,
      })
    ).toMatchObject({ ok: true, chapterId: 'intro', versionId: 'abc123' });
  });
});

describe('parseBody and readRequest', () => {
  const parse = (body) => (body.name ? { value: { name: body.name } } : { error: 'name required' });

  it('refuses a body that is not a plain object, then whatever the parser refuses', () => {
    expect(parseBody([], parse)).toEqual({
      ok: false,
      status: 400,
      error: 'Body must be a JSON object',
    });
    expect(parseBody({}, parse)).toEqual({ ok: false, status: 400, error: 'name required' });
    expect(parseBody({ name: 'x' }, parse)).toEqual({
      ok: true,
      body: { name: 'x' },
      parsed: { name: 'x' },
    });
  });

  it('reads the route first, then the body, and can treat no body as an empty one', async () => {
    const bad = await readRequest(request({ platform: 'azure' }, { name: 'x' }), { parse });
    expect(bad).toMatchObject({ ok: false, error: 'platform and examCode are required' });

    const ref = { platform: 'azure', examCode: 'AZ-104' };
    const noBody = await readRequest(request(ref, null), { parse });
    expect(noBody).toMatchObject({ ok: false, error: 'Body must be a JSON object' });

    const empty = await readRequest(request(ref, null), {
      parse: (body) => ({ value: { keys: Object.keys(body) } }),
      emptyBody: true,
    });
    expect(empty).toMatchObject({ ok: true, parsed: { keys: [] } });

    const routeOnly = await readRequest(request(ref, { name: 'ignored' }));
    expect(routeOnly).toMatchObject({ ok: true, ref: { id: expect.any(String) } });
    expect(routeOnly.parsed).toBeUndefined();
  });
});

describe('truthyQuery', () => {
  it('accepts 1, true and yes in any case and nothing else', () => {
    expect(truthyQuery(request({}, null, { force: 'YES' }), 'force')).toBe(true);
    expect(truthyQuery(request({}, null, { force: '1' }), 'force')).toBe(true);
    expect(truthyQuery(request({}, null, { force: 'no' }), 'force')).toBe(false);
    expect(truthyQuery(request({}, null, {}), 'force')).toBe(false);
  });
});
