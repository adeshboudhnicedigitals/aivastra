import { BlockStack, Button, Text } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';
import { type Basket, RuleEditorModal } from './RoutingPage';

export default function OnboardingRoutingPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [takenBasketIds, setTakenBasketIds] = useState<Set<string>>(new Set());
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [ruleAdded, setRuleAdded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadError, setLoadError] = useState<ClassifiedError | null>(null);
  const [submitError, setSubmitError] = useState<ClassifiedError | null>(null);

  const loadBaskets = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([
        apiFetch<{ items: Basket[] }>('/v1/shopify/baskets'),
        apiFetch<{ storeRules: { funnelTemplateId: string }[] }>('/v1/shopify/funnel-rules'),
      ]);
      setBaskets(b.items);
      setTakenBasketIds(new Set(r.storeRules.map((rule) => rule.funnelTemplateId)));
      setLoadError(null);
    } catch (err) {
      setLoadError(classifyError(err));
    }
  }, []);

  useEffect(() => {
    loadBaskets();
  }, [loadBaskets]);

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'routing') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  async function handleContinue() {
    setConfirming(true);
    setSubmitError(null);
    try {
      await apiFetch('/v1/shopify/onboarding/confirm-routing', { method: 'POST' });
      await onRefresh();
      navigate('/onboarding/theme');
    } catch (err) {
      setSubmitError(classifyError(err));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <OnboardingLayout
        step={2}
        totalSteps={3}
        title="Route products to the right experience"
        onContinue={handleContinue}
        continueLoading={confirming}
      >
        <BlockStack gap="300">
          <ErrorBanner error={loadError} onRetry={loadBaskets} />
          <ErrorBanner error={submitError} onDismiss={() => setSubmitError(null)} />
          <Text as="p">
            By default, every product routes to AiVastra's standard try-on experience. If you sell
            different kinds of products — sarees, footwear, accessories — you can add a rule now to
            route them differently, or skip this and add rules later from Manage.
          </Text>
          {ruleAdded ? (
            <Text as="p" tone="success">
              Rule added — you can add more later from Manage.
            </Text>
          ) : (
            <Button onClick={() => setShowRuleEditor(true)} disabled={baskets.length === 0}>
              Add a rule
            </Button>
          )}
        </BlockStack>
      </OnboardingLayout>

      {showRuleEditor && (
        <RuleEditorModal
          rule={null}
          baskets={baskets}
          takenBasketIds={takenBasketIds}
          onClose={() => setShowRuleEditor(false)}
          onSaved={() => {
            setRuleAdded(true);
            loadBaskets();
          }}
        />
      )}
    </>
  );
}
