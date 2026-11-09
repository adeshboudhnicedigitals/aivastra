/** "14:59" style countdown; "Expired" once nothing is left (never negative). */
export function formatCountdown(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 'Expired';
  // Round up so a partial second still reads as time remaining.
  const total = Math.ceil(msLeft / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
