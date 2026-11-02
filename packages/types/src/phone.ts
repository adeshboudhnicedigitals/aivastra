// One phone rule for the whole Shopify surface. Digits are counted, not
// length, so a string of "+()- ." padding can never satisfy the minimum. No
// country-specific format: merchants and shoppers are international.
//
// apps/shopify/src/lib/phone.ts and the storefront widget keep identical copies
// (neither can import this package at runtime without bundling zod); they are
// pinned by the same test table. Change all three together.
export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_LENGTH = 30;
export const PHONE_CHARS_RE = /^[0-9+()\-.\s]+$/;

export function phoneDigitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

export function isValidPhone(value: string): boolean {
  const v = value.trim();
  return (
    v.length <= PHONE_MAX_LENGTH && PHONE_CHARS_RE.test(v) && phoneDigitCount(v) >= PHONE_MIN_DIGITS
  );
}
