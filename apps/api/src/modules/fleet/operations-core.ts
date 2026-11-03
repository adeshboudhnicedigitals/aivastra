// Pure rules for maintenance windows and reservation notes; the routes do the queries.

/** A new window must start in the future and end after it starts. */
export function windowError(startsAt: number, endsAt: number, now: number): string | null {
  if (![startsAt, endsAt, now].every(Number.isFinite)) return 'Choose valid start and end times.';
  if (startsAt <= now) return 'Maintenance must start in the future.';
  if (endsAt <= startsAt) return 'End time must be after the start time.';
  // A forgotten year-long window would silently mute a worker's alerts for a year.
  if (endsAt - startsAt > MAX_WINDOW_MS) return 'A maintenance window can last at most 14 days.';
  return null;
}
export const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function reservationError(until: number | null, now: number): string | null {
  if (until === null) return null;
  if (!Number.isFinite(until) || until <= now) return 'Reservation end must be in the future.';
  return null;
}

export type WindowRow = { startsAt: Date; endsAt: Date; state: string };
export type WindowStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export function windowStatus(w: WindowRow, now: number): WindowStatus {
  if (w.state === 'CANCELLED') return 'CANCELLED';
  if (now < w.startsAt.getTime()) return 'SCHEDULED';
  if (now < w.endsAt.getTime()) return 'ACTIVE';
  return 'ENDED';
}

/** Workers whose alerts are silenced right now: an uncancelled window that has begun and not ended. */
export function silencedWorkers(rows: (WindowRow & { workerId: string })[], now: number) {
  return new Set(rows.filter((w) => windowStatus(w, now) === 'ACTIVE').map((w) => w.workerId));
}

/** A reservation whose end time has passed is shown as expired, not silently dropped. */
export function reservationExpired(until: Date | null, now: number): boolean {
  return until !== null && until.getTime() <= now;
}
