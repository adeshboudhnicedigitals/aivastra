/** Over-limit (used > limit) is possible after an admin lowers the limit, so >= not ===. */
export function staffLimitState(used: number, limit: number): { label: string; atLimit: boolean } {
  return { label: `${used} of ${limit}`, atLimit: used >= limit };
}
