import { Button } from '@shopify/polaris';

/**
 * The bottom strip of every onboarding page: a thin progress bar with a soft
 * shadow above it, then the Continue button. It is a single component so the
 * bar and button stay in the same place as the merchant moves through setup.
 */
export function OnboardingFooter({
  progress,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
}: {
  /** 0–1: how far through getting started the merchant is. */
  progress: number;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** A quieter button placed just before Continue, e.g. "Skip for now". */
  secondaryAction?: { label: string; onAction: () => void };
}) {
  return (
    <div style={{ flexShrink: 0 }}>
      {/* Black fill on a full-width track. The shadow is a 9px gradient layer
          sitting directly above the track — a box-shadow can't be pinned to one
          side or given an exact height. */}
      <div
        role="progressbar"
        aria-label="Getting started progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        style={{ position: 'relative', width: '100%', height: 2, background: '#e3e3e3' }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '100%',
            height: 9,
            pointerEvents: 'none',
            background: 'linear-gradient(to top, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0))',
          }}
        />
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: '#000',
            transition: 'width 300ms ease',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 'var(--p-space-300)',
          padding: 'var(--p-space-400) var(--p-space-500)',
        }}
      >
        {secondaryAction && (
          <div style={{ flex: 'none', minWidth: 140 }}>
            <Button fullWidth onClick={secondaryAction.onAction} disabled={continueLoading}>
              {secondaryAction.label}
            </Button>
          </div>
        )}
        <div style={{ width: '100%', maxWidth: 360 }}>
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
