import type { CSSProperties } from 'react';
import { C, M } from '@/components/tokens';

export const fmt = new Intl.NumberFormat('en-IN');

export const card: CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
};

export const sectionTitle: CSSProperties = {
  margin: '0 0 14px',
  fontSize: 18,
  lineHeight: 1.2,
  fontWeight: 700,
  color: C.text,
};

export const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: 1.2,
  fontWeight: 700,
  color: C.text,
};

export const bigNumber: CSSProperties = {
  fontWeight: 800,
  letterSpacing: '-0.02em',
  fontVariantNumeric: 'tabular-nums',
};

// Soft tinted tile + matching glyph colour, cycled for product/garment icon
// tiles. All theme-reactive: the merchant tints already have dark variants in
// globals.css, and --c-pink-tint is defined for both themes there too.
export const TILES = [
  { bg: M.accentTint, fg: M.accent },
  { bg: M.blueTint, fg: M.statusBlue },
  { bg: M.successTint, fg: M.statusGreen },
  { bg: M.warningTint, fg: M.warning },
  { bg: 'var(--c-pink-tint)', fg: C.pink },
] as const;

// Donut slices / legend dots. Built from existing tokens only (no new CSS
// variables); the 5th is a neutral grey "tail" and rows past it share a lighter one.
export const SLICE_COLORS = [C.pink, M.statusBlue, C.amber, C.mint, C.light] as const;
export const SLICE_OTHER = C.border2;
