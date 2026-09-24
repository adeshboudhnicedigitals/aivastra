# Shopify Mandatory Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Shopify Dashboard's optional "Getting started" checklist with a mandatory, full-page onboarding wizard (intro → products → routing → theme) shown before any other part of the embedded admin app is reachable.

**Architecture:** A new `/onboarding` route tree in the Shopify admin SPA (`apps/shopify`), gated by a single `me: ShopifyMe` state lifted into `App.tsx` and passed as a prop to the four onboarding pages (never independently re-fetched by them, to avoid a stale-state race between the app-level gate and in-wizard navigation). Step completion is derived by a pure function, `getOnboardingStep`, from existing signals (`syncedProductCount`, `enabledProductCount`, `activation.mode`, `themeBlockConfirmed`) plus one new settings field (`onboardingRoutingConfirmed`). One new backend route persists that field.

**Tech Stack:** React + TypeScript + React Router (`apps/shopify`), Shopify Polaris components, Fastify + Drizzle (`apps/api`), Vitest.

## Global Constraints

- No new npm dependencies anywhere.
- Polaris components only in `apps/shopify` — this app's design system is Polaris (no raw `<select>` or ad hoc UI kit).
- `apps/shopify` has no component-render test harness (no `@testing-library/react`, no jsdom tests) — established in prior work on this branch. Verification for UI-only changes is `typecheck` + `lint` + `build` + manual reasoning, not a new test harness. Pure logic (`lib/onboarding.ts`) and backend routes DO get real automated tests, matching this app's existing `lib/*.test.ts` and `apps/api/test/*.test.ts` conventions.
- Onboarding pages (`OnboardingIntroPage`, `OnboardingProductsPage`, `OnboardingRoutingPage`, `OnboardingThemePage`) receive `me: ShopifyMe` as a prop from `App.tsx` — they must NOT independently fetch `/v1/shopify/me` themselves. This is a deliberate exception to this app's usual per-page-fetches-its-own-data pattern: these four pages need to observe the exact same `me` the app-level gate uses, at the exact moment of navigating between them, or the gate and a page's own step-order check can disagree and bounce the merchant backward. `OnboardingProductsPage`, `OnboardingRoutingPage`, and `OnboardingThemePage` additionally receive `onRefresh: () => Promise<void>` — call and `await` it after any action that changes onboarding progress (sync, confirm-routing, confirm-theme-block), before navigating to the next step.
- No "skip onboarding" escape hatch — hard gate by design.
- `docs/superpowers/specs/2026-09-24-shopify-mandatory-onboarding-design.md` is the source spec; this plan implements it in full.

---

### Task 1: Backend — `onboardingRoutingConfirmed` settings field + confirm-routing route

**Files:**
- Modify: `packages/db/src/schema/shopify.ts:70-80` (the `ShopifyStoreSettings` interface)
- Modify: `apps/api/src/modules/shopify/onboarding.routes.ts:46-65` (add a new route, right after the existing `confirm-theme-block` one)
- Test: `apps/api/test/shopify-onboarding.test.ts` (append a new `describe` block)

**Interfaces:**
- Produces: `ShopifyStoreSettings.onboardingRoutingConfirmed?: boolean`; `POST /v1/shopify/onboarding/confirm-routing` → `{ settings: ShopifyStoreSettings }` (200, requires `requireShopifySession`).

- [ ] **Step 1: Add the settings field**

In `packages/db/src/schema/shopify.ts`, find:

```ts
export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  emailBonusClaimed?: boolean;
  emailBonusClaimedAt?: string;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
  widgetConfigSynced?: boolean;
  activation?: ShopifyActivationSettings;
}
```

Replace with:

```ts
export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  onboardingRoutingConfirmed?: boolean;
  emailBonusClaimed?: boolean;
  emailBonusClaimedAt?: string;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
  widgetConfigSynced?: boolean;
  activation?: ShopifyActivationSettings;
}
```

Pure JSONB field — no migration needed (same as every other flag on this interface).

- [ ] **Step 2: Write the failing test**

In `apps/api/test/shopify-onboarding.test.ts`, append (after the closing `});` of the existing `describe('POST /v1/shopify/onboarding/confirm-theme-block', ...)` block, before the final closing of the file):

```ts
describe('POST /v1/shopify/onboarding/confirm-routing', () => {
  it('sets settings.onboardingRoutingConfirmed to true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings.onboardingRoutingConfirmed).toBe(true);

    const [row] = await app.db
      .select()
      .from(schema.shopifyStores)
      .where(eq(schema.shopifyStores.id, storeId));
    expect(row.settings.onboardingRoutingConfirmed).toBe(true);
  });

  it('is idempotent — calling it twice does not error', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/shopify/onboarding/confirm-routing',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().settings.onboardingRoutingConfirmed).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Ensure infra is up first: `pnpm docker:up` (from repo root, if not already running).

Run (from `apps/api`):
```bash
cd apps/api
npx vitest run --config vitest.integration.config.ts test/shopify-onboarding.test.ts
```
Expected: FAIL — `404` / route not found for `POST /v1/shopify/onboarding/confirm-routing` (the route doesn't exist yet).

- [ ] **Step 4: Implement the route**

In `apps/api/src/modules/shopify/onboarding.routes.ts`, find the end of the existing `confirm-theme-block` route registration (ends with the closing `);` right before the `// Dashboard popup:` comment):

```ts
      return { settings: updated.settings };
    },
  );

  // Dashboard popup: the merchant confirms/edits their contact email in
```

Replace with (inserting the new route between them):

```ts
      return { settings: updated.settings };
    },
  );

  app.post(
    '/v1/shopify/onboarding/confirm-routing',
    { preHandler: app.requireShopifySession },
    async (req) => {
      const store = req.shopifyStore as typeof schema.shopifyStores.$inferSelect;
      const settings = mergeStoreSettingsObject(storeSettingsJson(), [], {
        onboardingRoutingConfirmed: true,
      });

      const [updated] = await app.db
        .update(schema.shopifyStores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(schema.shopifyStores.id, store.id))
        .returning({ settings: schema.shopifyStores.settings });
      if (!updated) throw new AppError('FORBIDDEN', 403, 'Store not installed');

      return { settings: updated.settings };
    },
  );

  // Dashboard popup: the merchant confirms/edits their contact email in
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/api
npx vitest run --config vitest.integration.config.ts test/shopify-onboarding.test.ts
```
Expected: PASS, all tests in the file (existing `confirm-theme-block`/`theme-editor-url` tests plus the two new `confirm-routing` tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/shopify.ts apps/api/src/modules/shopify/onboarding.routes.ts apps/api/test/shopify-onboarding.test.ts
git commit -m "$(cat <<'EOF'
feat(shopify): add confirm-routing onboarding endpoint

New onboardingRoutingConfirmed settings flag + POST endpoint, mirroring
the existing confirm-theme-block route, for the mandatory onboarding
wizard's routing step.
EOF
)"
```

---

### Task 2: `lib/onboarding.ts` — step-derivation helper + frontend type mirror

**Files:**
- Create: `apps/shopify/src/lib/onboarding.ts`
- Test: `apps/shopify/src/lib/onboarding.test.ts`
- Modify: `apps/shopify/src/types.ts:22-32` (mirror the new settings field)

**Interfaces:**
- Consumes: `ShopifyMe` type from `apps/shopify/src/types.ts` (already defined; this task adds one field to `ShopifyStoreSettings` within it).
- Produces: `export type OnboardingStep = 'intro' | 'products' | 'routing' | 'theme';`, `export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null`, `export function onboardingPath(step: OnboardingStep | null): string`. Every later task in this plan imports both functions and the type from `../lib/onboarding`.

- [ ] **Step 1: Mirror the new settings field on the frontend type**

In `apps/shopify/src/types.ts`, find:

```ts
export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  emailBonusClaimed?: boolean;
  emailBonusClaimedAt?: string;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
  widgetConfigSynced?: boolean;
  activation?: ShopifyActivationSettings;
}
```

Replace with:

```ts
export interface ShopifyStoreSettings {
  workflowTemplateId?: string;
  themeBlockConfirmed?: boolean;
  onboardingRoutingConfirmed?: boolean;
  emailBonusClaimed?: boolean;
  emailBonusClaimedAt?: string;
  limits?: ShopifyStoreLimits;
  retention?: ShopifyStoreRetention;
  widget?: ShopifyWidgetConfig;
  widgetConfigSynced?: boolean;
  activation?: ShopifyActivationSettings;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/shopify/src/lib/onboarding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getOnboardingStep, onboardingPath } from './onboarding';
import type { ShopifyMe } from '../types';

function baseMe(overrides: {
  syncedProductCount?: number;
  enabledProductCount?: number;
  activationMode?: 'global' | 'selective';
  onboardingRoutingConfirmed?: boolean;
  themeBlockConfirmed?: boolean;
} = {}): ShopifyMe {
  return {
    store: {
      shopDomain: 'test.myshopify.com',
      shopEmail: null,
      settings: {
        activation: overrides.activationMode ? { mode: overrides.activationMode } : undefined,
        onboardingRoutingConfirmed: overrides.onboardingRoutingConfirmed,
        themeBlockConfirmed: overrides.themeBlockConfirmed,
      },
      connectedSince: '2026-01-01T00:00:00Z',
    },
    creditBalance: 0,
    hasPurchasedPack: false,
    runway: {
      balance: 0,
      tryOnsRemaining: 0,
      dailyBurnCredits: 0,
      daysRemaining: null,
      level: 'ok',
    },
    autorefill: {
      enabled: false,
      status: null,
      packId: null,
      triggerCredits: null,
      cappedAmountUsdCents: null,
      balanceUsedUsdCents: null,
    },
    stats: {
      totalTryOns: 0,
      syncedProductCount: overrides.syncedProductCount ?? 0,
      enabledProductCount: overrides.enabledProductCount ?? 0,
      statusCounts: { active: 0, processing: 0, failed: 0, disabled: 0 },
      todayTryOns: 0,
      storeDailyCap: null,
      capturedEmailCount: 0,
    },
  };
}

describe('getOnboardingStep', () => {
  it('returns intro for a fresh install with nothing done', () => {
    expect(getOnboardingStep(baseMe())).toBe('intro');
  });

  it('returns routing once products are synced and enabled globally', () => {
    const me = baseMe({ syncedProductCount: 5, activationMode: 'global' });
    expect(getOnboardingStep(me)).toBe('routing');
  });

  it('returns routing once products are synced and at least one is individually enabled (selective mode)', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 1, activationMode: 'selective' });
    expect(getOnboardingStep(me)).toBe('routing');
  });

  it('stays on products if synced but nothing is enabled', () => {
    const me = baseMe({ syncedProductCount: 5, enabledProductCount: 0, activationMode: 'selective' });
    expect(getOnboardingStep(me)).toBe('products');
  });

  it('returns theme once products and routing are both done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      onboardingRoutingConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBe('theme');
  });

  it('returns null once all three steps are done', () => {
    const me = baseMe({
      syncedProductCount: 5,
      activationMode: 'global',
      onboardingRoutingConfirmed: true,
      themeBlockConfirmed: true,
    });
    expect(getOnboardingStep(me)).toBeNull();
  });

  it('skips the intro and jumps straight to the first incomplete step for a store with pre-existing partial progress (e.g. theme confirmed under the old checklist, before this wizard existed, but never synced)', () => {
    const me = baseMe({ themeBlockConfirmed: true });
    expect(getOnboardingStep(me)).toBe('products');
  });
});

describe('onboardingPath', () => {
  it('maps intro to /onboarding', () => {
    expect(onboardingPath('intro')).toBe('/onboarding');
  });

  it('maps products/routing/theme to their own sub-route', () => {
    expect(onboardingPath('products')).toBe('/onboarding/products');
    expect(onboardingPath('routing')).toBe('/onboarding/routing');
    expect(onboardingPath('theme')).toBe('/onboarding/theme');
  });

  it('maps null (complete) to the app root', () => {
    expect(onboardingPath(null)).toBe('/');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/shopify
npx vitest run src/lib/onboarding.test.ts
```
Expected: FAIL — `Cannot find module './onboarding'` (the module doesn't exist yet).

- [ ] **Step 4: Implement `lib/onboarding.ts`**

Create `apps/shopify/src/lib/onboarding.ts`:

```ts
import type { ShopifyMe } from '../types';

export type OnboardingStep = 'intro' | 'products' | 'routing' | 'theme';

// Mirrors DashboardPage's own isTryOnEnabled: global mode alone counts as
// "enabled" regardless of enabledProductCount's precision.
function isTryOnEnabled(me: ShopifyMe): boolean {
  const globalModeOn = me.store.settings.activation?.mode === 'global';
  return globalModeOn || me.stats.enabledProductCount > 0;
}

/**
 * The wizard's current step, or null once every step is done. Intro has no
 * settings flag of its own — it is shown only when none of the three real
 * steps are done yet (a genuinely fresh install); as soon as any one of them
 * is done, a merchant resuming the wizard jumps straight to the first
 * incomplete step among products/routing/theme, in that fixed order,
 * regardless of which one they happened to finish first (a store could have
 * themeBlockConfirmed=true from before this wizard existed, but never have
 * synced products — that still resumes at 'products', not 'intro').
 */
export function getOnboardingStep(me: ShopifyMe): OnboardingStep | null {
  const productsDone = me.stats.syncedProductCount > 0 && isTryOnEnabled(me);
  const routingDone = me.store.settings.onboardingRoutingConfirmed ?? false;
  const themeDone = me.store.settings.themeBlockConfirmed ?? false;

  if (!productsDone && !routingDone && !themeDone) return 'intro';
  if (!productsDone) return 'products';
  if (!routingDone) return 'routing';
  if (!themeDone) return 'theme';
  return null;
}

/** The route for a given step; null (onboarding complete) routes to the app root. */
export function onboardingPath(step: OnboardingStep | null): string {
  if (step === null) return '/';
  if (step === 'intro') return '/onboarding';
  return `/onboarding/${step}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/shopify
npx vitest run src/lib/onboarding.test.ts
```
Expected: PASS, 10/10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/shopify/src/lib/onboarding.ts apps/shopify/src/lib/onboarding.test.ts apps/shopify/src/types.ts
git commit -m "$(cat <<'EOF'
feat(shopify): add getOnboardingStep/onboardingPath helpers

Pure step-derivation logic for the mandatory onboarding wizard, reusing
existing sync/enable/theme-block signals plus the new
onboardingRoutingConfirmed flag.
EOF
)"
```

---

### Task 3: `OnboardingLayout` shared step chrome

**Files:**
- Create: `apps/shopify/src/components/OnboardingLayout.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function OnboardingLayout(props: { step: number; totalSteps: number; title: string; continueLabel?: string; onContinue: () => void; continueDisabled?: boolean; continueLoading?: boolean; children: ReactNode })`. Tasks 5, 6, 7 (Products/Routing/Theme pages) wrap their body in this. Task 4 (Intro) does NOT use it (see spec: intro has no persisted flag and isn't one of the 3 counted steps).

- [ ] **Step 1: Implement the component**

Create `apps/shopify/src/components/OnboardingLayout.tsx`:

```tsx
import { BlockStack, Button, Card, InlineStack, Page, Text } from '@shopify/polaris';
import type { ReactNode } from 'react';

// No Back button: a merchant navigating to an already-completed step is
// immediately redirected forward again by each onboarding page's own
// getOnboardingStep check (see lib/onboarding.ts) — a Back control here
// would be clickable but never actually land anywhere.
export function OnboardingLayout({
  step,
  totalSteps,
  title,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  children,
}: {
  step: number;
  totalSteps: number;
  title: string;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  children: ReactNode;
}) {
  return (
    <Page>
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Step {step} of {totalSteps}
        </Text>
        <Text as="h1" variant="headingLg">
          {title}
        </Text>
        <Card>
          <BlockStack gap="400">{children}</BlockStack>
        </Card>
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={onContinue}
            disabled={continueDisabled}
            loading={continueLoading}
          >
            {continueLabel}
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0. (This component isn't imported anywhere yet, so it only needs to be internally type-correct at this point — later tasks wire it in.)

- [ ] **Step 3: Commit**

```bash
git add apps/shopify/src/components/OnboardingLayout.tsx
git commit -m "feat(shopify): add OnboardingLayout shared step chrome"
```

---

### Task 4: `OnboardingIntroPage`

**Files:**
- Create: `apps/shopify/src/pages/OnboardingIntroPage.tsx`
- Depends on an asset: `apps/shopify/src/assets/sample-garment.jpg` (or whatever extension is supplied) — **check this exists before starting**; `apps/shopify/src/assets/sample-photo.jpg` and `apps/shopify/src/assets/sample-result.jpg` already exist in the repo.

**Interfaces:**
- Consumes: `getOnboardingStep`, `onboardingPath` from `../lib/onboarding` (Task 2); `ShopifyMe` type from `../types`.
- Produces: `export default function OnboardingIntroPage({ me }: { me: ShopifyMe })`. Task 8 imports this and passes `me` as a prop from `App.tsx`.

- [ ] **Step 1: Confirm the garment asset is present**

```bash
ls apps/shopify/src/assets/
```

Expected: `sample-garment.jpg` (or `.jpeg`/`.png`/`.webp`) alongside the existing `sample-photo.jpg` and `sample-result.jpg`. If no garment image is present under any of these extensions, **stop and report BLOCKED** — do not fabricate a placeholder file or invent an extension; this file must come from the user. If it's present under a different extension than `.jpg`, adjust the import statement in Step 2 accordingly (the exact extension is the only thing that varies).

- [ ] **Step 2: Implement the page**

Create `apps/shopify/src/pages/OnboardingIntroPage.tsx`:

```tsx
import { BlockStack, Button, InlineStack, Page, Text } from '@shopify/polaris';
import { Navigate, useNavigate } from 'react-router-dom';
import garmentPhoto from '../assets/sample-garment.jpg';
import personPhoto from '../assets/sample-photo.jpg';
import resultPhoto from '../assets/sample-result.jpg';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

function EquationImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={140}
      height={140}
      style={{
        width: 140,
        height: 140,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--p-color-border)',
        display: 'block',
      }}
    />
  );
}

export default function OnboardingIntroPage({ me }: { me: ShopifyMe }) {
  const navigate = useNavigate();

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'intro') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  return (
    <Page>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingLg" alignment="center">
            See how AiVastra works
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            Shoppers upload their photo, pick a garment, and see themselves wearing it instantly.
          </Text>
        </BlockStack>

        <InlineStack gap="400" blockAlign="center" align="center">
          <EquationImage src={personPhoto} alt="Shopper photo" />
          <Text as="span" variant="headingLg">
            +
          </Text>
          <EquationImage src={garmentPhoto} alt="Garment" />
          <Text as="span" variant="headingLg">
            =
          </Text>
          <EquationImage src={resultPhoto} alt="Try-on result" />
        </InlineStack>

        <InlineStack align="center">
          <Button variant="primary" size="large" onClick={() => navigate('/onboarding/products')}>
            Continue
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
```

- [ ] **Step 3: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0. A failure to resolve the `sample-garment.jpg` import means Step 1's file check was wrong or skipped — fix the import extension, don't work around it another way.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/pages/OnboardingIntroPage.tsx apps/shopify/src/assets/sample-garment.jpg
git commit -m "feat(shopify): add onboarding intro page (garment + person = result)"
```

---

### Task 5: `OnboardingProductsPage`

**Files:**
- Create: `apps/shopify/src/pages/OnboardingProductsPage.tsx`

**Interfaces:**
- Consumes: `OnboardingLayout` (Task 3); `getOnboardingStep`, `onboardingPath` (Task 2); `apiFetch` (`../lib/api`); `ErrorBanner` (`../components/ErrorBanner`); `classifyError`/`ClassifiedError` (`../lib/errors`).
- Produces: `export default function OnboardingProductsPage({ me, onRefresh }: { me: ShopifyMe; onRefresh: () => Promise<void> })`. Task 8 wires this in.

- [ ] **Step 1: Implement the page**

Create `apps/shopify/src/pages/OnboardingProductsPage.tsx`:

```tsx
import { BlockStack, Button, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

export default function OnboardingProductsPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'products') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const synced = me.stats.syncedProductCount > 0;
  const enabled = me.store.settings.activation?.mode === 'global' || me.stats.enabledProductCount > 0;
  const done = synced && enabled;

  async function syncProducts() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      const globalModeOn = me.store.settings.activation?.mode === 'global';
      const alreadyEnabled = globalModeOn || me.stats.enabledProductCount > 0;
      if (!alreadyEnabled) {
        await apiFetch('/v1/shopify/activation/mode', {
          method: 'PATCH',
          body: JSON.stringify({ mode: 'global' }),
        });
      }
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <OnboardingLayout
      step={1}
      totalSteps={3}
      title="Bring in your products"
      onContinue={() => navigate('/onboarding/routing')}
      continueDisabled={!done}
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onRetry={syncProducts} />
        <Text as="p">
          Import your Shopify catalog and turn on virtual try-on for every product — you can
          exclude specific ones afterward in Manage.
        </Text>
        <Button variant="primary" onClick={syncProducts} loading={syncing} disabled={done}>
          {done ? 'Products synced' : 'Sync products now'}
        </Button>
        {done && (
          <Text as="p" tone="success">
            {me.stats.syncedProductCount} products synced — virtual try-on is live.
          </Text>
        )}
      </BlockStack>
    </OnboardingLayout>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0.

- [ ] **Step 3: Manually verify the logic**

Reasoning check (no component harness — see Global Constraints):
1. `me` with `syncedProductCount: 0` → `getOnboardingStep` returns `'products'` (matches this page) → renders normally, `done = false`, Continue disabled, button reads "Sync products now".
2. After a successful `syncProducts()` call, `onRefresh()` is awaited, which (once Task 8 wires `App.tsx`) updates the shared `me` — this page re-renders with the new `me` reflecting `syncedProductCount > 0` and (via the auto-enable call) `activation.mode === 'global'`, so `done` becomes `true`, Continue enables, button reads "Products synced" and disables itself.
3. If `me` already has `syncedProductCount > 0` and `enabledProductCount > 0` when this page mounts (e.g. a merchant who did this under the old Dashboard checklist before this wizard existed, then somehow lands here) — `getOnboardingStep(me)` would actually already return `'routing'`, not `'products'`, so the `currentStep !== 'products'` check redirects them to `/onboarding/routing` before this page's body ever renders. This page's own body only ever renders when `currentStep === 'products'`, so `done` inside the body is only ever true transiently, right after a successful sync, immediately before the merchant clicks Continue.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/pages/OnboardingProductsPage.tsx
git commit -m "feat(shopify): add onboarding products-setup page"
```

---

### Task 6: `OnboardingRoutingPage` + export `Basket`/`RuleEditorModal` from `RoutingPage.tsx`

**Files:**
- Modify: `apps/shopify/src/pages/RoutingPage.tsx` (add `export` to two existing declarations — no behavior change)
- Create: `apps/shopify/src/pages/OnboardingRoutingPage.tsx`

**Interfaces:**
- Consumes: `Basket` interface and `RuleEditorModal` component, both now exported from `../pages/RoutingPage` (this task exports them; they are unchanged otherwise — `RuleEditorModal` already takes `{ rule: StoreRule | null; baskets: Basket[]; takenBasketIds: Set<string>; onClose: () => void; onSaved: (message: string) => void }`); `OnboardingLayout` (Task 3); `getOnboardingStep`, `onboardingPath` (Task 2).
- Produces: `export default function OnboardingRoutingPage({ me, onRefresh }: { me: ShopifyMe; onRefresh: () => Promise<void> })`. Task 8 wires this in.

- [ ] **Step 1: Export `Basket` and `RuleEditorModal` from RoutingPage.tsx**

In `apps/shopify/src/pages/RoutingPage.tsx`, find:

```ts
interface Basket {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}
```

Replace with:

```ts
export interface Basket {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}
```

Then find:

```ts
function RuleEditorModal({
```

Replace with:

```ts
export function RuleEditorModal({
```

No other change to this file — `RoutingTab`'s default export and everything else stays exactly as-is.

- [ ] **Step 2: Implement the onboarding routing page**

Create `apps/shopify/src/pages/OnboardingRoutingPage.tsx`:

```tsx
import { BlockStack, Button, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';
import { type Basket, RuleEditorModal } from './RoutingPage';

export default function OnboardingRoutingPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [takenBasketIds, setTakenBasketIds] = useState<Set<string>>(new Set());
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [ruleAdded, setRuleAdded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadError, setLoadError] = useState<ClassifiedError | null>(null);
  const [submitError, setSubmitError] = useState<ClassifiedError | null>(null);

  const loadBaskets = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([
        apiFetch<{ items: Basket[] }>('/v1/shopify/baskets'),
        apiFetch<{ storeRules: { funnelTemplateId: string }[] }>('/v1/shopify/funnel-rules'),
      ]);
      setBaskets(b.items);
      setTakenBasketIds(new Set(r.storeRules.map((rule) => rule.funnelTemplateId)));
      setLoadError(null);
    } catch (err) {
      setLoadError(classifyError(err));
    }
  }, []);

  useEffect(() => {
    loadBaskets();
  }, [loadBaskets]);

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'routing') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  async function handleContinue() {
    setConfirming(true);
    setSubmitError(null);
    try {
      await apiFetch('/v1/shopify/onboarding/confirm-routing', { method: 'POST' });
      await onRefresh();
      navigate('/onboarding/theme');
    } catch (err) {
      setSubmitError(classifyError(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <OnboardingLayout
        step={2}
        totalSteps={3}
        title="Route products to the right experience"
        onContinue={handleContinue}
        continueLoading={confirming}
      >
        <BlockStack gap="300">
          <ErrorBanner error={loadError} onRetry={loadBaskets} />
          <ErrorBanner error={submitError} onDismiss={() => setSubmitError(null)} />
          <Text as="p">
            By default, every product routes to AiVastra's standard try-on experience. If you sell
            different kinds of products — sarees, footwear, accessories — you can add a rule now to
            route them differently, or skip this and add rules later from Manage.
          </Text>
          {ruleAdded ? (
            <Text as="p" tone="success">
              Rule added — you can add more later from Manage.
            </Text>
          ) : (
            <Button onClick={() => setShowRuleEditor(true)} disabled={baskets.length === 0}>
              Add a rule
            </Button>
          )}
        </BlockStack>
      </OnboardingLayout>

      {showRuleEditor && (
        <RuleEditorModal
          rule={null}
          baskets={baskets}
          takenBasketIds={takenBasketIds}
          onClose={() => setShowRuleEditor(false)}
          onSaved={() => {
            setRuleAdded(true);
            loadBaskets();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0. In particular, confirm `ManagePage.tsx`'s existing `import RoutingTab from './RoutingPage';` (default import) still works unchanged — adding named exports alongside a default export doesn't affect it.

- [ ] **Step 4: Manually verify the logic**

1. `me` with `onboardingRoutingConfirmed` unset/false and `currentStep === 'routing'` → page renders, Continue is never disabled (per the design's "always works" rule), "Add a rule" button is present but optional.
2. Clicking "Add a rule" opens `RuleEditorModal` in create mode (`rule={null}`); on save, `onSaved` sets `ruleAdded` true and reloads baskets/taken-IDs; `RuleEditorModal` also calls `onClose` itself after a successful save (see its `submit()` — `onSaved(message); onClose();`), so `showRuleEditor` returns to `false` automatically.
3. Clicking Continue (with or without having added a rule) calls `confirm-routing`, awaits `onRefresh()`, then navigates to `/onboarding/theme`.

- [ ] **Step 5: Commit**

```bash
git add apps/shopify/src/pages/RoutingPage.tsx apps/shopify/src/pages/OnboardingRoutingPage.tsx
git commit -m "feat(shopify): add onboarding routing-setup page"
```

---

### Task 7: `OnboardingThemePage`

**Files:**
- Create: `apps/shopify/src/pages/OnboardingThemePage.tsx`

**Interfaces:**
- Consumes: `OnboardingLayout` (Task 3); `getOnboardingStep`, `onboardingPath` (Task 2).
- Produces: `export default function OnboardingThemePage({ me, onRefresh }: { me: ShopifyMe; onRefresh: () => Promise<void> })`. Task 8 wires this in.

- [ ] **Step 1: Implement the page**

Create `apps/shopify/src/pages/OnboardingThemePage.tsx`:

```tsx
import { BlockStack, Button, Text } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

export default function OnboardingThemePage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [openingEditor, setOpeningEditor] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'theme') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const themeBlockDone = me.store.settings.themeBlockConfirmed ?? false;

  async function openThemeEditor() {
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(false);
    }
  }

  async function confirmThemeBlock() {
    setConfirming(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/onboarding/confirm-theme-block', { method: 'POST' });
      await onRefresh();
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <OnboardingLayout
      step={3}
      totalSteps={3}
      title="Add the Try It On block to your product page"
      onContinue={() => navigate('/')}
      continueDisabled={!themeBlockDone}
    >
      <BlockStack gap="300">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Text as="p">
          Required — the try-on button only appears where you place this block. Open the theme
          editor, drag it directly above the Buy Buttons block, then save.
        </Text>
        <BlockStack gap="200">
          <Button onClick={openThemeEditor} loading={openingEditor}>
            Open theme editor
          </Button>
          <Button
            variant="primary"
            onClick={confirmThemeBlock}
            loading={confirming}
            disabled={themeBlockDone}
          >
            {themeBlockDone ? 'Block confirmed' : "I've added it"}
          </Button>
        </BlockStack>
      </BlockStack>
    </OnboardingLayout>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0.

- [ ] **Step 3: Manually verify the logic**

1. `me` with `themeBlockConfirmed: false` and `currentStep === 'theme'` → renders normally, Continue disabled, "I've added it" enabled.
2. Clicking "I've added it" calls `confirm-theme-block`, awaits `onRefresh()` — once Task 8 wires this up, the shared `me` updates to `themeBlockConfirmed: true`, this page re-renders with Continue enabled and the button now reading "Block confirmed" (disabled).
3. Clicking Continue navigates to `/`. Separately, once `me` reflects `themeBlockConfirmed: true`, `getOnboardingStep(me)` returns `null` for the whole app — Task 8's `App.tsx` gate will also redirect away from any `/onboarding/*` route once complete, so this page's own `navigate('/')` and the app-level gate agree rather than fight each other.

- [ ] **Step 4: Commit**

```bash
git add apps/shopify/src/pages/OnboardingThemePage.tsx
git commit -m "feat(shopify): add onboarding theme-block page"
```

---

### Task 8: Wire the gate into `App.tsx`, hide nav in `AppNavMenu`, clean up `DashboardPage`

**Files:**
- Modify: `apps/shopify/src/App.tsx` (full rewrite of the component body — the diff touches state, routes, and the nav-menu render)
- Modify: `apps/shopify/src/components/AppNavMenu.tsx` (add `onboardingComplete` prop)
- Modify: `apps/shopify/src/pages/DashboardPage.tsx` (remove the "Getting started" card and its state; add one small persistent "Customize the button" card)

**Interfaces:**
- Consumes: `OnboardingIntroPage`, `OnboardingProductsPage`, `OnboardingRoutingPage`, `OnboardingThemePage` (Tasks 4–7); `getOnboardingStep`, `onboardingPath` (Task 2).
- Produces: nothing further — this is the last task in the plan.

- [ ] **Step 1: Rewrite `App.tsx`**

Replace the entire contents of `apps/shopify/src/App.tsx` with:

```tsx
import '@shopify/polaris/build/esm/styles.css';
import { AppProvider, Banner, Box, Frame, Navigation, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppNavMenu, NAV_ITEMS } from './components/AppNavMenu';
import { apiFetch, setShopDomain } from './lib/api';
import {
  AppBridgeTimeoutError,
  clearRecoveryReloadMarker,
  shouldAttemptRecoveryReload,
} from './lib/appBridge';
import { type ClassifiedError, classifyError } from './lib/errors';
import { runNavGuard } from './lib/navGuard';
import { getOnboardingStep, onboardingPath } from './lib/onboarding';
import AnalyticsPage from './pages/AnalyticsPage';
import AutorefillCallbackPage from './pages/AutorefillCallbackPage';
import BillingCallbackPage from './pages/BillingCallbackPage';
import DashboardPage from './pages/DashboardPage';
import ManagePage from './pages/ManagePage';
import OnboardingIntroPage from './pages/OnboardingIntroPage';
import OnboardingProductsPage from './pages/OnboardingProductsPage';
import OnboardingRoutingPage from './pages/OnboardingRoutingPage';
import OnboardingThemePage from './pages/OnboardingThemePage';
import PricingPage from './pages/PricingPage';
import SettingsPage from './pages/SettingsPage';
import SupportPage from './pages/SupportPage';
import type { ShopifyMe } from './types';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then((res) => {
        clearRecoveryReloadMarker();
        setShopDomain(res.store.shopDomain);
        setMe(res);
        setLoading(false);
      })
      .catch((err) => {
        // A wedged App Bridge instance can't be recovered by retrying the call
        // in place — only a fresh document gets a fresh instance. Do that once
        // automatically so the merchant never sees an error for what is a
        // transient Shopify-side hang.
        if (err instanceof AppBridgeTimeoutError && shouldAttemptRecoveryReload()) {
          window.location.reload();
          return; // Keep the spinner up; this document is being replaced.
        }
        const classified = classifyError(err);
        if (classified.code === 'SHOPIFY_REAUTH_REQUIRED') {
          return; // Keep the spinner up; apiFetch's top-level redirect is in flight.
        }
        setError(classified);
        setLoading(false);
      });
  }, []);

  // Onboarding pages call this (via the `onRefresh` prop passed to their
  // routes below) after an action that changes onboarding progress (sync,
  // confirm-routing, confirm-theme-block), before navigating to the next
  // step. Keeping exactly one `me` here — rather than letting each
  // onboarding page independently re-fetch its own copy — is what keeps the
  // gate effect below and each page's own step-order check from disagreeing
  // about where the merchant currently is.
  const refreshMe = useCallback(async () => {
    const res = await apiFetch<ShopifyMe>('/v1/shopify/me');
    setMe(res);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The onboarding hard gate. Coarse-grained on purpose: it only corrects
  // two violations — escaping to a non-onboarding route while incomplete,
  // and lingering under /onboarding once complete. It deliberately does NOT
  // try to force the exact current onboarding sub-route to match the exact
  // current step — each onboarding page already does that itself (via its
  // own getOnboardingStep check against this same `me`), and doing it here
  // too would double-guess a page's own just-completed, already-reflected-
  // in-`me` action the instant it calls navigate() to move to the next step.
  useEffect(() => {
    if (!me) return;
    const step = getOnboardingStep(me);
    const onOnboardingRoute = location.pathname.startsWith('/onboarding');
    if (step !== null && !onOnboardingRoute) {
      navigate(onboardingPath(step), { replace: true });
    } else if (step === null && onOnboardingRoute) {
      navigate('/', { replace: true });
    }
  }, [me, location.pathname, navigate]);

  if (loading) {
    return (
      <AppProvider i18n={{}}>
        <Spinner accessibilityLabel="Loading" size="large" />
      </AppProvider>
    );
  }

  if (error) {
    return (
      <AppProvider i18n={{}}>
        <Box padding="800">
          <Banner
            title="Couldn't load AiVastra"
            tone={error.tone}
            action={{ content: 'Retry', onAction: () => window.location.reload() }}
          >
            {error.message}
          </Banner>
        </Box>
      </AppProvider>
    );
  }

  // load() sets `me` and `loading: false` together on success, and every
  // failure path above returns early while leaving `loading: true` — so by
  // the time both early returns above are behind us, `me` is always set.
  // This exists only so TypeScript can narrow it to non-null below.
  if (!me) {
    return null;
  }

  const onboardingStep = getOnboardingStep(me);
  const onboardingComplete = onboardingStep === null;

  const devNavigation =
    !window.shopify && onboardingComplete ? (
      <Navigation location={location.pathname}>
        <Navigation.Section
          title="AiVastra (dev)"
          items={NAV_ITEMS.map((item) => ({
            label: item.label,
            icon: item.icon,
            selected: location.pathname === item.path,
            onClick: () => {
              if (runNavGuard()) navigate(item.path);
            },
          }))}
        />
      </Navigation>
    ) : undefined;

  return (
    <AppProvider i18n={{}}>
      <AppNavMenu onboardingComplete={onboardingComplete} />
      <Frame navigation={devNavigation}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/billing/callback" element={<BillingCallbackPage />} />
          <Route path="/billing/autorefill-callback" element={<AutorefillCallbackPage />} />
          <Route path="/onboarding" element={<OnboardingIntroPage me={me} />} />
          <Route
            path="/onboarding/products"
            element={<OnboardingProductsPage me={me} onRefresh={refreshMe} />}
          />
          <Route
            path="/onboarding/routing"
            element={<OnboardingRoutingPage me={me} onRefresh={refreshMe} />}
          />
          <Route
            path="/onboarding/theme"
            element={<OnboardingThemePage me={me} onRefresh={refreshMe} />}
          />
          {/* Merchants may have bookmarked the old path while it was the only
              product surface. */}
          <Route path="/products" element={<Navigate to="/manage" replace />} />
          {/* Merchants may have bookmarked the old path while Routing was its
              own page. */}
          <Route path="/routing" element={<Navigate to="/manage" replace />} />
          <Route path="/embedded" element={<Navigate to="/" replace />} />
          {/* Widget Design page removed — merchants may have it bookmarked or
              pinned in Shopify admin's nav history. */}
          <Route path="/widget-design" element={<Navigate to="/" replace />} />
        </Routes>
      </Frame>
    </AppProvider>
  );
}
```

- [ ] **Step 2: Update `AppNavMenu.tsx`**

Replace the entire contents of `apps/shopify/src/components/AppNavMenu.tsx` with:

```tsx
import {
  CashDollarIcon,
  ChartVerticalIcon,
  HomeIcon,
  ProductIcon,
  QuestionCircleIcon,
  SettingsIcon,
} from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { runNavGuard } from '../lib/navGuard';

// Must match BrowserRouter's basename in main.tsx. <ui-nav-menu> hands its
// hrefs to Shopify admin, which navigates the iframe to that exact path — a
// bare "/manage" would land outside the app's base in production.
const BASENAME = import.meta.env.PROD ? '/shopify-admin' : '';

export const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/manage', label: 'Manage', icon: ProductIcon },
  { path: '/analytics', label: 'Analytics', icon: ChartVerticalIcon },
  { path: '/pricing', label: 'Billing', icon: CashDollarIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
  { path: '/support', label: 'Support', icon: QuestionCircleIcon },
];

export function AppNavMenu({ onboardingComplete }: { onboardingComplete: boolean }) {
  const navigate = useNavigate();

  // window.shopify is only defined inside the Shopify admin iframe
  // (see lib/appBridge.ts). Outside it, <ui-nav-menu> renders nothing at all
  // — the dev-mode nav is supplied by App.tsx instead, via Frame's own
  // `navigation` prop (Polaris's <Navigation> requires a <Frame> ancestor
  // providing frame context, which a sibling render here cannot give it).
  // Also hidden while onboarding is incomplete — a merchant mid-wizard has
  // nowhere else to go yet, and nav items that just bounce back to the
  // wizard would be confusing.
  if (!window.shopify || !onboardingComplete) {
    return null;
  }

  return (
    <ui-nav-menu>
      {/* Shopify requires the first child to be the app's home link and ignores
          its label, but it must still be present or the menu does not render. */}
      <a
        href={`${BASENAME}/`}
        rel="home"
        onClick={(e) => {
          e.preventDefault();
          if (runNavGuard()) navigate('/');
        }}
      >
        Dashboard
      </a>
      {NAV_ITEMS.slice(1).map((item) => (
        <a
          key={item.path}
          href={`${BASENAME}${item.path}`}
          onClick={(e) => {
            // Let Shopify keep the admin URL in sync, but do the actual route
            // change in-app — a real navigation would reload the iframe and
            // re-run the App Bridge handshake on every nav click.
            e.preventDefault();
            if (runNavGuard()) navigate(item.path);
          }}
        >
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}
```

- [ ] **Step 3: Clean up `DashboardPage.tsx`**

Replace the entire contents of `apps/shopify/src/pages/DashboardPage.tsx` with:

```tsx
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  Toast,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BalanceCard } from '../components/BalanceCard';
import { EmailBonusModal } from '../components/EmailBonusModal';
import { ErrorBanner } from '../components/ErrorBanner';
import { PackGrid } from '../components/PackGrid';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import type { ShopifyMe, ShopifyStats } from '../types';

// Uses useNavigate() directly rather than accepting navigate as a prop: both
// call sites (Dashboard, Pricing) render this from within the SPA's router
// tree, so the hook always resolves, and it keeps callers from having to
// thread a navigate function through just to render a banner.
//
// Takes the whole `me` object, not just `runway` — the banner now has to
// branch on `autorefill.status` too, since a store enrolled in auto-refill
// changes what "low credits" should mean (see below).
//
// Renders `null` at 'ok' — this is deliberately not a blocking modal, and the
// app is not disabled at zero: a merchant at zero can still manage products,
// read analytics and edit the widget, and the actual breakage is on the
// storefront, not in here.
//
// `hideCapReached` lets PricingPage suppress the CAP_REACHED banner below:
// that page already renders an equivalent "Auto-refill has stopped" banner
// with a raise-cap control inline in its auto-refill card, so rendering both
// would duplicate the same message. Suppressing it here still falls through
// to the plain low-balance banner further down if the store's balance is
// actually low — only the CAP_REACHED-specific banner is skipped.
export function LowCreditsBanner({
  me,
  hideCapReached = false,
}: {
  me: ShopifyMe;
  hideCapReached?: boolean;
}) {
  const navigate = useNavigate();
  const { runway, autorefill } = me;

  // Auto-refill has stopped at a ceiling the merchant set. This is the one
  // auto-refill state that needs their attention, and it is more urgent than a
  // plain low balance because they believe it is handled.
  if (autorefill.status === 'CAP_REACHED' && !hideCapReached) {
    return (
      <Banner
        tone="critical"
        title="Auto-refill has stopped — monthly limit reached"
        // Not `url: '/pricing'` — see the comment on the low-balance banner
        // below; same production-vs-dev basename trap.
        action={{ content: 'Raise limit', onAction: () => navigate('/pricing') }}
      >
        <Text as="p">
          Your balance is {runway.balance.toLocaleString()} credits and automatic refills are paused
          until you raise your monthly limit.
        </Text>
      </Banner>
    );
  }

  // A healthy enrolled store is never "low" — the refill fires first. But a
  // store already at literal zero (`runway.level === 'empty'`) is proof that
  // auto-refill is NOT actually keeping this store topped up right now,
  // whatever its recorded status says (stuck-PENDING purchase row, expired
  // card, missed webhook, or a declined subscription that was never really
  // approved) — falls through to the low-balance banner below instead of
  // going silent exactly when the merchant is most at risk.
  if (autorefill.status === 'ACTIVE' && runway.level !== 'empty') return null;

  if (runway.level === 'ok') return null;

  const days = runway.daysRemaining != null ? Math.max(1, Math.round(runway.daysRemaining)) : null;

  return (
    <Banner
      tone={runway.level === 'warning' ? 'warning' : 'critical'}
      title={
        runway.level === 'empty'
          ? 'You’re out of credits — try-on is paused for shoppers'
          : days != null
            ? `Low credits — about ${days} day${days === 1 ? '' : 's'} left`
            : 'Low credits'
      }
      // Not `url: '/pricing'` — Polaris's `Banner` action `url` renders a
      // plain `<a href>`, which is only safe under this app's `AppProvider`
      // (no `linkComponent` configured) when the router basename and Vite
      // base both happen to be `/`, i.e. in dev only. In production both are
      // `/shopify-admin`, so an href navigates the embedded iframe to the
      // wrong app entirely. `onAction` + `navigate()` goes through the router
      // instead, same fix as the Dashboard's own Buy-credits button.
      action={{ content: 'Buy credits', onAction: () => navigate('/pricing') }}
    >
      <Text as="p">
        {runway.balance.toLocaleString()} credits ({runway.tryOnsRemaining.toLocaleString()}{' '}
        try-ons)
        {runway.dailyBurnCredits > 0
          ? ` at about ${Math.round(runway.dailyBurnCredits)} credits/day.`
          : '.'}
      </Text>
    </Banner>
  );
}

type StatusKey = keyof ShopifyStats['statusCounts'];

const STATUS_TONE: Record<StatusKey, 'success' | 'attention' | 'critical' | 'info'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'info',
};

const STATUS_LABEL: Record<StatusKey, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Auto-opens on first load (see showEmailBonusModal below); "Maybe later"
  // sets this false without touching emailBonusClaimed, so the persistent
  // card further down stays as the way back in.
  const [emailBonusModalOpen, setEmailBonusModalOpen] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError(classifyError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A merchant only ever reaches Dashboard once onboarding (sync/enable,
  // routing, theme block) is fully done — see App.tsx's onboarding gate —
  // so this button is the one remaining, purely optional follow-up: telling
  // them where to go to restyle a block that's already in place.
  async function openThemeEditor() {
    setOpeningEditor(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/v1/shopify/onboarding/theme-editor-url');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setOpeningEditor(false);
    }
  }

  if (loading) {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText />
      </SkeletonPage>
    );
  }

  const emailBonusClaimed = me?.store.settings.emailBonusClaimed ?? false;
  // The tile itself stays up until the store has bought a pack at least
  // once — claiming the bonus only changes what the tile says, not whether
  // it's there. The popup auto-open is still gated on the bonus itself,
  // since re-showing it after it's claimed would have nothing left to offer.
  const showFreeCreditsTile = me != null && !me.hasPurchasedPack;
  const showEmailBonusModal = me != null && !emailBonusClaimed && emailBonusModalOpen;

  return (
    <Page title="Dashboard" subtitle="Here's how virtual try-on is performing on your store.">
      <BlockStack gap="400">
        <ErrorBanner error={error} onRetry={load} />

        {me && <LowCreditsBanner me={me} />}

        <BalanceCard me={me} />

        <PackGrid
          onError={setError}
          leadingCard={
            showFreeCreditsTile ? (
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Free
                    </Text>
                    <Badge tone="success">
                      {emailBonusClaimed ? 'Credits availed' : 'No purchase required'}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="headingLg">
                    Free Credits
                  </Text>

                  {emailBonusClaimed ? (
                    <Text as="p" tone="subdued">
                      Already added to your balance.
                    </Text>
                  ) : (
                    <>
                      <BlockStack gap="100">
                        <Text as="p">5 try-ons</Text>
                        <Text as="p" tone="subdued">
                          Confirm your contact email to claim them.
                        </Text>
                      </BlockStack>

                      <Button variant="primary" onClick={() => setEmailBonusModalOpen(true)}>
                        Claim credits
                      </Button>
                    </>
                  )}
                </BlockStack>
              </Card>
            ) : undefined
          }
        />

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Customize the button
            </Text>
            <Text as="p" tone="subdued">
              Change the button's text, colors, promo message, or position by clicking the block in
              the theme editor — that's where its settings live.
            </Text>
            <InlineStack align="end">
              <Button onClick={openThemeEditor} loading={openingEditor}>
                Open theme editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-Ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.totalTryOns ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Products Synced
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.syncedProductCount ?? 0}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" tone="subdued">
                Try-On Enabled
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.enabledProductCount ?? 0}
              </Text>
              <Text as="p" tone="subdued">
                of {me?.stats.syncedProductCount ?? 0} synced
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Today's try-ons
              </Text>
              <Text as="p" variant="heading2xl">
                {me?.stats.storeDailyCap
                  ? `${me.stats.todayTryOns} / ${me.stats.storeDailyCap}`
                  : (me?.stats.todayTryOns ?? 0)}
              </Text>
              {me?.stats.storeDailyCap != null &&
                me.stats.todayTryOns >= me.stats.storeDailyCap && (
                  <Banner tone="warning">
                    Your daily limit is reached. Try-on is paused until tomorrow.
                  </Banner>
                )}
              <Text as="p" tone="subdued">
                {me?.stats.capturedEmailCount ?? 0} emails collected
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Sync status
              </Text>
              {(['active', 'processing', 'failed', 'disabled'] as const).map((key) => (
                <InlineStack key={key} align="space-between" blockAlign="center">
                  <Text as="span">{STATUS_LABEL[key]}</Text>
                  <Badge tone={STATUS_TONE[key]}>{String(me?.stats.statusCounts[key] ?? 0)}</Badge>
                </InlineStack>
              ))}
            </BlockStack>
          </Card>
        </InlineGrid>

        <InlineStack align="space-between" blockAlign="center">
          <Button variant="plain" onClick={() => navigate('/manage')}>
            Manage Products
          </Button>
          {me?.store.connectedSince && (
            <Text as="span" tone="subdued">
              Connected since {new Date(me.store.connectedSince).toLocaleDateString()}
            </Text>
          )}
        </InlineStack>
      </BlockStack>

      {showEmailBonusModal && me && (
        <EmailBonusModal
          me={me}
          onClose={() => setEmailBonusModalOpen(false)}
          onClaimed={(result) => {
            load();
            setToastMessage(
              result.creditsGranted > 0
                ? `You got ${result.creditsGranted.toLocaleString()} free credits!`
                : 'Thanks for confirming your email.',
            );
          }}
        />
      )}

      {toastMessage && <Toast content={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </Page>
  );
}
```

- [ ] **Step 4: Typecheck, lint, and build**

```bash
pnpm --filter @aivastra/shopify-admin typecheck
pnpm --filter @aivastra/shopify-admin lint
pnpm --filter @aivastra/shopify-admin build
```
Expected: all three exit 0.

- [ ] **Step 5: Manually verify the full redirect matrix**

No component harness (see Global Constraints) — verify by reasoning through `App.tsx`'s gate effect and each page's own check, using concrete `me` values:

1. **Fresh install** (`syncedProductCount: 0`, no settings flags): `getOnboardingStep` → `'intro'`. On landing at `/` (Dashboard's route), the gate effect sees `step !== null` and `location.pathname` (`/`) doesn't start with `/onboarding` → redirects to `onboardingPath('intro')` = `/onboarding`. `OnboardingIntroPage` renders (its own check: `getOnboardingStep(me) === 'intro'`, matches, no further redirect).
2. **Mid-progress reload** (`syncedProductCount: 5`, `activation.mode: 'global'`, nothing else): step → `'routing'`. Landing at `/` redirects to `/onboarding/routing`. Landing directly at `/onboarding` (bookmarked) also redirects: `OnboardingIntroPage`'s own check sees `getOnboardingStep(me) !== 'intro'` (`'routing'`) and renders `<Navigate to="/onboarding/routing" />`.
3. **Manually typing ahead** (same mid-progress `me`, merchant types `/onboarding/theme`): the gate effect's coarse check passes (still on an onboarding route, step still not null — no correction fires at the App level), but `OnboardingThemePage`'s own check sees `getOnboardingStep(me) !== 'theme'` (`'routing'`) and renders `<Navigate to="/onboarding/routing" />` instead — the per-page check is what catches this case, not the App-level gate.
4. **All three done**: step → `null`. Landing at `/onboarding` (bookmarked from earlier): gate effect sees `step === null` and `onOnboardingRoute` true → redirects to `/`. `AppNavMenu` renders normally (`onboardingComplete: true`).
5. **Nav hidden throughout 1–3**: `onboardingComplete` is `false` in every case above, so `AppNavMenu` returns `null` and `devNavigation` is `undefined` — no way to navigate away from the wizard via nav chrome.

- [ ] **Step 6: Commit**

```bash
git add apps/shopify/src/App.tsx apps/shopify/src/components/AppNavMenu.tsx apps/shopify/src/pages/DashboardPage.tsx
git commit -m "$(cat <<'EOF'
feat(shopify): wire mandatory onboarding gate into App, retire checklist

App.tsx now lifts `me` and gates every non-onboarding route until
sync+enable, routing confirmation, and the theme block are all done.
DashboardPage's optional "Getting started" checklist is removed — a
merchant can only reach it once onboarding is complete — replaced with
a single small "Customize the button" card.
EOF
)"
```
