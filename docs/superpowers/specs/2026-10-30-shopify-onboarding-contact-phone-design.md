# Shopify onboarding page 2: merchant phone mandatory

Sub-project 2 of 4 in the Shopify simplification.

## Goal

The merchant's phone number is required on onboarding's contact step, enforced
by both the page and the API.

## Current state

- `OnboardingContactPage.tsx`: name and email required; `PHONE_RE`
  (`/^[0-9+()\-.\s]*$/`) accepts an empty string.
- `onboarding.routes.ts` `SaveContactBody`: phone optional, blank stored as null
  in `shopify_stores.shop_phone`.
- Phone is prefilled from `me.store.shopPhone` (what Shopify gave us at install).

## Design

- Shared rule, used on both sides: trimmed phone must match the existing
  character set **and** contain at least 7 digits. (Digit count, not length, so
  `+()- .` padding cannot satisfy it. No country-specific format: merchants are
  international.)
- Page: phone error "Enter a valid phone number" when empty or under 7 digits;
  Continue stays gated on `valid` as for name and email. Label unchanged.
- API: `SaveContactBody.phone` becomes required, trimmed, same regex plus the
  7-digit refinement; stored trimmed. The route's null-storing branch goes away.
- Existing stores that already completed onboarding are not sent back; the rule
  applies to the next save of the contact form (including from Settings if it
  reuses this route; check at plan time and keep both consistent).
- Update the comment block above `SaveContactBody` ("phone is optional").

## Testing

- Unit: validator cases (empty, letters, `+()-` only, 6 digits, 7 digits,
  formatted `+91 98765-43210`).
- Integration (`shopify-onboarding.test.ts`): contact save with missing/short
  phone returns 400; valid phone persists trimmed.
- SPA: Continue disabled until all three fields valid.

## Out of scope

Phone verification (OTP), per-country formatting, shopper phone (sub-project 3).
