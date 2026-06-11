const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const AUTH_CHANNEL =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aivastra-auth') : null;

let broadcastToken: string | null = null;

AUTH_CHANNEL?.addEventListener('message', (e) => {
  if (e.data?.type === 'token-refreshed' && e.data?.accessToken) {
    broadcastToken = e.data.accessToken;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `access_token=${encodeURIComponent(e.data.accessToken)}; path=/; max-age=900; SameSite=Lax${secure}`;
  }
});

function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  if (broadcastToken) {
    const t = broadcastToken;
    broadcastToken = null;
    return t;
  }
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

// Single-flight: coalesce concurrent refreshes into one request. Without this,
// a page firing several requests at once all 401 together and each calls
// /refresh with the same (single-use) refresh token — the first rotates it,
// the rest hit a revoked token and force a logout. Dedup avoids that race.
let refreshInFlight: Promise<string | null> | null = null;

function setAccessTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `access_token=${encodeURIComponent(token)}; path=/; max-age=900; SameSite=Lax${secure}`;
}

function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessToken: string };
        // Always update local cookie explicitly — do not rely on BFF alone
        // or on BroadcastChannel echoing back to this tab.
        setAccessTokenCookie(data.accessToken);
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
      // Notify other tabs of the new token (best-effort UX optimization)
      AUTH_CHANNEL?.postMessage({ type: 'token-refreshed', accessToken: refreshed });
    } else {
      // Refresh failed (e.g. another tab already rotated the token).
      // Check if a token arrived via BroadcastChannel or was set by the
      // middleware while we were waiting — if so, retry rather than logging out.
      const fallback = getToken();
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
  get: <T>(path: string) => request<T>(path),
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
      xhr.send(file);
    });
  },
};
