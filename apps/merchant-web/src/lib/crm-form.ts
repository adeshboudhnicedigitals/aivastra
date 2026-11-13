import { PHOTO_RETENTION_DAYS, PROFILE_RETENTION_DAYS } from '@aivastra/types';

// Client-side checks for the WhatsApp connection and customer-data forms. The API validates
// the same bounds (packages/types/src/crm.ts); these only give the message before a round trip.

export type ChannelDraft = {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
};

export function validateChannel(d: ChannelDraft): Partial<Record<keyof ChannelDraft, string>> {
  const errors: Partial<Record<keyof ChannelDraft, string>> = {};
  if (!/^\d{5,32}$/.test(d.wabaId.trim())) errors.wabaId = 'Digits only, from WhatsApp Manager.';
  if (!/^\d{5,32}$/.test(d.phoneNumberId.trim()))
    errors.phoneNumberId = 'Digits only: the phone number ID, not the phone number.';
  if (d.accessToken.trim().length < 20) errors.accessToken = 'Paste the permanent access token.';
  if (d.appSecret.trim().length < 16) errors.appSecret = 'Paste the Meta app secret.';
  return errors;
}

/** Whole days within bounds, or an error message. Empty input is "not chosen". */
export function parseRetention(raw: string, kind: 'photo' | 'profile'): number | string {
  const b = kind === 'photo' ? PHOTO_RETENTION_DAYS : PROFILE_RETENTION_DAYS;
  const t = raw.trim();
  if (!t) return 'Choose how many days to keep this.';
  if (!/^\d+$/.test(t)) return 'Whole days only.';
  const n = Number(t);
  if (n < b.min || n > b.max) return `Between ${b.min} and ${b.max} days.`;
  return n;
}

const BLOCKER_TEXT: Record<string, string> = {
  feature_off: 'WhatsApp identification is not switched on for your account yet. Contact AiVastra.',
  no_channel: 'Connect your WhatsApp Business number.',
  no_retention: 'Choose how long customer photos and profiles are kept.',
};

export function blockerText(blocker: string): string {
  return BLOCKER_TEXT[blocker] ?? blocker;
}
