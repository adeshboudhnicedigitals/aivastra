const ARROW_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const SPIN_CSS = `
@keyframes av-spin { to { transform: rotate(360deg); } }
.av-spin { width: 20px; height: 20px; border-radius: 50%; border: 3px solid rgba(255,255,255,.4); border-top-color: #fff; animation: av-spin .8s linear infinite; }
@media (prefers-reduced-motion: reduce) { .av-spin { animation-duration: 2.4s; } }`;

/**
 * The bottom strip of every onboarding card: Previous, an optional quieter
 * action (e.g. "Skip for now"), and Continue. Where the merchant is in the
 * wizard is shown by the step row at the top (OnboardingSteps), not here.
 */
export function OnboardingFooter({
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
  onBack,
}: {
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** A quieter button placed just before Continue, e.g. "Skip for now". */
  secondaryAction?: { label: string; onAction: () => void };
  /** Goes to the previous wizard page; the button is hidden when omitted. */
  onBack?: () => void;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
        padding: '12px 24px',
        boxShadow: '0 -9px 9px -9px rgba(0, 0, 0, 0.12)',
      }}
    >
      <style>{SPIN_CSS}</style>
      {onBack && (
        <button type="button" className="av-btn-ghost" onClick={onBack} disabled={continueLoading}>
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button text names it */}
          <svg {...ARROW_PROPS}>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Previous
        </button>
      )}
      {secondaryAction && (
        <button
          type="button"
          onClick={secondaryAction.onAction}
          disabled={continueLoading}
          style={{
            background: 'none',
            border: 0,
            padding: '12px 8px',
            font: "600 17px 'Inter', system-ui, sans-serif",
            color: '#4a4864',
            cursor: 'pointer',
          }}
        >
          {secondaryAction.label}
        </button>
      )}
      <button
        type="button"
        className="av-btn-primary"
        onClick={onContinue}
        disabled={continueDisabled || continueLoading}
        aria-busy={continueLoading || undefined}
      >
        {continueLoading ? <span className="av-spin" aria-hidden /> : null}
        {continueLabel}
        {!continueLoading && (
          // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the button text names it
          <svg {...ARROW_PROPS}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        )}
      </button>
    </div>
  );
}
