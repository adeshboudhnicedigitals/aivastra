import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import designBg from '../assets/design-bg.jpg';
import { nextStepLabel, type OnboardingPage, previousPagePath } from '../lib/onboarding';
import { BrandHeader } from './BrandHeader';
import { OnboardingFooter } from './OnboardingFooter';
import { OnboardingSteps } from './OnboardingSteps';

export const FONT_APP = "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The frame shared by every onboarding page: the branded header, the pill step
 * row (absent on the welcome intro, which is not a step), then a viewport-tall
 * glass card holding the page's content with the footer pinned to its bottom.
 * Content that outgrows the card scrolls inside it, so neither the steps nor
 * the footer ever leave the screen.
 */
export function OnboardingShell({
  page,
  hideBack = false,
  hideFooter = false,
  continueLabel,
  onContinue,
  continueDisabled,
  continueLoading,
  secondaryAction,
  children,
}: {
  page: OnboardingPage;
  /** Suppress Previous, e.g. when the previous page would just bounce the merchant out of a finished wizard. */
  hideBack?: boolean;
  /** For a page that carries its own call to action (the welcome intro). */
  hideFooter?: boolean;
  /** Defaults to "Continue to <next step>" (plain "Continue" on the last page). */
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  secondaryAction?: { label: string; onAction: () => void };
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const backPath = hideBack ? null : previousPagePath(page);
  const next = nextStepLabel(page);
  return (
    <div
      className="av-page"
      style={{ height: '100vh', minHeight: 520, '--av-bg': `url(${designBg})` } as CSSProperties}
    >
      <BrandHeader />
      <main className="av-main">
        <div className="av-card">
          {page !== 'intro' && <OnboardingSteps page={page} />}
          <div className="av-card-body">{children}</div>
          {!hideFooter && (
            <OnboardingFooter
              continueLabel={continueLabel ?? (next ? `Continue to ${next}` : 'Continue')}
              onContinue={onContinue}
              continueDisabled={continueDisabled}
              continueLoading={continueLoading}
              secondaryAction={secondaryAction}
              onBack={backPath ? () => navigate(backPath) : undefined}
            />
          )}
        </div>
      </main>
    </div>
  );
}
