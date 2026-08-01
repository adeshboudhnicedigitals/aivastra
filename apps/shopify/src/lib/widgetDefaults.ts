import type { ShopifyWidgetConfig } from '../types';

/**
 * Default modal copy. Must stay byte-identical to the `| default:` strings in
 * tryon-button.liquid — src/__tests__/widget-drift.test.ts fails the build if
 * they diverge. Liquid holds the authoritative fallbacks (the server stores
 * nulls); this copy exists so the form can show placeholders and the preview
 * can render something.
 *
 * No single quotes in any value: the Liquid literals are single-quoted and the
 * drift test parses them with a single-quote-delimited regex.
 */
export const WIDGET_COPY_DEFAULTS = {
  heading: 'Try It On',
  subheading: 'See how it looks on you',
  uploadTitle: 'Ready to try it on?',
  uploadLead: 'Upload your photo and see how it looks on you instantly',
  chooseLabel: 'Choose Your Photo',
  ctaLabel: 'Try It On Now',
  legalText: 'By using this service, you agree to our Terms and Privacy Policy.',
  generatingText: 'Generating your try-on...',
  errorText: 'Something went wrong. Please try again.',
} as const;

export const WIDGET_BEHAVIOR_DEFAULTS = {
  addToCartLabel: 'Add to Cart',
  shareLabel: 'Share',
} as const;

export type WidgetCopyField = keyof typeof WIDGET_COPY_DEFAULTS;

/** Field order and labels for the Copy card, and the max length each accepts. */
export const WIDGET_COPY_FIELDS: { key: WidgetCopyField; label: string; max: number }[] = [
  { key: 'heading', label: 'Modal heading', max: 60 },
  { key: 'subheading', label: 'Modal subheading', max: 80 },
  { key: 'uploadTitle', label: 'Upload title', max: 80 },
  { key: 'uploadLead', label: 'Upload instructions', max: 160 },
  { key: 'chooseLabel', label: 'Choose-photo button', max: 40 },
  { key: 'ctaLabel', label: 'Generate button', max: 40 },
  { key: 'legalText', label: 'Legal line', max: 300 },
  { key: 'generatingText', label: 'Generating message', max: 80 },
  { key: 'errorText', label: 'Error message', max: 160 },
];

function normalizeTextValue(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function textFieldPatch<T extends object>(
  current: T | undefined,
  saved: T | undefined,
  keys: readonly (keyof T)[],
): Partial<T> | undefined {
  const patch: Partial<T> = {};

  for (const key of keys) {
    const currentValue = normalizeTextValue(current?.[key] as string | null | undefined);
    const savedValue = normalizeTextValue(saved?.[key] as string | null | undefined);
    if (currentValue !== savedValue) patch[key] = currentValue as T[keyof T];
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Build the leaf-level PATCH represented by the form.
 *
 * Sending only changed fields prevents one browser tab's stale snapshot from
 * replacing unrelated fields saved by another tab. Missing booleans mean the
 * storefront default (`true`), while blank text means an explicit null that
 * clears a stored override.
 */
export function createWidgetConfigPatch(
  current: ShopifyWidgetConfig,
  saved: ShopifyWidgetConfig,
): ShopifyWidgetConfig {
  const patch: ShopifyWidgetConfig = {};
  const theme = textFieldPatch(current.theme, saved.theme, ['accentColor']);
  const copy = textFieldPatch(
    current.copy,
    saved.copy,
    WIDGET_COPY_FIELDS.map(({ key }) => key),
  );
  const behavior =
    textFieldPatch(current.behavior, saved.behavior, ['addToCartLabel', 'shareLabel']) ?? {};

  const currentAddToCart = current.behavior?.addToCart ?? true;
  if (currentAddToCart !== (saved.behavior?.addToCart ?? true)) {
    behavior.addToCart = currentAddToCart;
  }
  const currentShare = current.behavior?.share ?? true;
  if (currentShare !== (saved.behavior?.share ?? true)) {
    behavior.share = currentShare;
  }

  if (theme) patch.theme = theme;
  if (copy) patch.copy = copy;
  if (Object.keys(behavior).length > 0) patch.behavior = behavior;
  return patch;
}

function applyWidgetConfigPatch(
  config: ShopifyWidgetConfig,
  patch: ShopifyWidgetConfig,
): ShopifyWidgetConfig {
  return {
    ...config,
    ...(patch.theme ? { theme: { ...config.theme, ...patch.theme } } : {}),
    ...(patch.copy ? { copy: { ...config.copy, ...patch.copy } } : {}),
    ...(patch.behavior ? { behavior: { ...config.behavior, ...patch.behavior } } : {}),
  };
}

/** Keep edits made after Save was clicked while accepting the server snapshot. */
export function rebaseWidgetConfigAfterSave(
  current: ShopifyWidgetConfig,
  submitted: ShopifyWidgetConfig,
  response: ShopifyWidgetConfig,
): ShopifyWidgetConfig {
  return applyWidgetConfigPatch(response, createWidgetConfigPatch(current, submitted));
}

function canonicalizeValue(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return value;

  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, child]) => {
      const canonical = canonicalizeValue(child);
      return canonical === undefined ? [] : [[key, canonical] as const];
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Compare the form meaning, not transient empty objects or field whitespace. */
export function widgetConfigsEqual(left: ShopifyWidgetConfig, right: ShopifyWidgetConfig): boolean {
  return (
    JSON.stringify(canonicalizeValue(left) ?? {}) === JSON.stringify(canonicalizeValue(right) ?? {})
  );
}
