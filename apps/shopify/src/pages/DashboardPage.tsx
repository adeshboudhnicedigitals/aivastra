import { Banner, Card, Layout, Page, SkeletonBodyText, Text } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import type { ShopifyMe } from '../types';

export default function DashboardPage() {
  const [me, setMe] = useState<ShopifyMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ShopifyMe>('/v1/shopify/me')
      .then(setMe)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Page title="AiVastra Try-On">
      <Layout>
        <Layout.Section>
          {error && (
            <Banner tone="critical" title="Failed to load account status">
              {error}
            </Banner>
          )}
          <Card>
            {loading ? (
              <SkeletonBodyText lines={3} />
            ) : (
              <>
                <Text as="h2" variant="headingMd">
                  {me?.store.shopDomain}
                </Text>
                <Text as="p">Credit balance: {me?.credits ?? 0}</Text>
                <Link to="/billing">Manage billing</Link>
              </>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
