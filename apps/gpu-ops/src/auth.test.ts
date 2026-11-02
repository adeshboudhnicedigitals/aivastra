import { describe, expect, it } from 'vitest';
import { AuthError, login, logout, refresh } from './auth';

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
