import { describe, expect, it, vi } from 'vitest';

import {
  ARM_SCOPE,
  RESOURCE_GRAPH_URL,
  createResourceGraphClient,
  subscriptionFromResourceId,
} from './resource-graph.js';

const SUB = '11111111-2222-3333-4444-555555555555';
const RESOURCE_ID = `/subscriptions/${SUB.toUpperCase()}/resourceGroups/rg-web-site-prod-cus/providers/Microsoft.Web/sites/func-site-prod-cus-01`;
const ENV = { FUNCTION_APP_RESOURCE_ID: RESOURCE_ID };

const credential = (token = 'arm-token') => ({ getToken: vi.fn(async () => ({ token })) });
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

describe('subscriptionFromResourceId', () => {
  it('reads the subscription segment and lowercases it', () => {
    expect(subscriptionFromResourceId(RESOURCE_ID)).toBe(SUB);
  });

  it('is null for anything that is not an ARM id', () => {
    for (const value of [undefined, null, '', 'not-an-id', '/resourceGroups/x', `/subscriptions/short/x`]) {
      expect(subscriptionFromResourceId(value)).toBeNull();
    }
  });
});

describe('createResourceGraphClient', () => {
  it('refuses to query, and never touches the credential, when no subscription is known', async () => {
    const cred = credential();
    const fetchImpl = vi.fn();
    const arm = createResourceGraphClient({ env: {}, fetchImpl, credential: cred });

    expect(arm.subscription).toBeNull();
    await expect(arm.query('resources | take 1')).rejects.toMatchObject({ code: 'ARG_UNSCOPED' });
    expect(cred.getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts the query scoped to the application subscription with a bearer token, and returns the rows', async () => {
    const cred = credential('t0k');
    const fetchImpl = vi.fn(async () => okJson({ totalRecords: 1, count: 1, data: [{ status: 'Connected' }] }));
    const arm = createResourceGraphClient({ env: ENV, fetchImpl, credential: cred });

    const rows = await arm.query("resources | where type =~ 'x'");

    expect(rows).toEqual([{ status: 'Connected' }]);
    expect(cred.getToken).toHaveBeenCalledWith(ARM_SCOPE);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(RESOURCE_GRAPH_URL);
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer t0k');
    expect(JSON.parse(options.body)).toEqual({ subscriptions: [SUB], query: "resources | where type =~ 'x'" });
  });

  it('throws with the status when ARM answers anything but 200', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const arm = createResourceGraphClient({ env: ENV, fetchImpl, credential: credential() });
    await expect(arm.query('resources')).rejects.toMatchObject({ status: 403 });
  });

  it('throws when no token could be minted', async () => {
    const fetchImpl = vi.fn();
    const arm = createResourceGraphClient({
      env: ENV,
      fetchImpl,
      credential: { getToken: vi.fn(async () => null) },
    });
    await expect(arm.query('resources')).rejects.toThrow(/token/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns no rows, rather than something else, when data is not a list', async () => {
    const fetchImpl = vi.fn(async () => okJson({ data: { unexpected: true } }));
    const arm = createResourceGraphClient({ env: ENV, fetchImpl, credential: credential() });
    expect(await arm.query('resources')).toEqual([]);
  });
});
