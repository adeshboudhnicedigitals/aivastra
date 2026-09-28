import { Button } from '@shopify/polaris';

// Polaris Button has no size above "large", so a taller footer button is made
// through its own class.
const TALL_CSS = `
.onboarding-tall-footer .Polaris-Button {
  min-height: 40px;
}
.onboarding-tall-footer .Polaris-Button .Polaris-Text--root,
.onboarding-tall-footer .Polaris-Button__Text {
  font-size: 16px;
}`;

/**
 * The bottom strip of every onboarding page: the Continue button, plus Previous
 * when there is a previous page. Where the merchant is in the wizard is shown
 * by the numbered steps at the top of the panel (OnboardingSteps), not here.
 */
export function OnboardingFooter({
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
  onBack,
  tall = false,
}: {
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** A quieter button placed just before Continue, e.g. "Skip for now". */
  secondaryAction?: { label: string; onAction: () => void };
  /** Goes to the previous wizard page; the button is hidden when omitted. */
  onBack?: () => void;
  /** Taller buttons (40px), for the welcome page. */
  tall?: boolean;
}) {
  return (
    <div
      className={tall ? 'onboarding-tall-footer' : undefined}
      style={{
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'center',
        padding: 'var(--p-space-400) var(--p-space-500)',
        boxShadow: '0 -9px 9px -9px rgba(0, 0, 0, 0.18)',
      }}
    >
      {tall && <style>{TALL_CSS}</style>}
      {/* Every button takes an equal share of one centred row, so Previous and
          Continue line up as a pair; a lone Continue keeps its usual width. */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--p-space-300)',
          width: '100%',
          maxWidth: onBack || secondaryAction ? 640 : 360,
        }}
      >
        {onBack && (
          <div style={{ flex: 1 }}>
            <Button fullWidth onClick={onBack} disabled={continueLoading}>
              Previous
            </Button>
          </div>
        )}
        {secondaryAction && (
          <div style={{ flex: 1 }}>
            <Button fullWidth onClick={secondaryAction.onAction} disabled={continueLoading}>
              {secondaryAction.label}
            </Button>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <Button
            variant="primary"
            fullWidth
            onClick={onContinue}
            disabled={continueDisabled}
            loading={continueLoading}
          >
            {continueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
