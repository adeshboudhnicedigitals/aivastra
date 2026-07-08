import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Layout,
  Page,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { ShopifyPlan } from '../types';

export default function BillingPage() {
  const [plans, setPlans] = useState<ShopifyPlan[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ plans: ShopifyPlan[]; currentPlanId: string | null }>('/v1/shopify/billing/plans')
      .then((data) => {
        setPlans(data.plans);
        setCurrentPlanId(data.currentPlanId);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function selectPlan(planId: string) {
    setSelecting(planId);
    setError(null);
    try {
      const { confirmationUrl } = await apiFetch<{ confirmationUrl: string }>(
        '/v1/shopify/billing/select',
        { method: 'POST', body: JSON.stringify({ planId }) },
      );
      if (window.shopify && window.top) {
        // Shopify billing confirmation can't render inside the embedded iframe —
        // navigate the top-level window, not this app's own location.
        window.top.location.href = confirmationUrl;
      } else {
        window.location.href = confirmationUrl;
      }
    } catch (err) {
      setError((err as Error).message);
      setSelecting(null);
    }
  }

  return (
    <Page title="Billing">
      <Layout>
        <Layout.Section>
          {error && (
            <Banner tone="critical" title="Failed to update plan">
              {error}
            </Banner>
          )}
          {loading ? (
            <Card>
              <SkeletonBodyText lines={4} />
            </Card>
          ) : (
            <BlockStack gap="400">
              {plans.map((plan) => (
                <Card key={plan.id}>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {plan.name}{' '}
                      {plan.id === currentPlanId && <Badge tone="success">Current</Badge>}
                    </Text>
                    <Text as="p">
                      ${(plan.priceCents / 100).toFixed(2)}/month — {plan.includedTryons} try-ons
                      included
                    </Text>
                    <Button
                      onClick={() => selectPlan(plan.id)}
                      loading={selecting === plan.id}
                      disabled={plan.id === currentPlanId}
                    >
                      {plan.id === currentPlanId ? 'Current plan' : 'Select'}
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
