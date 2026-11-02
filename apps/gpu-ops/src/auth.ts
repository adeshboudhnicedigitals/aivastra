// Admin sign-in against the API's /admin/auth/* routes, the same ones admin-web uses.
// The access token is returned to the caller and kept in memory only; persistence across
// reloads and tabs is the httpOnly `refresh` cookie, which JavaScript here never sees.
// Every call sends credentials, so the API's CORS_ORIGIN must list this app's origin and
// both must be the same site (localhost and 127.0.0.1 are different sites).

export type AuthFailure = 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAVAILABLE';
export class AuthError extends Error {
  constructor(
    readonly kind: AuthFailure,
    message: string,
  ) {
    super(message);
  }
}

const endpoint = (baseUrl: string, path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

async function post(
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetchImpl(endpoint(baseUrl, path), {
      method: 'POST',
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // A browser reports "not running", "blocked by CORS" and "wrong host" identically.
    const origin = globalThis.location?.origin ?? 'this origin';
    throw new AuthError(
      'UNAVAILABLE',
      `Fleet API unreachable at ${baseUrl}. Either it is not running, or its CORS_ORIGIN does not include ${origin}.`,
    );
  }
}

async function readToken(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  const token =
    typeof body === 'object' && body !== null && 'accessToken' in body
      ? (body as { accessToken: unknown }).accessToken
      : null;
  if (typeof token !== 'string' || !token)
    throw new AuthError('UNAVAILABLE', 'Unexpected sign-in response from the API');
  return token;
}

export async function login(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await post(baseUrl, '/admin/auth/login', fetchImpl, { email, password });
  if (res.status === 429)
    throw new AuthError('RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and retry.');
  // The API answers 400 for a blank field and 401 for every credential failure, without saying
  // which part was wrong. Neither is reworded here.
  if (res.status === 400 || res.status === 401)
    throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.');
  if (!res.ok) throw new AuthError('UNAVAILABLE', `Sign-in failed (HTTP ${res.status}).`);
  return readToken(res);
}

/** A fresh access token from the refresh cookie, or null when there is no valid session. */
export async function refresh(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const res = await post(baseUrl, '/admin/auth/refresh', fetchImpl);
  if (res.status === 401) return null;
  if (!res.ok) throw new AuthError('UNAVAILABLE', `Session check failed (HTTP ${res.status}).`);
  return readToken(res);
}

/** Best effort: the caller drops its token whether or not the API could be reached. */
export async function logout(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await post(baseUrl, '/admin/auth/logout', fetchImpl);
  } catch {
    // Nothing to report: the in-memory token is already gone.
  }
}
