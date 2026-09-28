import { Page } from '@shopify/polaris';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { type OnboardingPage, previousPagePath } from '../lib/onboarding';
import { OnboardingFooter } from './OnboardingFooter';
import { OnboardingSteps } from './OnboardingSteps';

// Kept around for a page that deliberately wants the mono look (none currently
// do) — Public Sans below is the wizard's actual typeface.
export const FONT_MONO = "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export const FONT_PUBLIC_SANS =
  "'Public Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

// The panel is white in every colour scheme, so Polaris's text tokens are pinned
// to their light-mode values here — otherwise dark mode would render pale text
// against the white. The font token is what Polaris's Text and Button read, so
// the mono face reaches them as well as the plain elements.
const panelTokens = (font: string) =>
  ({
    '--p-color-text': '#303030',
    '--p-color-text-secondary': '#616161',
    '--p-font-family-sans': font,
  }) as CSSProperties;

/**
 * The frame shared by every onboarding page: a white, viewport-tall panel in
 * Public Sans (the welcome page's typeface) with the numbered step row pinned
 * at the top (absent on the welcome intro, which is not a step), the page's
 * content in the middle, and the tall-button footer pinned to the bottom.
 * Content that outgrows the panel scrolls inside it, so neither the steps nor
 * the footer ever leave the screen.
 *
 * The 32px offset is Polaris Page's own vertical padding (20px top + 8px
 * bottom) plus a little slack; fullWidth lifts Page's ~998px cap.
 */
export function OnboardingShell({
  page,
  hideBack = false,
  font = FONT_PUBLIC_SANS,
  tallButtons = true,
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
  /** Typeface of the whole panel, footer included (the welcome page uses Public Sans). */
  font?: string;
  /** Taller footer buttons (the welcome page). */
  tallButtons?: boolean;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  secondaryAction?: { label: string; onAction: () => void };
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const backPath = hideBack ? null : previousPagePath(page);
  return (
    <Page fullWidth>
      <div
        style={{
          ...panelTokens(font),
          fontFamily: font,
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
        {page !== 'intro' && <OnboardingSteps page={page} />}
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
          continueLabel={continueLabel}
          onContinue={onContinue}
          continueDisabled={continueDisabled}
          continueLoading={continueLoading}
          secondaryAction={secondaryAction}
          onBack={backPath ? () => navigate(backPath) : undefined}
          tall={tallButtons}
        />
      </div>
    </Page>
  );
}
