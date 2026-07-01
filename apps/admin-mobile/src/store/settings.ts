import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SETTINGS_KEY = 'aivastra-local-settings';

export interface LocalSettings {
  pageSize: number;
  autoRefresh: boolean;
  refreshInterval: number;
  soundAlerts: boolean;
  emailAlerts: boolean;
  slackWebhookUrl: string;
}

interface SettingsState extends LocalSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<LocalSettings>) => Promise<void>;
}

const defaults: LocalSettings = {
  pageSize: 25,
  autoRefresh: true,
  refreshInterval: 30,
  soundAlerts: false,
  emailAlerts: false,
  slackWebhookUrl: '',
};

export const useLocalSettings = create<SettingsState>((set, get) => ({
  ...defaults,
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({ ...defaults, ...parsed, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    set(patch);
    const current = get();
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        pageSize: current.pageSize,
        autoRefresh: current.autoRefresh,
        refreshInterval: current.refreshInterval,
        soundAlerts: current.soundAlerts,
        emailAlerts: current.emailAlerts,
        slackWebhookUrl: current.slackWebhookUrl,
      }),
    ).catch(() => undefined);
  },
}));
