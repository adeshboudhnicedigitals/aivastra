import Constants from 'expo-constants';

const BASE = (
  Constants.expoConfig?.extra?.storageUrl ??
  process.env.EXPO_PUBLIC_STORAGE_URL ??
  ''
).replace(/\/$/, '');

export function storageUrl(key: string | null | undefined): string | null {
  if (!BASE && __DEV__) {
    console.warn('[storage] EXPO_PUBLIC_STORAGE_URL is not set — all asset images will be blank');
  }
  if (!key || !BASE) return null;
  return `${BASE}/${key.replace(/^\//, '')}`;
}
