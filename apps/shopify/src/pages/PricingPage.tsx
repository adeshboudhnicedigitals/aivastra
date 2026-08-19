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
import { PACK_DISPLAY, SHARED_FEATURE_BULLETS, tryOnsFromCredits } from '../lib/packs';
import type { ShopifyMe } from '../types';
import { LowCreditsBanner } from './DashboardPage';

export default function PricingPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function buyPack(packId: string) {
    setBuying(packId);
    setError(null);
    try {
      const { confirmationUrl } = await apiFetch<{ purchaseId: string; confirmationUrl: string }>(
        '/v1/shopify/billing/purchase',
        { method: 'POST', body: JSON.stringify({ packId }) },
      );
      // Shopify's approval page is outside the embedded app's origin, so this
      // must be a top-level navigation — an iframe navigation is blocked.
      navigateTopLevel(confirmationUrl);
    } catch (err) {
      setError((err as Error).message);
      setBuying(null);
    }
  }

  if (loading) {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText />
      </SkeletonPage>
    );
  }

  const balance = me?.creditBalance ?? 0;

  return (
    <Page title="Credits" subtitle="Buy credits once. They never expire.">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        {me && <LowCreditsBanner runway={me.runway} />}

        <Card>
          <BlockStack gap="200">
            <Text as="p" tone="subdued">
              Current balance
            </Text>
            <Text as="p" variant="heading2xl">
              {balance.toLocaleString()} credits
            </Text>
            <Text as="p" tone="subdued">
              About {tryOnsFromCredits(balance).toLocaleString()} try-ons remaining
              {me?.runway.daysRemaining != null
                ? ` — roughly ${Math.max(1, Math.round(me.runway.daysRemaining))} days at your current rate`
                : ''}
            </Text>
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          {PACK_DISPLAY.map((pack) => (
            <Card key={pack.id}>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    {pack.label}
                  </Text>
                  {pack.bestValue && <Badge tone="success">Best value</Badge>}
                </InlineStack>

                <Text as="p" variant="heading2xl">
                  ${pack.priceUsd}
                </Text>

                <BlockStack gap="100">
                  <Text as="p">{pack.tryOns.toLocaleString()} try-ons</Text>
                  <Text as="p" tone="subdued">
                    {pack.credits.toLocaleString()} credits · never expire
                  </Text>
                </BlockStack>

                <Button
                  variant="primary"
                  loading={buying === pack.id}
                  disabled={buying !== null}
                  onClick={() => buyPack(pack.id)}
                >
                  Buy credits
                </Button>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Included with every pack
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
              {SHARED_FEATURE_BULLETS.map((label) => (
                <InlineStack key={label} gap="200" blockAlign="center" wrap={false}>
                  <Box width="20px">
                    <Icon source={CheckIcon} tone="success" />
                  </Box>
                  <Text as="span">{label}</Text>
                </InlineStack>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
