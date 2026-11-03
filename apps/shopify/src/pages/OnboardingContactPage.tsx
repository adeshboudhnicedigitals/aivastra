import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ErrorBanner } from '../components/ErrorBanner';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { Glyph, Note, PageHead } from '../components/PageHead';
import { apiFetch } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { canShowPostProductsPage, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import { isValidPhone, PHONE_ERROR } from '../lib/phone';
import type { ShopifyMe } from '../types';

// Same shape the API accepts (phone: lib/phone.ts mirrors packages/types/src/phone.ts),
// so a value the form lets through is not bounced by the server for a reason the
// merchant can't see.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Onboarding's contact step: who to reach if something urgent comes up. Name,
 * email and phone are required and prefilled from what Shopify gave us at
 * install. There is no skip — Continue is disabled until the required fields are
 * valid. The step is not part of the derived onboarding step (lib/onboarding.ts),
 * so a reload of a later page never sends the merchant back to it.
 */
export default function OnboardingContactPage({
  me,
  onRefresh,
}: {
  me: ShopifyMe;
  onRefresh: () => Promise<ShopifyMe>;
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
  if (!canShowPostProductsPage(currentStep)) {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  const nameError = name.trim() === '' ? 'Enter your name' : undefined;
  const emailError = !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : undefined;
  const phoneError = !isValidPhone(phone) ? PHONE_ERROR : undefined;
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

  const fields = [
    {
      id: 'fullName',
      key: 'name',
      label: 'Full Name',
      type: 'text',
      autoComplete: 'name',
      placeholder: 'Enter your full name',
      value: name,
      set: setName,
      err: nameError,
    },
    {
      id: 'email',
      key: 'email',
      label: 'Business Email',
      type: 'email',
      autoComplete: 'email',
      placeholder: 'Enter your business email',
      value: email,
      set: setEmail,
      err: emailError,
    },
    {
      id: 'phone',
      key: 'phone',
      label: 'Phone Number',
      type: 'tel',
      autoComplete: 'tel',
      placeholder: 'Enter phone number',
      value: phone,
      set: setPhone,
      err: phoneError,
    },
  ] as const;

  return (
    <OnboardingLayout
      bare
      page="contact"
      fullWidth
      padding="var(--p-space-400)"
      onContinue={saveAndContinue}
      continueDisabled={!valid}
      continueLoading={saving}
    >
      <form
        className="av-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void saveAndContinue();
        }}
      >
        <PageHead
          icon={
            <Glyph size={44}>
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 21c0-4 3.4-7 7.5-7s7.5 3 7.5 7" />
            </Glyph>
          }
          title="Contact Details"
          subtitle="Tell us how we can reach you for account and service updates."
        />
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {fields.map((f) => {
          const showErr = touched[f.key] ? f.err : undefined;
          return (
            <div key={f.id}>
              <label className="av-lab" htmlFor={f.id}>
                {f.label} <i>*</i>
              </label>
              <input
                className="av-field"
                id={f.id}
                name={f.id}
                type={f.type}
                autoComplete={f.autoComplete}
                placeholder={f.placeholder}
                value={f.value}
                required
                aria-invalid={showErr ? true : undefined}
                aria-describedby={showErr ? `${f.id}-err` : undefined}
                onChange={(e) => f.set(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, [f.key]: true }))}
              />
              {showErr && (
                <p className="av-err" id={`${f.id}-err`}>
                  {showErr}
                </p>
              )}
            </div>
          );
        })}
        <Note>Your contact details are used for account and service-related communication.</Note>
      </form>
    </OnboardingLayout>
  );
}
