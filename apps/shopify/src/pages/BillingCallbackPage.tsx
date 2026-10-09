import { Banner, BlockStack, Page, Spinner, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppFont } from '../components/AppFont';
import { useConfirmWithRetry } from '../hooks/useConfirmWithRetry';
import { apiFetch } from '../lib/api';
import { waitForPayment } from '../lib/purchase-wait';
import type { PurchaseConfirmResponse } from '../types';

const POLL_MS = 5_000;
const WAIT_MS = 3 * 60_000;

/**
 * Shopify sends the merchant here after they approve a one-time charge for a
 * credit pack. Under hold-until-paid, approval is not payment: the charge is
 * invoiced at approval and collected afterwards, so confirm may answer
 * AWAITING. We poll for up to WAIT_MS (most payments land in 1–2 minutes),
 * then hand off to the dashboard's PendingPaymentBanner — the api's settlement
 * loop grants the credits whenever payment lands, even if this tab is closed.
 * A failed confirm is still the one error here worth shouting about.
 */
export default function BillingCallbackPage() {
  const navigate = useNavigate();
  const [declined, setDeclined] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const confirm = useCallback(async () => {
    const purchase = new URLSearchParams(window.location.search).get('purchase') ?? '';
    return apiFetch<PurchaseConfirmResponse>(
      `/v1/shopify/billing/purchase/confirm?purchase=${encodeURIComponent(purchase)}`,
    );
  }, []);

  const { error, run } = useConfirmWithRetry(confirm);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const first = await run();
      if (!first.ok || cancelled) return; // reauth redirect in flight, or error state already set
      // A DECLINED purchase is a normal outcome, not a failure — the merchant
      // looked at the charge and said no. Sending them to the dashboard with
      // no comment would be confusing, but so would an error banner about a
      // charge that deliberately never happened.
      if (first.data.status === 'DECLINED' || first.data.status === 'EXPIRED') {
        setDeclined(true);
        return;
      }
      if (first.data.paymentStatus === 'AWAITING') setWaiting(true);
      const data = await waitForPayment(first.data, confirm, {
        pollMs: POLL_MS,
        waitMs: WAIT_MS,
        isCancelled: () => cancelled,
      });
      if (cancelled) return;
      // Decide "credits landed" from paymentStatus, never creditsGranted: in
      // hold mode that count is advisory and can be 0 even when credits landed.
      const settled = data.paymentStatus === 'PAID' || data.paymentStatus === 'NOT_REQUIRED';
      navigate('/', { replace: true, state: settled ? { creditsAdded: data.credits } : undefined });
    })();
    return () => {
      cancelled = true;
    };
  }, [run, confirm, navigate]);

  if (declined) {
    return (
      <AppFont>
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
      </AppFont>
    );
  }

  if (error) {
    return (
      <AppFont>
        <Page>
          <Banner
            title="We couldn't confirm your purchase"
            tone="critical"
            action={{ content: 'Try again', onAction: () => void run() }}
            secondaryAction={{ content: 'Go to dashboard', onAction: () => navigate('/') }}
          >
            <BlockStack gap="200">
              <Text as="p">
                You may have been charged, but we haven't been able to add the credits to your
                account yet. Retrying is safe — credits are only ever granted once per purchase.
              </Text>
              <Text as="p" tone="subdued">
                {error.message}
              </Text>
            </BlockStack>
          </Banner>
        </Page>
      </AppFont>
    );
  }

  return (
    <AppFont>
      <Page>
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Confirming your payment" size="large" />
          {waiting && (
            <Text as="p" tone="subdued">
              Confirming your payment with Shopify… this usually takes a minute or two.
            </Text>
          )}
        </BlockStack>
      </Page>
    </AppFont>
  );
}
