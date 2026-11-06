import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, initToken, setForbiddenHandler } from './api';
import { ApiError } from './errors';

const forbidden = () =>
  new Response(
    JSON.stringify({ error: { code: 'FORBIDDEN', message: 'merchant admin required' } }),
    {
      status: 403,
      headers: { 'content-type': 'application/json' },
    },
  );
const ok = () =>
  new Response(JSON.stringify({ merchantId: 'm1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const handler = vi.fn();

beforeEach(() => {
  initToken('tok');
  handler.mockReset();
  setForbiddenHandler(handler);
});
afterEach(() => {
  setForbiddenHandler(null);
  vi.unstubAllGlobals();
});

describe('apiFetch 403 handling', () => {
  it('rethrows an ordinary 403 without signing out when org/me is still 200', async () => {
    const f = vi.fn().mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', f);
    await expect(apiFetch('/v1/merchant/staff')).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1]?.[0])).toContain('/v1/merchant/org/me');
    expect(handler).not.toHaveBeenCalled();
  });

  it('signs out when the org/me re-check is also 403, and does not recurse', async () => {
    const f = vi.fn().mockResolvedValueOnce(forbidden()).mockResolvedValueOnce(forbidden());
    vi.stubGlobal('fetch', f);
    await expect(apiFetch('/v1/merchant/staff')).rejects.toMatchObject({ status: 403 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
