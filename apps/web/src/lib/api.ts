const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Access token lives only in module memory — never in a JS-readable cookie.
// XSS cannot steal it and forge long-lived sessions. On page reload the token
// is gone; the first 401 triggers tryRefresh() which re-hydrates it from the
// httpOnly refresh cookie without any user-visible interruption.
let _memToken: string | null = null;

/** Call after a successful login/register to seed the in-memory token. */
export function initToken(token: string): void {
  _memToken = token;
}

const AUTH_CHANNEL =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aivastra-auth') : null;

AUTH_CHANNEL?.addEventListener('message', (e) => {
  if (e.data?.type === 'token-refreshed' && e.data?.accessToken) {
    _memToken = e.data.accessToken;
  }
});

function getToken(): string | null {
  return _memToken;
}

// Single-flight: coalesce concurrent refreshes into one request. Without this,
// a page firing several requests at once all 401 together and each calls
// /refresh with the same (single-use) refresh token — the first rotates it,
// the rest hit a revoked token and force a logout. Dedup avoids that race.
let refreshInFlight: Promise<string | null> | null = null;

function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        _memToken = data.accessToken;
        AUTH_CHANNEL?.postMessage({ type: 'token-refreshed', accessToken: data.accessToken });
        return data.accessToken;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function extractError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return new Error(body.error?.message ?? `HTTP ${res.status}`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body != null && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed}`;
      res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
    } else {
      // Refresh failed — another tab may have already rotated the token and
      // broadcast it. Check the in-memory store one more time before giving up.
      const fallback = _memToken;
      if (fallback) {
        headers.Authorization = `Bearer ${fallback}`;
        res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
      } else {
        if (typeof window !== 'undefined') window.location.href = `${BASE}/login`;
        throw new Error('Unauthorized');
      }
    }
  }

  if (!res.ok) throw await extractError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as T;
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, options),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  uploadToR2: async (uploadUrl: string, file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  },
  uploadToR2WithProgress: (
    uploadUrl: string,
    file: File,
    onProgress: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(file);
    });
  },
};
