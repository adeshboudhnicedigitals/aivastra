import type { DB } from '@aivastra/db';
import type { AnalyticsQuery } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import { AppError } from '../../../lib/errors.js';

// Every merchant is in India today; per-request `tz` overrides (no per-merchant setting yet).
export const DEFAULT_TZ = 'Asia/Kolkata';
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;

// Region/City-style IANA names only (plus bare names like UTC). Intl also accepts raw
// offsets such as "+05:30", but Postgres reads a bare offset in AT TIME ZONE with the
// POSIX sign flipped, so a value Intl and Postgres disagree on is refused outright: the
// timeseries endpoint passes this same tz to SQL for day bucketing.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export interface AnalyticsWindow {
  /** Inclusive local calendar dates, YYYY-MM-DD. */
  from: string;
  to: string;
  tz: string;
  /** [startUtc, endUtc): from 00:00 in tz up to (to + 1 day) 00:00 in tz. */
  startUtc: Date;
  endUtc: Date;
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION', 400, message);
}

function resolveTz(raw: string | undefined): string {
  const tz = raw ?? DEFAULT_TZ;
  if (!IANA_NAME.test(tz)) throw invalid('tz must be an IANA time zone name');
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    // Returned as given, not ICU's resolvedOptions() name, which maps Asia/Kolkata to the
    // legacy alias Asia/Calcutta. Postgres resolves both names and ignores case.
    return tz;
  } catch {
    throw invalid('tz must be an IANA time zone name');
  }
}

/** Day number (UTC epoch days) of a YYYY-MM-DD string, or null if it is not a real date. */
function dayNumber(date: string): number | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms / DAY_MS;
}

function dateOf(dayNum: number): string {
  return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/** Local calendar date of an instant in tz. */
export function localDate(instant: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Offset (ms) of tz from UTC at an instant: local wall clock minus UTC. */
function offsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of local midnight starting `dayNum` in tz. Two passes because the
 * offset can differ between the naive guess and the answer across a DST change; in the
 * rare zone whose clocks jump over midnight itself, this lands on the first instant of
 * that local day (the jump target), which is what a day window should start at.
 */
export function zonedMidnightUtc(dayNum: number, tz: string): Date {
  const naive = dayNum * DAY_MS;
  let guess = naive - offsetMs(new Date(naive), tz);
  const second = naive - offsetMs(new Date(guess), tz);
  if (second !== guess) {
    // If the second candidate still maps to the wanted local date, it is the right one;
    // otherwise midnight does not exist that day and the first candidate is already past it.
    if (localDate(new Date(second), tz) === dateOf(dayNum)) guess = second;
  }
  return new Date(guess);
}

/**
 * Validates and resolves the analytics window. `from`/`to` are inclusive calendar dates
 * in `tz`; the default is the last 30 days ending today in `tz`.
 */
export function parseWindow(
  q: Pick<AnalyticsQuery, 'from' | 'to' | 'tz'>,
  now: Date,
): AnalyticsWindow {
  const tz = resolveTz(q.tz);

  const todayNum = dayNumber(localDate(now, tz))!;
  const toNum = q.to !== undefined ? dayNumber(q.to) : todayNum;
  if (toNum === null) throw invalid('to is not a valid date');
  const fromNum = q.from !== undefined ? dayNumber(q.from) : toNum - (DEFAULT_RANGE_DAYS - 1);
  if (fromNum === null) throw invalid('from is not a valid date');

  if (fromNum > toNum) throw invalid('from must not be after to');
  if (toNum - fromNum + 1 > MAX_RANGE_DAYS) {
    throw invalid(`range must be at most ${MAX_RANGE_DAYS} days`);
  }

  return {
    from: dateOf(fromNum),
    to: dateOf(toNum),
    tz,
    startUtc: zonedMidnightUtc(fromNum, tz),
    endUtc: zonedMidnightUtc(toNum + 1, tz),
  };
}

// Postgres' invalid_parameter_value, which is what `AT TIME ZONE` raises for a zone name
// it does not know.
const PG_INVALID_PARAMETER_VALUE = '22023';

/** True when a DB error is Postgres refusing a time zone name. */
export function isInvalidTimeZoneError(err: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return (
    code(err) === PG_INVALID_PARAMETER_VALUE ||
    code((err as { cause?: unknown } | null)?.cause) === PG_INVALID_PARAMETER_VALUE
  );
}

/**
 * ICU (Intl) and Postgres ship different tz databases: a name can pass resolveTz yet be
 * unknown to Postgres (US/Pacific-New is one), and the day bucketing hands the name to
 * `AT TIME ZONE`. Ask Postgres with the same expression, so such a name is a 400 rather
 * than a 500 from the real query.
 */
export async function assertPgTimeZone(db: DB, tz: string): Promise<void> {
  try {
    await db.execute(sql`select now() at time zone ${tz}`);
  } catch (err) {
    if (isInvalidTimeZoneError(err)) throw invalid('tz must be an IANA time zone name');
    throw err;
  }
}

/** parseWindow plus the Postgres-side tz check every analytics route needs. */
export async function resolveWindow(
  db: DB,
  q: Pick<AnalyticsQuery, 'from' | 'to' | 'tz'>,
  now: Date,
): Promise<AnalyticsWindow> {
  const w = parseWindow(q, now);
  await assertPgTimeZone(db, w.tz);
  return w;
}
