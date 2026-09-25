import { BlockStack, TextField } from '@shopify/polaris';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import {
  canShowPostBasketPage,
  getOnboardingProgress,
  getOnboardingStep,
  onboardingPath,
} from '../lib/onboarding';
import type { ShopifyMe } from '../types';

// Same shape the API accepts, so an address the form lets through is not
// bounced by the server for a reason the merchant can't see.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]*$/;

/**
 * Onboarding's contact step: who to reach if something urgent comes up. Name and
 * email are required and prefilled from what Shopify gave us at install; phone is
 * optional. There is no skip — Continue is disabled until the required fields are
 * valid. The step is not part of the derived onboarding step (lib/onboarding.ts),
 * so a reload of a later page never sends the merchant back to it.
 */
export default function OnboardingContactPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(me.store.shopOwnerName ?? '');
  const [email, setEmail] = useState(me.store.shopEmail ?? '');
  const [phone, setPhone] = useState(me.store.shopPhone ?? '');
  const [saving, setSaving] = useState(false);
  // Field errors only show after the merchant has touched a field or tried to
  // continue, so a prefilled page doesn't open covered in red.
  const [touched, setTouched] = useState({ name: false, email: false, phone: false });
  const [error, setError] = useState<ClassifiedError | null>(null);

  const currentStep = getOnboardingStep(me);
  if (!canShowPostBasketPage(currentStep)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const nameError = name.trim() === '' ? 'Enter your name' : undefined;
  const emailError = !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : undefined;
  const phoneError = !PHONE_RE.test(phone) ? 'Use digits, spaces and + ( ) - . only' : undefined;
  const valid = !nameError && !emailError && !phoneError;

  const unchanged =
    name.trim() === (me.store.shopOwnerName ?? '') &&
    email.trim() === (me.store.shopEmail ?? '') &&
    phone.trim() === (me.store.shopPhone ?? '');

  async function saveAndContinue() {
    setTouched({ name: true, email: true, phone: true });
    if (!valid || saving) return;
    // Nothing to write when the merchant just confirmed the prefilled details.
    if (unchanged) {
      navigate('/onboarding/limits');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/v1/shopify/onboarding/contact', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      });
      await onRefresh();
      navigate('/onboarding/limits');
    } catch (err) {
      setError(classifyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingLayout
      progress={getOnboardingProgress(me, 'contact')}
      title="Emergency contact details"
      titleAlign="center"
      largeTitle
      onContinue={saveAndContinue}
      continueDisabled={!valid}
      continueLoading={saving}
      card={false}
    >
      <BlockStack gap="400">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {/* Blank space where the explanatory sentence used to sit. */}
        <div style={{ width: '100%', maxWidth: 480, margin: 'var(--p-space-800) auto 0' }}>
          <BlockStack gap="300">
            <TextField
              label="Your name"
              requiredIndicator
              autoComplete="name"
              value={name}
              onChange={setName}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              error={touched.name ? nameError : undefined}
            />
            <TextField
              label="Your email address"
              requiredIndicator
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              error={touched.email ? emailError : undefined}
            />
            <TextField
              label="Phone number"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={setPhone}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              error={touched.phone ? phoneError : undefined}
            />
          </BlockStack>
        </div>
      </BlockStack>
    </OnboardingLayout>
  );
}
