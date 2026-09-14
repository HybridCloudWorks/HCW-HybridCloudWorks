/**
 * Credential status for a tab. What must hold: nothing calls `cms/secrets`
 * before sign-in is ready — neither the first load nor a Refresh pressed early.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import useSecretStatus, { SECRETS_ROUTE } from './useSecretStatus';

const getJSON = vi.fn();
let authReady = false;

vi.mock('@/lib/api', () => ({ getJSON: (...args) => getJSON(...args) }));
vi.mock('@/hooks/useAuthReady', () => ({ useAuthReady: () => ({ authReady }) }));

beforeEach(() => {
  authReady = false;
  getJSON.mockReset().mockResolvedValue({ success: true, secrets: [] });
});

describe('useSecretStatus', () => {
  it('ignores a Refresh pressed before auth is ready, then loads once it is', async () => {
    const { result, rerender } = renderHook(() => useSecretStatus());

    await act(async () => {
      await result.current.reload();
    });
    expect(getJSON).not.toHaveBeenCalled();

    authReady = true;
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getJSON).toHaveBeenCalledTimes(1);
    expect(getJSON).toHaveBeenCalledWith(SECRETS_ROUTE);

    await act(async () => {
      await result.current.reload();
    });
    expect(getJSON).toHaveBeenCalledTimes(2);
  });
});
