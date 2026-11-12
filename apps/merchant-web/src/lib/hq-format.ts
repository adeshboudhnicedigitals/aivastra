// Pure helpers for the team console (account console phase 1).

/** "5 min ago", "3 days ago"; "never" for no timestamp. `now` is a parameter so it is testable. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'Never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'Just now';
  const units: Array<[number, string]> = [
    [60, 'min'],
    [3600, 'hour'],
    [86400, 'day'],
    [86400 * 30, 'month'],
  ];
  let label = `${Math.floor(s / (86400 * 30))} month`;
  let n = Math.floor(s / (86400 * 30));
  for (let i = 0; i < units.length; i++) {
    const [size, name] = units[i] as [number, string];
    const next = units[i + 1]?.[0] ?? Number.POSITIVE_INFINITY;
    if (s >= size && s < next) {
      n = Math.floor(s / size);
      label = `${n} ${name}`;
      break;
    }
  }
  return `${label}${n === 1 ? '' : 's'} ago`;
}

export type AccountHealth = 'ok' | 'watch' | 'risk';

/**
 * A quick read for the list. Risk: credits gone while devices run, or every tablet offline.
 * Watch: balance under 7 days of recent burn, or some tablets offline. Advisory, not a rule.
 */
export function accountHealth(a: {
  isActive: boolean;
  creditBalance: number;
  burn30d: number;
  devices: number;
  devicesOffline: number;
}): AccountHealth {
  if (!a.isActive) return 'ok';
  if (a.devices > 0 && a.creditBalance <= 0) return 'risk';
  if (a.devices > 0 && a.devicesOffline === a.devices) return 'risk';
  const dailyBurn = a.burn30d / 30;
  if (dailyBurn > 0 && a.creditBalance < dailyBurn * 7) return 'watch';
  if (a.devicesOffline > 0) return 'watch';
  return 'ok';
}

export const INVITE_LABEL: Record<string, string> = {
  pending: 'Invite sent, not accepted yet',
  accepted: 'Password set',
  expired: 'Invite expired',
};
