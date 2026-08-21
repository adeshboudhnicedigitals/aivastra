import { Banner, BlockStack, Page, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

/**
 * Shopify sends the merchant here after they approve a one-time charge for a
 * credit pack (the `confirmationUrl` returned from `POST
 * /v1/shopify/billing/purchase`). Confirming is what actually grants the
 * credits they just paid for, so this page is the one place in the app
 * where a silent failure is least acceptable — there is no background
 * scheduler reconciling purchases, so a swallowed error here means the
 * merchant was charged and never finds out the credits didn't land.
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
  const [declined, setDeclined] = useState(false);

  const confirm = useCallback(async () => {
    setError(null);
    for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt++) {
      try {
        const purchase = new URLSearchParams(window.location.search).get('purchase') ?? '';
        const result = await apiFetch<{
          status: string;
          creditsGranted: number;
          creditBalance: number;
        }>(`/v1/shopify/billing/purchase/confirm?purchase=${encodeURIComponent(purchase)}`);
        // A DECLINED purchase is a normal outcome, not a failure — the merchant
        // looked at the charge and said no. Sending them to the dashboard with
        // no comment would be confusing, but so would an error banner about a
        // charge that deliberately never happened.
        if (result.status === 'DECLINED' || result.status === 'EXPIRED') {
          setDeclined(true);
          return;
        }
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

  if (declined) {
    return (
      <Page>
        <Banner
          title="No charge was made"
          tone="info"
          action={{ content: 'Back to credits', onAction: () => navigate('/pricing') }}
        >
          <Text as="p">
            You didn't approve the charge, so nothing was billed and no credits were added.
          </Text>
        </Banner>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <Banner
          title="We couldn't confirm your purchase"
          tone="critical"
          action={{ content: 'Try again', onAction: () => void confirm() }}
          secondaryAction={{ content: 'Go to dashboard', onAction: () => navigate('/') }}
        >
          <BlockStack gap="200">
            <Text as="p">
              You may have been charged, but we haven't been able to add the credits to your account
              yet. Retrying is safe — credits are only ever granted once per purchase.
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
      <Spinner accessibilityLabel="Confirming your purchase" size="large" />
    </Page>
  );
}
