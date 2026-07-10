export type ProductStatus = 'active' | 'processing' | 'failed' | 'disabled';

// Reuses Polaris's own semantic color tokens (success/warning/critical/secondary)
// rather than the mock's literal colors, so the restyle stays inside the
// existing design system instead of introducing a second, parallel palette.
export const STATUS_DOT_COLOR: Record<ProductStatus, string> = {
  active: 'var(--p-color-icon-success)',
  processing: 'var(--p-color-icon-warning)',
  failed: 'var(--p-color-icon-critical)',
  disabled: 'var(--p-color-icon-secondary)',
};

export const STATUS_BADGE_BG: Record<ProductStatus, string> = {
  active: 'var(--p-color-bg-fill-success-secondary)',
  processing: 'var(--p-color-bg-surface-warning)',
  failed: 'var(--p-color-bg-fill-critical-secondary)',
  disabled: 'var(--p-color-bg-surface-secondary)',
};

export const STATUS_BADGE_TEXT: Record<ProductStatus, string> = {
  active: 'var(--p-color-text-success)',
  processing: 'var(--p-color-text-warning)',
  failed: 'var(--p-color-text-critical)',
  disabled: 'var(--p-color-text-secondary)',
};
