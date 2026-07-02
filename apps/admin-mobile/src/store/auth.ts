import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { AdminRole } from '../types';

const API_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:4000';
const REFRESH_KEY = 'aivastra_refresh_token';

interface AuthState {
  token: string | null;
  role: AdminRole | null;
  email: string;
  storagePublicUrl: string;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  token: null,
  role: null,
  email: '',
  storagePublicUrl: '',
  isLoading: true,

  bootstrap: async () => {
    try {
      const stored = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!stored) return set({ isLoading: false });

      const res = await fetch(`${API_URL}/v1/auth/refresh-body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: stored }),
      });

      if (!res.ok) {
        await SecureStore.deleteItemAsync(REFRESH_KEY);
        return set({ isLoading: false });
      }

      const { accessToken, refreshToken } = await res.json();
      if (refreshToken) {
        await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
      }

      const meRes = await fetch(`${API_URL}/admin/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meRes.ok) throw new Error('admin/me failed');

      const me = await meRes.json();
      set({
        token: accessToken,
        role: me.role as AdminRole,
        email: me.email,
        storagePublicUrl: me.storagePublicUrl ?? '',
        isLoading: false,
      });
    } catch {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
      set({ isLoading: false });
    }
  },

  login: async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/v1/auth/login-mobile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body?.error?.code === 'EMAIL_NOT_VERIFIED') throw new Error('EMAIL_NOT_VERIFIED');
      throw new Error('INVALID_CREDENTIALS');
    }

    const { accessToken, refreshToken } = await res.json();
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);

    const meRes = await fetch(`${API_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) throw new Error('Failed to fetch admin profile');

    const me = await meRes.json();
    set({
      token: accessToken,
      role: me.role as AdminRole,
      email: me.email,
      storagePublicUrl: me.storagePublicUrl ?? '',
    });
  },

  logout: async () => {
    try {
      const stored = await SecureStore.getItemAsync(REFRESH_KEY);
      if (stored) {
        await fetch(`${API_URL}/v1/auth/logout-mobile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: stored }),
        });
      }
    } catch {
      // best-effort
    }
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    set({ token: null, role: null, email: '', storagePublicUrl: '' });
  },
}));
