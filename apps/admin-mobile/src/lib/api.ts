import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/auth';

const API_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:4000';
const REFRESH_KEY = 'aivastra_refresh_token';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  let res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (res.status === 401 && token) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${newToken}` },
      });
    } else {
      void useAuthStore.getState().logout();
      throw new ApiError(401, {});
    }
  }

  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function tryRefreshToken(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!stored) return null;

    const res = await fetch(`${API_URL}/v1/auth/refresh-body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored }),
    });

    if (!res.ok) throw new Error('refresh failed');

    const { accessToken, refreshToken } = await res.json();
    if (refreshToken) {
      await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
    }
    useAuthStore.setState({ token: accessToken });
    return accessToken;
  } catch {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    return null;
  }
}
