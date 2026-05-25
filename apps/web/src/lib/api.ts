const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function getToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function tryRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST' });
    if (!res.ok) return null;
    const data = await res.json() as { accessToken: string };
    return data.accessToken;
  } catch {
    return null;
  }
}

async function extractError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
  return new Error(body.error?.message ?? `HTTP ${res.status}`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${refreshed}`;
      res = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: 'include' });
    } else {
      if (typeof window !== 'undefined') window.location.href = `${BASE}/login`;
      throw new Error('Unauthorized');
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
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  },
  uploadToR2WithProgress: (uploadUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(file);
    });
  },
};
