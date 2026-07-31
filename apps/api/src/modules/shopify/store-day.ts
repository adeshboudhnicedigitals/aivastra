/**
 * Day/window boundaries in the store's own timezone.
 *
 * A merchant who sets "200 per day" and watches the counter reset at 05:30
 * local time will file a bug, so every boundary here is local-calendar, not
 * UTC and not rolling.
 */

type LocalDateParts = { year: number; month: number; day: number };

const DAY_MS = 86_400_000;

/** Invalid or absent zones use UTC so a bad row cannot break the limit path. */
function validTimezone(timezone: string | null): string {
  const candidate = timezone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return 'UTC';
  }
}

/** Local wall-clock date parts for an instant in a validated zone. */
function localParts(timezone: string, at: Date): LocalDateParts {
  const values: Partial<LocalDateParts> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      values[part.type] = Number(part.value);
    }
  }
  return values as LocalDateParts;
}

/** The store-local calendar day as YYYYMMDD, for use in a Redis counter key. */
export function storeDayKey(timezone: string | null, now: Date = new Date()): string {
  const { year, month, day } = localParts(validTimezone(timezone), now);
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/** The UTC offset in milliseconds at an instant in a validated zone. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  const localAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );
  return localAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Convert a local midnight to UTC, resolving the offset at that boundary. */
function localMidnightUtc(timezone: string, year: number, month: number, day: number): Date {
  const wallTime = Date.UTC(year, month - 1, day);
  let instant = wallTime;

  // Re-evaluate the zone offset at each candidate because the boundary may use
  // a different DST offset from the current instant.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = wallTime - zoneOffsetMs(timezone, new Date(instant));
    if (next === instant) return new Date(instant);
    instant = next;
  }

  // A few zones have advanced their clocks at midnight, so 00:00 never
  // existed. In that case the first UTC instant belonging to the date is the
  // calendar boundary.
  const target = Date.UTC(year, month - 1, day);
  let low = target - 2 * DAY_MS;
  let high = target + 2 * DAY_MS;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const local = localParts(timezone, new Date(middle));
    const localDate = Date.UTC(local.year, local.month - 1, local.day);
    if (localDate < target) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

/**
 * The UTC instant at which the current local calendar window began.
 * Weeks start Monday (ISO).
 */
export function windowStart(
  timezone: string | null,
  window: 'day' | 'week' | 'month',
  now: Date = new Date(),
): Date {
  const zone = validTimezone(timezone);
  const { year, month, day } = localParts(zone, now);
  let boundary = Date.UTC(year, month - 1, day);

  if (window === 'month') boundary = Date.UTC(year, month - 1, 1);
  if (window === 'week') {
    const daysSinceMonday = (new Date(boundary).getUTCDay() + 6) % 7;
    boundary -= daysSinceMonday * DAY_MS;
  }

  const boundaryDate = new Date(boundary);
  return localMidnightUtc(
    zone,
    boundaryDate.getUTCFullYear(),
    boundaryDate.getUTCMonth() + 1,
    boundaryDate.getUTCDate(),
  );
}
