/** Bar heights in [0, height]; the largest value maps to `height`. Never NaN/Infinity. */
export function scaleSeries(values: number[], height: number): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  if (max === 0) return clean.map(() => 0);
  return clean.map((v) => Math.round((v / max) * height * 100) / 100);
}

/** Conversion as a percent with at most one decimal; 0% when there were no sessions. */
export function formatRatio(sold: number, sessions: number): string {
  if (!sessions || sessions <= 0) return '0%';
  const pct = Math.round((sold / sessions) * 1000) / 10;
  return `${pct}%`;
}

export function formatCredits(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}
