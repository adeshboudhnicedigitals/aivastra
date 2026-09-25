import { Page } from '@shopify/polaris';
import type { CSSProperties, ReactNode } from 'react';
import { OnboardingFooter } from './OnboardingFooter';

export const FONT_MONO = "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// The panel is white in every colour scheme, so Polaris's text tokens are pinned
// to their light-mode values here — otherwise dark mode would render pale text
// against the white. The font token is what Polaris's Text and Button read, so
// the mono face reaches them as well as the plain elements.
const panelTokens = {
  '--p-color-text': '#303030',
  '--p-color-text-secondary': '#616161',
  '--p-font-family-sans': FONT_MONO,
} as CSSProperties;

/**
 * The frame shared by every onboarding page: a white, viewport-tall panel in
 * Roboto Mono with the page's content on top and the footer (progress bar +
 * Continue) pinned to the bottom. Content that outgrows the panel scrolls
 * inside it, so the footer never leaves the screen.
 *
 * The 32px offset is Polaris Page's own vertical padding (20px top + 8px
 * bottom) plus a little slack; fullWidth lifts Page's ~998px cap.
 */
export function OnboardingShell({
  progress,
  continueLabel,
  onContinue,
  continueDisabled,
  continueLoading,
  secondaryAction,
  children,
}: {
  progress: number;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  secondaryAction?: { label: string; onAction: () => void };
  children: ReactNode;
}) {
  return (
    <Page fullWidth>
      <div
        style={{
          ...panelTokens,
          fontFamily: FONT_MONO,
          height: 'calc(100vh - 32px)',
          minHeight: 420,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          color: '#303030',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: '1 1 0',
            minHeight: 0,
            overflowY: 'auto',
            boxSizing: 'border-box',
            padding: 'var(--p-space-500)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--p-space-300)',
          }}
        >
          {children}
        </div>
        <OnboardingFooter
          progress={progress}
          continueLabel={continueLabel}
          onContinue={onContinue}
          continueDisabled={continueDisabled}
          continueLoading={continueLoading}
          secondaryAction={secondaryAction}
        />
      </div>
    </Page>
  );
}
