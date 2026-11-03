import { describe, expect, it } from 'vitest';
import { AuthError, fetchWithRefresh, login, logout, refresh } from './auth';

const respond = (status: number, json?: unknown) =>
  (async () =>
    new Response(json === undefined ? null : JSON.stringify(json), { status })) as typeof fetch;
const down = (async () => {
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;

describe('login', () => {
  it('posts the credentials with cookies enabled and returns the access token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ accessToken: 'tok' }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(login('http://api.invalid/', 'a@b.c', 'pw', f)).resolves.toBe('tok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.invalid/admin/auth/login');
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: 'a@b.c', password: 'pw' });
  });

  it.each([
    [400, 'INVALID_CREDENTIALS'],
    [401, 'INVALID_CREDENTIALS'],
    [429, 'RATE_LIMITED'],
    [500, 'UNAVAILABLE'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    await expect(login('http://api.invalid', 'a@b.c', 'pw', respond(status))).rejects.toMatchObject(
      { kind },
    );
  });

  it('reports an unreachable API and a response without a token as UNAVAILABLE', async () => {
    await expect(login('http://api.invalid', 'a@b.c', 'pw', down)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      login('http://api.invalid', 'a@b.c', 'pw', respond(200, { accessToken: '' })),
    ).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
  });
});

describe('refresh', () => {
  it('returns a token when the session cookie is valid', async () => {
    await expect(refresh('http://api.invalid', respond(200, { accessToken: 't2' }))).resolves.toBe(
      't2',
    );
  });

  it('returns null, not an error, when there is no valid session', async () => {
    await expect(refresh('http://api.invalid', respond(401))).resolves.toBeNull();
  });

  it('throws for a server error or an unreachable API, so it is not mistaken for "signed out"', async () => {
    await expect(refresh('http://api.invalid', respond(500))).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
    await expect(refresh('http://api.invalid', down)).rejects.toMatchObject({
      kind: 'UNAVAILABLE',
    });
  });
});

describe('logout', () => {
  it('never throws, even when the API is unreachable', async () => {
    await expect(logout('http://api.invalid', down)).resolves.toBeUndefined();
  });
});

describe('fetchWithRefresh', () => {
  it('retries an unauthorized request once with the refreshed token', async () => {
    const tokens: string[] = [];
    const expired: string[] = [];
    const response = await fetchWithRefresh(
      async (token) => {
        tokens.push(token);
        return new Response(null, { status: token === 'old' ? 401 : 200 });
      },
      'old',
      { refreshAccessToken: async () => 'fresh', onSessionExpired: () => expired.push('expired') },
    );
    expect(response.status).toBe(200);
    expect(tokens).toEqual(['old', 'fresh']);
    expect(expired).toEqual([]);
  });

  it('ends the session when refresh returns no token', async () => {
    const expired: string[] = [];
    await expect(
      fetchWithRefresh(async () => new Response(null, { status: 401 }), 'old', {
        refreshAccessToken: async () => null,
        onSessionExpired: () => expired.push('expired'),
      }),
    ).rejects.toMatchObject({ message: 'Session expired, sign in again.' });
    expect(expired).toEqual(['expired']);
  });

  it('ends the session when the retried request is also unauthorized', async () => {
    const expired: string[] = [];
    let attempts = 0;
    await expect(
      fetchWithRefresh(
        async () => {
          attempts += 1;
          return new Response(null, { status: 401 });
        },
        'old',
        {
          refreshAccessToken: async () => 'fresh',
          onSessionExpired: () => expired.push('expired'),
        },
      ),
    ).rejects.toMatchObject({ message: 'Session expired, sign in again.' });
    expect(attempts).toBe(2);
    expect(expired).toEqual(['expired']);
  });
});
