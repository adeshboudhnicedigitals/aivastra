import { DEFAULT_PAYG_SPEND_CAP_USD_CENTS } from '@aivastra/types';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Page,
  SkeletonBodyText,
  SkeletonPage,
  Text,
  TextField,
} from '@shopify/polaris';
import { CheckIcon } from '@shopify/polaris-icons';
import { useEffect, useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import { resolvePlanSelectionUrl } from '../lib/billing';
import {
  PAYG_MIN_SPEND_CAP_USD,
  PAYG_PRICE_PER_TRYON_USD,
  PLAN_FEATURE_SETS,
  SHARED_FEATURE_BULLETS,
} from '../lib/planFeatures';
import type { ShopifyMe } from '../types';

// Set at build time from Partner Dashboard's app handle — see
// .env.production.example for VITE_SHOPIFY_APP_HANDLE.
const APP_HANDLE = import.meta.env.VITE_SHOPIFY_APP_HANDLE ?? '';

function FeatureRow({ label, included }: { label: string; included: boolean }) {
  return (
    <InlineStack gap="200" blockAlign="center" wrap={false}>
      <Box width="20px">
        {included ? (
          <Icon source={CheckIcon} tone="success" />
        ) : (
          <Text as="span" tone="subdued">
            —
          </Text>
        )}
      </Box>
      <Text as="span" tone={included ? undefined : 'subdued'}>
        {label}
      </Text>
    </InlineStack>
  );
}

export default function PricingPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [capInput, setCapInput] = useState('');
  const [capSaving, setCapSaving] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function saveSpendCap() {
    const dollars = Number.parseFloat(capInput);
    if (Number.isNaN(dollars) || dollars < PAYG_MIN_SPEND_CAP_USD) {
      setCapError(`Minimum is $${PAYG_MIN_SPEND_CAP_USD}`);
      return;
    }
    setCapSaving(true);
    setCapError(null);
    try {
      await apiFetch('/v1/shopify/billing/payg-cap', {
        method: 'PATCH',
        body: JSON.stringify({ spendCapUsdCents: Math.round(dollars * 100) }),
      });
      const refreshed = await apiFetch<ShopifyMe>('/v1/shopify/me');
      setMe(refreshed);
    } catch (err) {
      setCapError((err as Error).message);
    } finally {
      setCapSaving(false);
    }
  }

  function choosePlan() {
    if (!me) return;
    const result = resolvePlanSelectionUrl(me.store.shopDomain, APP_HANDLE);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    navigateTopLevel(result.url);
  }

  if (loading) {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText />
      </SkeletonPage>
    );
  }

  return (
    <Page title="Billing" subtitle="Choose the plan that fits your store.">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingSm">
              All plans include
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="200">
              {SHARED_FEATURE_BULLETS.map((label) => (
                <FeatureRow key={label} label={label} included />
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          {PLAN_FEATURE_SETS.map((plan) => {
            const isCurrent = me?.store.planHandle === plan.handle;
            return (
              <Card key={plan.handle}>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingLg">
                        {plan.label}
                      </Text>
                      {plan.bestValue && <Badge tone="success">Best value</Badge>}
                      {isCurrent && <Badge>Current plan</Badge>}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      ${plan.priceUsd}
                      <Text as="span" tone="subdued" variant="bodyMd">
                        {' '}
                        / month
                      </Text>
                    </Text>
                    <Text as="p" tone="subdued">
                      {plan.credits.toLocaleString()} credits ·{' '}
                      {plan.virtualTryOns.toLocaleString()} virtual try-ons
                    </Text>
                  </BlockStack>

                  <Box>
                    {isCurrent ? (
                      <Badge tone="info">Your current plan</Badge>
                    ) : (
                      <Button variant="primary" onClick={choosePlan}>
                        Choose {plan.label}
                      </Button>
                    )}
                  </Box>

                  <BlockStack gap="150">
                    <FeatureRow label={`${plan.analyticsTier} try-on analytics`} included />
                    <FeatureRow label="Custom branding" included={plan.customBranding} />
                    <FeatureRow label="White-label experience" included={plan.whiteLabel} />
                    <FeatureRow label={`${plan.support} support`} included />
                  </BlockStack>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h2" variant="headingLg">
                Pay as you go
              </Text>
              {me?.store.billingMode === 'usage' && <Badge>Your current plan</Badge>}
            </InlineStack>
            <Text as="p" tone="subdued">
              No monthly commitment — ${PAYG_PRICE_PER_TRYON_USD.toFixed(2)} per try-on, billed
              through your Shopify invoice.
            </Text>
            {me?.store.billingMode !== 'usage' && (
              <Box>
                <Button variant="primary" onClick={choosePlan}>
                  Choose Pay as you go
                </Button>
              </Box>
            )}
            {me?.store.billingMode === 'usage' && (
              <BlockStack gap="200">
                <Text as="p">
                  ${((me.paygSpendThisCycleUsdCents ?? 0) / 100).toFixed(2)} spent this cycle of $
                  {(
                    (me.store.paygSpendCapUsdCents ?? DEFAULT_PAYG_SPEND_CAP_USD_CENTS) / 100
                  ).toFixed(2)}{' '}
                  cap
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Monthly spend cap (USD)"
                    type="number"
                    autoComplete="off"
                    value={capInput}
                    onChange={setCapInput}
                    placeholder={(
                      (me.store.paygSpendCapUsdCents ?? DEFAULT_PAYG_SPEND_CAP_USD_CENTS) / 100
                    ).toString()}
                  />
                  <Button onClick={saveSpendCap} disabled={capSaving} loading={capSaving}>
                    Save
                  </Button>
                </InlineStack>
                {capError && (
                  <Text as="p" tone="critical">
                    {capError}
                  </Text>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Text as="p" tone="subdued">
          You'll confirm your plan on Shopify's page next.
        </Text>
      </BlockStack>
    </Page>
  );
}
