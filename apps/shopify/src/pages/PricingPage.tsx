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
} from '@shopify/polaris';
import { CheckIcon } from '@shopify/polaris-icons';
import { useEffect, useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import { resolvePlanSelectionUrl } from '../lib/billing';
import { PLAN_FEATURE_SETS, SHARED_FEATURE_BULLETS } from '../lib/planFeatures';
import type { ShopifyMe } from '../types';

// Set at build time from Partner Dashboard's app handle — see
// .env.production.example for VITE_SHOPIFY_APP_HANDLE.
const APP_HANDLE = import.meta.env.VITE_SHOPIFY_APP_HANDLE ?? '';

function FeatureRow({ label, included }: { label: string; included: boolean }) {
  return (
    <InlineStack gap="200" blockAlign="center">
      {included ? (
        <Icon source={CheckIcon} tone="success" />
      ) : (
        <Text as="span" tone="subdued">
          —
        </Text>
      )}
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

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

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
    <Page title="Plans & pricing" subtitle="Choose the plan that fits your store.">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

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
                    {SHARED_FEATURE_BULLETS.map((label) => (
                      <FeatureRow key={label} label={label} included />
                    ))}
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

        <Text as="p" tone="subdued">
          You'll confirm your plan on Shopify's page next.
        </Text>
      </BlockStack>
    </Page>
  );
}
