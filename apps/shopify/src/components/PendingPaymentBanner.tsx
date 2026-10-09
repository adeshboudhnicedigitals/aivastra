import { Banner, BlockStack, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import type { PendingPurchase, PurchaseConfirmResponse } from '../types';

/**
 * Credit packs approved but not yet paid. Approval only invoices the merchant;
 * Shopify collects afterwards, and credits are granted once it has. AWAITING
 * shows on Dashboard + Pricing; UNPAID (no payment after 30 days) only on
 * Pricing (`include="all"`), so an abandoned invoice doesn't nag forever.
 */
export function PendingPaymentBanner({
  shopDomain,
  include,
}: {
  shopDomain: string;
  include: 'awaiting' | 'all';
}) {
  const [purchases, setPurchases] = useState<PendingPurchase[]>([]);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [received, setReceived] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ purchases: PendingPurchase[] }>(
        '/v1/shopify/billing/purchases/pending',
      );
      setPurchases(data.purchases);
    } catch {
      // Advisory UI — a failed load just hides the banner; the page's own
      // error handling covers real outages.
      setPurchases([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = purchases.filter((p) => include === 'all' || p.paymentStatus === 'AWAITING');
  // Once a check settles the last purchase, keep the banner up long enough to
  // show the "credits added" note instead of vanishing silently.
  if (visible.length === 0 && !received) return null;
  const p = visible[0];
  const awaiting = p ? p.paymentStatus === 'AWAITING' : false;
  const billingUrl = `https://admin.shopify.com/store/${shopDomain.replace(/\.myshopify\.com$/, '')}/settings/billing`;

  async function checkPayment() {
    if (!p) return;
    setChecking(true);
    setNote(null);
    try {
      // `credits` is displayed; whether they landed is read from paymentStatus
      // — creditsGranted is advisory under hold-until-paid.
      const res = await apiFetch<PurchaseConfirmResponse>(
        `/v1/shopify/billing/purchase/confirm?purchase=${encodeURIComponent(p.id)}`,
      );
      const landed = res.paymentStatus === 'PAID' || res.paymentStatus === 'NOT_REQUIRED';
      setReceived(landed);
      setNote(
        landed
          ? `Payment received — ${res.credits.toLocaleString()} credits added.`
          : "Shopify hasn't collected this payment yet.",
      );
      await load();
    } catch {
      setNote('Could not check right now. Please try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  if (!p) {
    return (
      <Banner tone="success" title="Payment received">
        <Text as="p">{note}</Text>
      </Banner>
    );
  }

  return (
    <Banner
      tone={awaiting ? 'warning' : 'critical'}
      title={awaiting ? 'Payment pending' : 'Payment not received'}
      action={{ content: 'Check payment', onAction: () => void checkPayment(), loading: checking }}
      secondaryAction={{
        content: 'Open Shopify billing',
        onAction: () => navigateTopLevel(billingUrl),
      }}
    >
      <BlockStack gap="100">
        <Text as="p">
          {awaiting
            ? `Your ${p.credits.toLocaleString()} credits (${p.label}) will be added as soon as Shopify collects your payment.`
            : `We haven't received payment for your ${p.label} pack. Pay the outstanding invoice in Shopify billing, then check again.`}
        </Text>
        {note && (
          <Text as="p" tone="subdued">
            {note}
          </Text>
        )}
      </BlockStack>
    </Banner>
  );
}
