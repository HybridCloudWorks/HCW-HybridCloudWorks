/**
 * Platform health.
 *
 * The load-bearing assertions are about failure: this is an anonymous route on
 * the landing page, so no upstream — dead, slow, or returning nonsense — may
 * produce anything worse than `UNKNOWN` for its own provider. And the cache is
 * not an optimization here, it is the only thing bounding how hard this site
 * can be made to hit four third-party status APIs (TODO.md T-316).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createPlatformHealthHandler,
  decodeUtf16JsonBuffer,
  feedHasItems,
  getAwsStatusFromEvents,
  getProviderStatuses,
  PROVIDERS,
  STATUS,
} from './platform-health.js';

const context = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

const utf16le = (text) => {
  const buffer = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i += 1) buffer.writeUInt16LE(text.charCodeAt(i), i * 2);
  return buffer;
};

const ok = (body, { as = 'json' } = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => (as === 'text' ? body : JSON.stringify(body)),
  arrayBuffer: async () => body,
});

/** Route each upstream by URL, so one provider can fail while others do not. */
const fetchRouter = (routes) => async (url) => {
  for (const [fragment, response] of Object.entries(routes)) {
    if (String(url).includes(fragment)) {
      if (typeof response === 'function') return response();
      return response;
    }
  }
  throw new Error(`unexpected upstream: ${url}`);
};

const allHealthy = () =>
  fetchRouter({
    'status.aws.amazon.com': ok(utf16le(JSON.stringify([])), { as: 'buffer' }),
    'azure.status.microsoft': ok('<rss><channel></channel></rss>', {
      as: 'text',
    }),
    'status.cloud.google.com': ok([]),
    'githubstatus.com': ok({ status: { indicator: 'none' } }),
  });

describe('getAwsStatusFromEvents', () => {
  it('is operational with no active events', () => {
    expect(getAwsStatusFromEvents([])).toBe(STATUS.OPERATIONAL);
  });

  it('distinguishes a global outage from a regional one', () => {
    expect(getAwsStatusFromEvents([{ region_name: 'Global' }])).toBe(STATUS.DEGRADED);
    expect(getAwsStatusFromEvents([{ region_name: 'us-east-1' }])).toBe(STATUS.REGIONAL);
  });
});

describe('decodeUtf16JsonBuffer', () => {
  it('reads the little-endian form AWS actually serves', () => {
    expect(JSON.parse(decodeUtf16JsonBuffer(utf16le('[{"status":"0"}]')))).toEqual([
      { status: '0' },
    ]);
  });

  it('reads big-endian when the BOM says so', () => {
    const text = '[]';
    const buffer = Buffer.alloc(2 + text.length * 2);
    buffer.writeUInt16BE(0xfeff, 0);
    for (let i = 0; i < text.length; i += 1) buffer.writeUInt16BE(text.charCodeAt(i), 2 + i * 2);
    expect(JSON.parse(decodeUtf16JsonBuffer(buffer))).toEqual([]);
  });
});

describe('feedHasItems', () => {
  it('detects an entry without pretending to parse the feed', () => {
    expect(feedHasItems('<rss><channel><item><title>x</title></item></channel></rss>')).toBe(true);
    expect(feedHasItems('<rss><channel></channel></rss>')).toBe(false);
  });

  it('is false for anything it cannot read, rather than guessing', () => {
    expect(feedHasItems('')).toBe(false);
    expect(feedHasItems(null)).toBe(false);
    // Not an item element — a substring match would get this wrong.
    expect(feedHasItems('<itemization>')).toBe(false);
  });
});

describe('getProviderStatuses', () => {
  it('reports all four operational when every upstream is clean', async () => {
    const statuses = await getProviderStatuses(context, {
      fetchImpl: allHealthy(),
    });
    expect(statuses).toEqual({
      aws: STATUS.OPERATIONAL,
      azure: STATUS.OPERATIONAL,
      gcp: STATUS.OPERATIONAL,
      github: STATUS.OPERATIONAL,
    });
  });

  it('reads each provider’s own notion of unhealthy', async () => {
    const statuses = await getProviderStatuses(context, {
      fetchImpl: fetchRouter({
        'status.aws.amazon.com': ok(
          utf16le(JSON.stringify([{ status: '1', region_name: 'Global' }])),
          {
            as: 'buffer',
          }
        ),
        'azure.status.microsoft': ok('<rss><channel><item>x</item></channel></rss>', {
          as: 'text',
        }),
        'status.cloud.google.com': ok([{ id: 'i1' }]), // no `end` — still open
        'githubstatus.com': ok({ status: { indicator: 'major' } }),
      }),
    });
    expect(statuses).toEqual({
      aws: STATUS.DEGRADED,
      azure: STATUS.DEGRADED,
      gcp: STATUS.DEGRADED,
      github: STATUS.DEGRADED,
    });
  });

  it('ignores a resolved GCP incident', async () => {
    const statuses = await getProviderStatuses(context, {
      fetchImpl: fetchRouter({
        'status.aws.amazon.com': ok(utf16le('[]'), { as: 'buffer' }),
        'azure.status.microsoft': ok('<rss/>', { as: 'text' }),
        'status.cloud.google.com': ok([{ id: 'i1', end: '2026-01-01T00:00:00Z' }]),
        'githubstatus.com': ok({ status: { indicator: 'none' } }),
      }),
    });
    expect(statuses.gcp).toBe(STATUS.OPERATIONAL);
  });

  it('degrades one provider to UNKNOWN without touching the others', async () => {
    // The property that matters: one dead upstream must not blank the panel.
    for (const broken of [
      'status.aws.amazon.com',
      'azure.status.microsoft',
      'status.cloud.google.com',
      'githubstatus.com',
    ]) {
      const routes = {
        'status.aws.amazon.com': ok(utf16le('[]'), { as: 'buffer' }),
        'azure.status.microsoft': ok('<rss/>', { as: 'text' }),
        'status.cloud.google.com': ok([]),
        'githubstatus.com': ok({ status: { indicator: 'none' } }),
      };
      routes[broken] = () => {
        throw new Error('upstream down');
      };

      const statuses = await getProviderStatuses(context, {
        fetchImpl: fetchRouter(routes),
      });
      const provider = PROVIDERS.find((p) => statuses[p] === STATUS.UNKNOWN);
      expect(statuses[provider]).toBe(STATUS.UNKNOWN);
      expect(Object.values(statuses).filter((s) => s === STATUS.UNKNOWN)).toHaveLength(1);
    }
  });

  it('treats a non-2xx and an unexpected shape as UNKNOWN, not as healthy', async () => {
    // Failing towards OPERATIONAL would be the dangerous direction: the page
    // would claim everything is fine precisely when it cannot tell.
    const statuses = await getProviderStatuses(context, {
      fetchImpl: fetchRouter({
        'status.aws.amazon.com': { ok: false, status: 503 },
        'azure.status.microsoft': { ok: false, status: 500 },
        'status.cloud.google.com': ok({ notAnArray: true }),
        'githubstatus.com': ok({ unexpected: 'shape' }),
      }),
    });
    expect(statuses).toEqual({
      aws: STATUS.UNKNOWN,
      azure: STATUS.UNKNOWN,
      gcp: STATUS.UNKNOWN,
      github: STATUS.UNKNOWN,
    });
  });

  it('sends a timeout signal, so a hanging upstream cannot hold the request', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await getProviderStatuses(context, { fetchImpl });
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

describe('createPlatformHealthHandler', () => {
  it('serves the shape HomePage reads', async () => {
    const handler = createPlatformHealthHandler({ fetchImpl: allHealthy() });
    const res = await handler({}, context);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cached).toBe(false);
    expect(Object.keys(body.statuses).sort()).toEqual([...PROVIDERS].sort());
    expect(body.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sets cache headers so something in front can absorb the traffic', async () => {
    const handler = createPlatformHealthHandler({ fetchImpl: allHealthy() });
    const res = await handler({}, context);
    expect(res.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=300');
  });

  it('hits the upstreams once per TTL no matter how often it is called', async () => {
    // This is the whole protection. Without it an anonymous route fans out to
    // four third-party APIs at whatever rate a caller chooses.
    let clock = 1_000_000;
    const fetchImpl = vi.fn(allHealthy());
    const handler = createPlatformHealthHandler({
      fetchImpl,
      now: () => clock,
      ttlMs: 60_000,
    });

    for (let i = 0; i < 20; i += 1) await handler({}, context);
    expect(fetchImpl).toHaveBeenCalledTimes(PROVIDERS.length);
    expect(JSON.parse((await handler({}, context)).body).cached).toBe(true);

    clock += 60_001;
    await handler({}, context);
    expect(fetchImpl).toHaveBeenCalledTimes(PROVIDERS.length * 2);
  });

  it('never 500s, even if the whole aggregation throws', async () => {
    const handler = createPlatformHealthHandler({
      fetchImpl: () => {
        throw new Error('network stack gone');
      },
    });
    const res = await handler({}, context);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.statuses).toEqual({
      aws: STATUS.UNKNOWN,
      azure: STATUS.UNKNOWN,
      gcp: STATUS.UNKNOWN,
      github: STATUS.UNKNOWN,
    });
  });
});
