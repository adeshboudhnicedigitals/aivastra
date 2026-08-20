import { Banner, Page, Spinner } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export default function AutorefillCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/v1/shopify/billing/autorefill/confirm')
      .then(() => navigate('/pricing', { replace: true }))
      .catch((err) => setError((err as Error).message));
  }, [navigate]);

  if (error) {
    return (
      <Page>
        <Banner
          title="We couldn't confirm auto-refill"
          tone="critical"
          action={{ content: 'Back to credits', onAction: () => navigate('/pricing') }}
        >
          {error}
        </Banner>
      </Page>
    );
  }
  return (
    <Page>
      <Spinner accessibilityLabel="Confirming auto-refill" size="large" />
    </Page>
  );
}
