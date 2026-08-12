import { Banner, BlockStack, Page, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

/**
 * Shopify sends the merchant here after they approve a plan (the Redirect URL
 * configured per-plan in Partner Dashboard). Confirming is what actually grants
 * the credits they just paid for, so this page is the one place in the app
 * where a silent failure is least acceptable.
 *
 * It used to swallow the error and navigate to the dashboard regardless,
 * reasoning that billing-scheduler.ts would reconcile on its next tick. That
 * tick is hourly: a merchant who had just been charged saw no credits, no
 * error, and no reason to think anything had gone wrong, for up to an hour. The
 * scheduler is the right safety net for renewals and cancellations that happen
 * while nobody is looking — it is not a substitute for telling someone standing
 * right here that their purchase did not land.
 */

// A confirm is one Admin API round-trip behind Shopify's own redirect, so a
// blip is plausible and worth absorbing silently. Two quiet retries cover that
// without making a genuinely broken store wait long for an answer.
const CONFIRM_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function BillingCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback(async () => {
    setError(null);
    for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt++) {
      try {
        await apiFetch('/v1/shopify/billing/confirm');
        navigate('/', { replace: true });
        return;
      } catch (err) {
        // A reauth-required response is already being handled elsewhere:
        // apiFetch navigates the top-level frame into the reauth flow, which
        // re-provisions the store and then returns here. Rendering an error
        // would only race that redirect, and retrying cannot succeed until it
        // completes.
        if ((err as { code?: string }).code === 'SHOPIFY_REAUTH_REQUIRED') return;
        if (attempt === CONFIRM_ATTEMPTS) {
          setError((err as Error).message);
          return;
        }
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }, [navigate]);

  useEffect(() => {
    void confirm();
  }, [confirm]);

  if (error) {
    return (
      <Page>
        <Banner
          title="We couldn't confirm your plan"
          tone="critical"
          action={{ content: 'Try again', onAction: () => void confirm() }}
          secondaryAction={{ content: 'Go to dashboard', onAction: () => navigate('/') }}
        >
          <BlockStack gap="200">
            <Text as="p">
              Your plan may have been charged, but we haven't been able to add the credits to your
              account yet. Retrying is safe — credits are only ever granted once per billing period.
            </Text>
            <Text as="p" tone="subdued">
              {error}
            </Text>
            <Text as="p" tone="subdued">
              If this keeps happening, contact support and we'll sort it out. Your credits will also
              be added automatically once the problem clears.
            </Text>
          </BlockStack>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <Spinner accessibilityLabel="Confirming your plan" size="large" />
    </Page>
  );
}
