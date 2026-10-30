# Shopify Onboarding Contact Phone Implementation Plan (sub-project 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The merchant's phone number is required on onboarding's contact step, enforced by both the page and the API with one shared rule (at least 7 digits).

**Architecture:** A dependency-free validator lives in `packages/types` and is used by the API route. The merchant SPA keeps a tiny identical copy in `apps/shopify/src/lib/phone.ts` (importing runtime code from `@aivastra/types` would pull zod and every schema into the SPA bundle; the SPA only uses type imports from it today). Both copies are pinned by the same test table.

**Tech Stack:** Zod, Fastify (`apps/api`), React + Polaris (`apps/shopify`), Vitest.

Spec: `docs/superpowers/specs/2026-10-30-shopify-onboarding-contact-phone-design.md`.

## Global Constraints

- Minimum **7 digits** (counting digits only, not `+ ( ) - .` or spaces). Allowed characters: digits, space, `+ ( ) - .`. Max length 30 after trim. Value is stored trimmed.
- The contact route `POST /v1/shopify/onboarding/contact` is used only by the onboarding page (verified: no Settings caller). Stores that already finished onboarding are not sent back through it.
- pnpm only; no `console.log`; match surrounding comment density, comment the *why*.
- API tests: `pnpm --filter @aivastra/api test` is unit only. Integration, from `apps/api`: `npx vitest run --config vitest.integration.config.ts <pattern>`; needs `pnpm docker:up`.
- Package names: `@aivastra/api`, `@aivastra/types`, `@aivastra/shopify-admin` (apps/shopify).
- Do not edit `docs/progress.md` or `CLAUDE.md` (plan 1 owns those edits; put your notes in your final report for the manager).
- Never `git add -A` / `git add .`, `git stash`, `git checkout`, `git reset`, `git commit -a`.

## Parallel execution protocol (four plans share branch `feat/shopify-simplification`)

- Stage **explicit paths only** and commit only files your task lists.
- **Re-read a file immediately before editing it**; use `Edit` hunks, never rewrite a shared file from memory.
- Shared files and the only hunks this plan may touch:
  - `apps/api/src/modules/shopify/onboarding.routes.ts`: the `SaveContactBody` block at the top and the `phone` handling inside the `/v1/shopify/onboarding/contact` handler. Plan 1 edits the `/complete` handler; plan 4 edits theme-seen and deep links.
  - `apps/shopify/src/pages/OnboardingContactPage.tsx`: everything **except** the import of `canShowPostBasketPage` (plan 1 renames it to `canShowPostProductsPage`; do not touch that identifier or its two usages).
  - `packages/types/src/index.ts`: add exactly one `export * from './phone.js';` line.
  - `apps/api/test/integration/shopify-onboarding.test.ts`: only the `describe('POST /v1/shopify/onboarding/contact'...)` block and the welcome-credits test that posts to the contact route. Plan 1 edits the `/complete` block.
- Failures in files outside this plan are not yours; report them.
- **Plan 3 depends on Task 1** (it reuses `isValidPhone` for the shopper phone). Commit Task 1 first.

---

### Task 1: Shared phone validator

**Files:**
- Create: `packages/types/src/phone.ts`
- Create: `packages/types/src/phone.test.ts`
- Modify: `packages/types/src/index.ts` (add one export line, alphabetical position after `./messaging.js`)

**Interfaces:**
- Produces (from `@aivastra/types`):
  - `PHONE_MIN_DIGITS = 7`, `PHONE_MAX_LENGTH = 30`
  - `PHONE_CHARS_RE: RegExp` (`/^[0-9+()\-.\s]+$/`)
  - `phoneDigitCount(value: string): number`
  - `isValidPhone(value: string): boolean`

- [ ] **Step 1: Write the failing test**

`packages/types/src/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidPhone, phoneDigitCount } from './phone.js';

describe('phoneDigitCount', () => {
  it('counts digits only', () => {
    expect(phoneDigitCount('+91 98765-43210')).toBe(12);
    expect(phoneDigitCount('()-.+ ')).toBe(0);
  });
});

describe('isValidPhone', () => {
  const valid = ['9876543', '+91 98765-43210', '(555) 010-0123', ' 555.0100.123 '];
  const invalid = [
    '',
    '   ',
    '123456', // 6 digits
    '+()- .', // allowed characters but no digits
    'call me',
    '98765x43210',
    `${'1'.repeat(31)}`, // over the length cap
  ];

  it.each(valid)('accepts %j', (v) => expect(isValidPhone(v)).toBe(true));
  it.each(invalid)('rejects %j', (v) => expect(isValidPhone(v)).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @aivastra/types test -- phone`
Expected: FAIL, cannot resolve `./phone.js`.

- [ ] **Step 3: Implement**

`packages/types/src/phone.ts`:

```ts
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
```

Add `export * from './phone.js';` to `packages/types/src/index.ts` after `export * from './messaging.js';`.

- [ ] **Step 4: Run to verify it passes, build, commit**

Run: `pnpm --filter @aivastra/types test -- phone` → all pass. Then `pnpm --filter @aivastra/types build` (the API resolves types from `dist`).

```bash
git add packages/types/src/phone.ts packages/types/src/phone.test.ts packages/types/src/index.ts
git commit -m "feat(types): shared phone validator (7+ digits)"
```

---

### Task 2: API requires a valid phone

**Files:**
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts` (the `SaveContactBody` block and its comment; the `shopPhone: phone ?? null` line in the contact handler)
- Test: `apps/api/test/integration/shopify-onboarding.test.ts` (contact `describe` and the welcome-credits contact post)

**Interfaces:**
- Consumes: `PHONE_CHARS_RE`, `PHONE_MAX_LENGTH`, `PHONE_MIN_DIGITS`, `phoneDigitCount` from `@aivastra/types`.
- Produces: `POST /v1/shopify/onboarding/contact` rejects a missing, blank, malformed or under-7-digit phone with 400; stores the trimmed value in `shop_phone`.

- [ ] **Step 1: Update the tests first (failing)**

In `shopify-onboarding.test.ts`, contact `describe`:

- Keep `saves name, email and phone onto the store row` (its phone `'+91 98765 43210'` is valid).
- **Replace** `stores a blank or missing phone as null, replacing an earlier one` with:

```ts
  it('requires a phone: missing, blank, short or letter-only values are rejected and nothing is overwritten', async () => {
    await post({ name: 'Asha', email: 'asha@example.com', phone: '555 0100' });

    for (const phone of [undefined, '', '   ', '123456', '+()- .', 'call me']) {
      const payload: Record<string, unknown> = { name: 'Asha', email: 'asha@example.com' };
      if (phone !== undefined) payload.phone = phone;
      expect((await post(payload)).statusCode, `phone=${JSON.stringify(phone)}`).toBe(400);
    }
    // The rejected attempts left the earlier valid number alone.
    expect((await storeRow()).shopPhone).toBe('555 0100');
  });

  it('stores the phone trimmed', async () => {
    const res = await post({ name: 'Asha', email: 'asha@example.com', phone: '  98765 43210  ' });
    expect(res.statusCode).toBe(200);
    expect((await storeRow()).shopPhone).toBe('98765 43210');
  });
```

- In `requires a name and a valid email, and rejects letters in the phone`, every payload that lacks a `phone` would now 400 for a second reason; add `phone: '555 0100'` to the first three payloads so each still isolates the name/email rule.
- In the welcome-credits describe, the test `does not grant anything when contact details are saved` posts `{ name: 'Asha', email: 'asha@example.com' }`; add `phone: '555 0100'` so it still returns 200.
- Run `grep -rn "onboarding/contact" apps/api/test apps/dispatcher/test` and add a valid phone to any other payload that omits it.

Run (from `apps/api`): `npx vitest run --config vitest.integration.config.ts shopify-onboarding`
Expected: the two new tests FAIL (blank/short phone currently accepted).

- [ ] **Step 2: Implement**

Replace the top-of-file comment and schema in `onboarding.routes.ts`:

```ts
// Onboarding's contact step. Name, email and phone are all required. The phone is
// a number to ring in an emergency, not free text, so it is digits and the usual
// separators with at least PHONE_MIN_DIGITS digits (the same rule the page
// applies, so a value the form lets through is not bounced here).
const SaveContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  phone: z
    .string()
    .trim()
    .min(1, 'phone number is required')
    .max(PHONE_MAX_LENGTH)
    .regex(PHONE_CHARS_RE, 'phone number may only contain digits and + ( ) - .')
    .refine((v) => phoneDigitCount(v) >= PHONE_MIN_DIGITS, {
      message: `phone number needs at least ${PHONE_MIN_DIGITS} digits`,
    }),
});
```

Add the import `import { PHONE_CHARS_RE, PHONE_MAX_LENGTH, PHONE_MIN_DIGITS, phoneDigitCount } from '@aivastra/types';` (check whether the file already imports from `@aivastra/types` and merge into that import). In the handler change `shopPhone: phone ?? null,` to `shopPhone: phone,`.

- [ ] **Step 3: Run to verify it passes, commit**

Run: `npx vitest run --config vitest.integration.config.ts shopify-onboarding` → all pass (other describes included; if a failure is in the `/complete` block it is plan 1's in-flight work, report it).
Run: `pnpm --filter @aivastra/api typecheck` (errors confined to other plans' files are not yours).

```bash
git add apps/api/src/modules/shopify/onboarding.routes.ts apps/api/test/integration/shopify-onboarding.test.ts
git commit -m "feat(shopify): onboarding contact requires a valid phone number"
```

(If plan 1 or 4 has uncommitted hunks in these two files, use `git add -p` and stage only the contact hunks.)

---

### Task 3: Contact page requires a valid phone

**Files:**
- Create: `apps/shopify/src/lib/phone.ts`, `apps/shopify/src/lib/phone.test.ts`
- Modify: `apps/shopify/src/pages/OnboardingContactPage.tsx`

**Interfaces:**
- Produces in `lib/phone.ts`: `isValidPhone(value: string): boolean` (same behaviour as the types package) and `PHONE_ERROR = 'Enter a valid phone number (at least 7 digits)'`.

- [ ] **Step 1: Failing test**

`apps/shopify/src/lib/phone.test.ts` (same table as `packages/types/src/phone.test.ts`, which is what keeps the copies in step):

```ts
import { describe, expect, it } from 'vitest';
import { isValidPhone } from './phone';

describe('isValidPhone (must match packages/types/src/phone.ts)', () => {
  const valid = ['9876543', '+91 98765-43210', '(555) 010-0123', ' 555.0100.123 '];
  const invalid = ['', '   ', '123456', '+()- .', 'call me', '98765x43210', '1'.repeat(31)];

  it.each(valid)('accepts %j', (v) => expect(isValidPhone(v)).toBe(true));
  it.each(invalid)('rejects %j', (v) => expect(isValidPhone(v)).toBe(false));
});
```

Run: `pnpm --filter @aivastra/shopify-admin test -- phone` → FAIL (module missing).

- [ ] **Step 2: Implement `lib/phone.ts`**

```ts
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
```

Run the test → pass.

- [ ] **Step 3: Update `OnboardingContactPage.tsx`**

Re-read the file first. Edits (do not touch the `canShowPostBasketPage` import or its use):

1. Add `import { isValidPhone, PHONE_ERROR } from '../lib/phone';` with the other lib imports.
2. Delete the `const PHONE_RE = /^[0-9+()\-.\s]*$/;` line (keep `EMAIL_RE`), and update the comment above the two constants to read "Same shape the API accepts (phone: lib/phone.ts mirrors packages/types/src/phone.ts), so a value the form lets through is not bounced by the server for a reason the merchant can't see."
3. Replace `const phoneError = ...` with `const phoneError = !isValidPhone(phone) ? PHONE_ERROR : undefined;`.
4. Add `requiredIndicator` to the Phone Number `TextField`.
5. Update the component doc comment: "Name, email and phone are required and prefilled from what Shopify gave us at install." (drop "phone is optional").
6. The `unchanged` shortcut stays: `valid` already gates Continue, so a prefilled-but-invalid Shopify phone is caught before the shortcut.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @aivastra/shopify-admin test -- phone` (pass) and `pnpm --filter @aivastra/shopify-admin typecheck && pnpm --filter @aivastra/shopify-admin lint` (errors confined to files owned by plan 1/3/4 are not yours; report them).
Manual (optional, dev stack): open `/onboarding/contact` with the phone blank → Continue disabled and the error shows after blur; `1234567` → enabled.

```bash
git add apps/shopify/src/lib/phone.ts apps/shopify/src/lib/phone.test.ts apps/shopify/src/pages/OnboardingContactPage.tsx
git commit -m "feat(shopify): contact page requires a valid phone number"
```

(If plan 1 has an uncommitted rename hunk in `OnboardingContactPage.tsx`, stage only your hunks with `git add -p`.)

---

### Task 4: Final report (no commit)

Report to the manager, for the consolidated `docs/progress.md` entry:
- Rule: 7+ digits, chars `0-9+()-. ` and space, max 30, stored trimmed; enforced in the API and the page.
- Behaviour change: stores that finish onboarding from now on must supply a phone; stores already onboarded are unaffected; the contact route has no other caller.
- Evidence: output of the three test runs (types, API integration `shopify-onboarding`, SPA `phone`), and any failures seen in files outside this plan.
- Handoff: `isValidPhone` exported from `@aivastra/types` for plan 3.

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| Shared rule, 7 digits, chars, no country format | 1 |
| API: phone required, trimmed, null branch removed, comment updated | 2 |
| Page: required, error text, Continue gated | 3 |
| Existing onboarded stores unaffected; Settings caller check | Global Constraints (verified: no caller) |
| Tests: validator table, integration 400/200/trim, SPA copy pinned | 1, 2, 3 |
