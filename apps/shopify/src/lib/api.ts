import { getIdToken } from './appBridge';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (res.status === 401) {
    // Session token may have expired between acquisition and use (~60s lifetime) — retry once with a fresh one.
    const freshToken = await getIdToken();
    const retryRes = await fetch(path, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${freshToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!retryRes.ok) {
      const body = await retryRes.text();
      throw new ApiError(retryRes.status, body || retryRes.statusText);
    }
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}
