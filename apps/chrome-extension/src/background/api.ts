// Points at local dev by default — change this one line for a production
// build (see apps/chrome-extension/README.md "Pointing at production").
export const API_BASE = 'http://localhost:4000';

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get('deviceId');
  if (typeof stored.deviceId === 'string') return stored.deviceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: id });
  return id;
}

/**
 * Reuses the existing /v1/auth/device-* flow built for the Android app — the
 * only auth flow that returns tokens purely in the JSON body with no cookie
 * dependency. `platform: 'mobile'` is deliberate: it carries no device cap
 * (see apps/api/src/modules/auth/routes.ts's device-login handler), which fits
 * a shopper who may have the extension installed in more than one browser
 * profile. The access token this mints (aud: 'device') is accepted by
 * requireUser exactly like a web-app session token — see apps/api/src/plugins/auth.ts,
 * which only special-cases aud: 'catalog-app'.
 */
export async function login(email: string, password: string): Promise<void> {
  const deviceId = await getDeviceId();
  const res = await fetch(`${API_BASE}/v1/auth/device-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      deviceId,
      deviceName: 'Ai Vastra Chrome extension',
      platform: 'mobile',
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? 'LOGIN_FAILED', body?.error?.message ?? 'Login failed');
  }
  await chrome.storage.local.set({
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  });
}

export async function logout(): Promise<void> {
  const { refreshToken } = await chrome.storage.local.get('refreshToken');
  await chrome.storage.local.remove(['accessToken', 'refreshToken']);
  if (typeof refreshToken === 'string') {
    await fetch(`${API_BASE}/v1/auth/device-logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {
      // Best-effort — tokens are already cleared locally either way.
    });
  }
}

export async function isLoggedIn(): Promise<boolean> {
  const { accessToken } = await chrome.storage.local.get('accessToken');
  return typeof accessToken === 'string' && accessToken.length > 0;
}

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = await chrome.storage.local.get('refreshToken');
  if (typeof refreshToken !== 'string') return null;
  const res = await fetch(`${API_BASE}/v1/auth/device-refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken, platform: 'mobile' }),
  });
  if (!res.ok) {
    await chrome.storage.local.remove(['accessToken', 'refreshToken']);
    return null;
  }
  const body = await res.json();
  await chrome.storage.local.set({
    accessToken: body.accessToken,
    ...(typeof body.refreshToken === 'string' ? { refreshToken: body.refreshToken } : {}),
  });
  return body.accessToken as string;
}

/**
 * Every call to api.aivastra.com (or localhost in dev) happens from this
 * background service worker, never from the content script — see
 * apps/chrome-extension/PLAN.md's CORS section for why: only an extension's
 * background/popup context gets Chrome's host_permissions-based CORS bypass,
 * a content script's fetch() does not.
 */
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { accessToken } = await chrome.storage.local.get('accessToken');
  if (typeof accessToken !== 'string') {
    throw new ApiError('NOT_LOGGED_IN', 'Please sign in first');
  }
  const doFetch = (token: string) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });

  let res = await doFetch(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw new ApiError('NOT_LOGGED_IN', 'Session expired, please sign in again');
    res = await doFetch(refreshed);
  }
  return res;
}

async function parseJsonOrThrow<T>(res: Response, fallbackCode: string, fallbackMessage: string) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.code ?? fallbackCode, body?.error?.message ?? fallbackMessage);
  }
  return body as T;
}

export async function getCredits(): Promise<{ balance: number }> {
  const res = await authedFetch('/v1/credits');
  return parseJsonOrThrow(res, 'CREDITS_FAILED', 'Could not load credits');
}

export async function getCategories(): Promise<{ categories: { slug: string; name: string }[] }> {
  const res = await authedFetch('/v1/extension/categories');
  return parseJsonOrThrow(res, 'CATEGORIES_FAILED', 'Could not load categories');
}

export async function submitTryon(opts: {
  category: string;
  personDataUrl: string;
  garmentDataUrl: string;
}): Promise<{ jobId: string; status: string }> {
  const res = await authedFetch('/v1/extension/tryon', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      category: opts.category,
      person: opts.personDataUrl,
      garment: opts.garmentDataUrl,
    }),
  });
  return parseJsonOrThrow(res, 'TRYON_FAILED', 'Try-on failed');
}

export async function getJob(
  jobId: string,
): Promise<{ jobId: string; status: string; imageUrl?: string; error?: string }> {
  const res = await authedFetch(`/v1/extension/jobs/${jobId}`);
  return parseJsonOrThrow(res, 'JOB_FAILED', 'Could not load job status');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetches an arbitrary cross-origin product image from the background
 * context so it benefits from the extension's host_permissions CORS bypass,
 * then hands it back to the content script as a data: URL — no server-side
 * image-proxy endpoint needed. Deliberately avoids FileReader (not reliably
 * available in a service worker) in favor of arrayBuffer + manual base64.
 */
export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError('IMAGE_FETCH_FAILED', 'Could not load the product image');
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();
  return `data:${contentType};base64,${arrayBufferToBase64(buf)}`;
}
