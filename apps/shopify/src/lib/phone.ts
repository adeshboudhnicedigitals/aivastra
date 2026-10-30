// Identical rule to packages/types/src/phone.ts (the API's). Kept as a copy
// because importing runtime code from @aivastra/types would pull zod and every
// schema into this bundle. The two test files share one table; change both.
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_LENGTH = 30;
const PHONE_CHARS_RE = /^[0-9+()\-.\s]+$/;

export const PHONE_ERROR = 'Enter a valid phone number (at least 7 digits)';

export function isValidPhone(value: string): boolean {
  const v = value.trim();
  return (
    v.length <= PHONE_MAX_LENGTH &&
    PHONE_CHARS_RE.test(v) &&
    v.replace(/\D/g, '').length >= PHONE_MIN_DIGITS
  );
}
