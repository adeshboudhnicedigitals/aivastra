import type { ShopifyStoreLimits } from '../types';

/** The Select value meaning "no limit" / "never ask"; stored as null. */
export const OFF = 'off';

// Mirrors the option sets in packages/types/src/widget.ts. Values outside these
// sets are rejected by the API with a 400.
export const STORE_DAILY_CAP_OPTIONS = [50, 100, 250, 500, 1000, 2500, 5000];
export const PER_SHOPPER_CAP_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const EMAIL_AFTER_N_OPTIONS = [0, 1, 2, 3, 5];

// The value the dropdown SHOWS when a merchant switches a limit on. It is not
// an enforced default: an absent setting means Off, so nothing changes for a
// store whose merchant never opens the page.
export const PRESELECTED = { storeDailyCap: 250, perShopperCap: 5, emailAfterNTryOns: 2 };

export function numericOptions(values: number[], offLabel: string, format: (n: number) => string) {
  return [
    { label: offLabel, value: OFF },
    ...values.map((n) => ({ label: format(n), value: String(n) })),
  ];
}

/**
 * Parse a Select option value into the numeric limit to persist.
 *
 * `Number.isFinite` rather than a `||` fallback: `0` is a legitimate option
 * ("Before the first try-on") and is falsy, so `Number(raw) || preselected`
 * silently replaced it with the preselected value.
 */
export function resolveNumericLimit(raw: string, preselected: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : preselected;
}

/**
 * The limits patch for one numeric Select change. `0` is a real, selectable
 * option ("Before the first try-on"), so it must survive; `preselected` is only
 * the parse-failure fallback, which should never fire since `raw` always comes
 * from one of the rendered option values.
 */
export function numericLimitPatch(
  key: 'storeDailyCap' | 'perShopperCap' | 'emailAfterNTryOns',
  raw: string,
  preselected: number,
): Partial<ShopifyStoreLimits> {
  return { [key]: raw === OFF ? null : resolveNumericLimit(raw, preselected) };
}
