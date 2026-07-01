import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import { type AppColors, Colors } from '../styles/tokens';

const THEME_KEY = 'aivastra-theme';
export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  loaded: boolean;
  load: () => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggle: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  loaded: false,
  load: async () => {
    try {
      const stored = await AsyncStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') set({ mode: stored });
    } finally {
      set({ loaded: true });
    }
  },
  setMode: async (mode) => {
    set({ mode });
    await AsyncStorage.setItem(THEME_KEY, mode).catch(() => undefined);
  },
  toggle: async () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}));

export function useAppTheme(): { colors: AppColors; isDark: boolean; mode: ThemeMode } {
  const systemScheme = useColorScheme();
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'system' ? systemScheme === 'dark' : mode === 'dark';
  return { colors: isDark ? Colors.dark : Colors.light, isDark, mode };
}
