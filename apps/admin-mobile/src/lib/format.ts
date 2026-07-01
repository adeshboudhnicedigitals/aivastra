const relativeUnits = [
  { label: 'year', seconds: 31_536_000 },
  { label: 'month', seconds: 2_592_000 },
  { label: 'week', seconds: 604_800 },
  { label: 'day', seconds: 86_400 },
  { label: 'hour', seconds: 3_600 },
  { label: 'minute', seconds: 60 },
] as const;

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function timeAgo(value: string | number | Date, now = new Date()): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const seconds = Math.round((date.getTime() - now.getTime()) / 1_000);
  for (const { label, seconds: unitSeconds } of relativeUnits) {
    if (Math.abs(seconds) >= unitSeconds) {
      const amount = Math.round(Math.abs(seconds) / unitSeconds);
      return seconds < 0
        ? `${amount} ${label}${amount === 1 ? '' : 's'} ago`
        : `in ${amount} ${label}${amount === 1 ? '' : 's'}`;
    }
  }

  if (Math.abs(seconds) < 5) return 'now';
  const amount = Math.abs(seconds);
  return seconds < 0 ? `${amount} seconds ago` : `in ${amount} seconds`;
}

export function formatDate(value: string | number | Date): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}, ${displayHours}:${minutes} ${period}`;
}

export function formatNumber(value: number): string {
  const [integer, decimal] = String(value).split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  if (digits.length <= 3) return `${sign}${digits}${decimal ? `.${decimal}` : ''}`;

  const lastThree = digits.slice(-3);
  const leading = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${leading},${lastThree}${decimal ? `.${decimal}` : ''}`;
}

export function humanizeStatus(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function userInitials(user: Pick<User, 'displayName' | 'email'>): string {
  const source = user.displayName?.trim() || user.email.split('@')[0] || '?';
  return (
    source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

import type { User } from '../types';
