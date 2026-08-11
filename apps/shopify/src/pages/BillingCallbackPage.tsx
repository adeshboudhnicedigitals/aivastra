import { Page, Spinner } from '@shopify/polaris';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export default function BillingCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch('/v1/shopify/billing/confirm')
      .catch(() => {
        // Best-effort: even if confirmation fails here, the scheduler in
        // billing-scheduler.ts will pick up the real state on its next tick.
        // Don't strand the merchant on an error page over a transient blip.
      })
      .finally(() => navigate('/', { replace: true }));
  }, [navigate]);

  return (
    <Page>
      <Spinner accessibilityLabel="Confirming your plan" size="large" />
    </Page>
  );
}
