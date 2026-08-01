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
