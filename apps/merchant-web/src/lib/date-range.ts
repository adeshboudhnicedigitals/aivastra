export type RangePreset = 'today' | '7d' | '30d';

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTC midnight for a strict YYYY-MM-DD, or null when malformed or not a real calendar date. */
function parseDate(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** The local calendar date of `now` in `tz` (en-CA formats as YYYY-MM-DD). */
function localDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Inclusive local calendar dates for a preset, computed in `tz` (not the browser's zone). */
export function rangeFor(preset: RangePreset, now: Date, tz: string): { from: string; to: string } {
  const to = localDate(now, tz);
  const span = preset === 'today' ? 0 : preset === '7d' ? 6 : 29;
  const toT = parseDate(to) as number;
  return { from: iso(toT - span * DAY_MS), to };
}

/** Error text for an unusable custom range, or null when it is fine to query. */
export function isValidCustomRange(from: string, to: string): string | null {
  const f = parseDate(from);
  const t = parseDate(to);
  if (f === null || t === null) return 'Enter both dates.';
  if (f > t) return 'The start date must be on or before the end date.';
  if ((t - f) / DAY_MS + 1 > MAX_DAYS) return `Choose a range of at most ${MAX_DAYS} days.`;
  return null;
}

/** The equally long run of days ending the day before `range` starts (for period-over-period deltas). */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const f = parseDate(range.from);
  const t = parseDate(range.to);
  if (f === null || t === null) return range;
  const days = (t - f) / DAY_MS + 1;
  return { from: iso(f - days * DAY_MS), to: iso(f - DAY_MS) };
}
