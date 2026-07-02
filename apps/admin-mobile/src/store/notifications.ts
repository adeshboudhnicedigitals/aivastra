import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { NotificationConfig } from '../lib/notifications';
import { defaultNotificationConfig } from '../lib/notifications';

const NOTIFICATIONS_KEY = 'aivastra-notifications-config';

interface NotificationState extends NotificationConfig {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<NotificationConfig>) => Promise<void>;
}

export const useNotificationConfig = create<NotificationState>((set, get) => ({
  ...defaultNotificationConfig,
  loaded: false,
  load: async () => {
    try {
      // ponytail: try localStorage first, will switch to API later without changing UI
      const raw = await AsyncStorage.getItem(NOTIFICATIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        set({ ...defaultNotificationConfig, ...parsed, loaded: true });
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
      NOTIFICATIONS_KEY,
      JSON.stringify({
        soundEnabled: current.soundEnabled,
        soundEvents: current.soundEvents,
        slackEnabled: current.slackEnabled,
        slackUrl: current.slackUrl,
        slackEvents: current.slackEvents,
      }),
    ).catch(() => undefined);
  },
}));
