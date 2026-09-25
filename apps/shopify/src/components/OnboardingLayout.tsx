import { BlockStack, Card, Text } from '@shopify/polaris';
import type { ReactNode } from 'react';
import { OnboardingShell } from './OnboardingShell';

// No Back button: a merchant navigating to an already-completed step is
// immediately redirected forward again by each onboarding page's own
// getOnboardingStep check (see lib/onboarding.ts) — a Back control here
// would be clickable but never actually land anywhere.
export function OnboardingLayout({
  step,
  totalSteps,
  progress,
  heading,
  title,
  titleAlign = 'start',
  largeTitle = false,
  bare = false,
  fullWidth = false,
  card = true,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
  children,
}: {
  step?: number;
  totalSteps?: number;
  progress: number;
  /** Optional page-level heading above the step header. */
  heading?: string;
  title?: string;
  /** Alignment of `title` (default start). */
  titleAlign?: 'start' | 'center';
  /** A bigger, bolder title, for pages that are just a heading and a form. */
  largeTitle?: boolean;
  /** Render children as-is, for a page that lays out its own step cards. */
  bare?: boolean;
  /** Drop the 1000px content cap so the page uses the whole panel width. */
  fullWidth?: boolean;
  /** Wrap the content in a bordered Polaris Card (default). Off leaves it on the bare panel. */
  card?: boolean;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  /** Shown just before Continue in the footer, e.g. "Skip for now". */
  secondaryAction?: { label: string; onAction: () => void };
  children: ReactNode;
}) {
  return (
    <OnboardingShell
      progress={progress}
      continueLabel={continueLabel}
      onContinue={onContinue}
      continueDisabled={continueDisabled}
      continueLoading={continueLoading}
      secondaryAction={secondaryAction}
    >
      {/* The content column is capped at 1000px and centred, so on a wide window
          the leftover width becomes outer margin instead of stretching the
          product list; the padding keeps it off the panel edge when narrower. */}
      <div
        style={{
          boxSizing: 'border-box',
          maxWidth: fullWidth ? 'none' : 1000,
          width: '100%',
          margin: '0 auto',
          padding: 'var(--p-space-1600) var(--p-space-800)',
        }}
      >
        <BlockStack gap="400">
          {/* Plain h1 for the same reason as the intro page: Polaris Text tops
              out at 28px. The step title below becomes the section heading. */}
          {heading && (
            <h1
              style={{
                margin: 0,
                fontSize: 36,
                lineHeight: 1.15,
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {heading}
            </h1>
          )}
          {bare ? (
            children
          ) : (
            <>
              {step != null && totalSteps != null && (
                <Text as="p" tone="subdued">
                  Step {step} of {totalSteps}
                </Text>
              )}
              <div style={{ textAlign: titleAlign === 'center' ? 'center' : undefined }}>
                {largeTitle ? (
                  // Plain h1: Polaris Text tops out at 28px. 700 is the heaviest weight
                  // Roboto Mono ships.
                  <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2, fontWeight: 700 }}>
                    {title}
                  </h1>
                ) : (
                  <Text as={heading ? 'h2' : 'h1'} variant="headingLg">
                    {title}
                  </Text>
                )}
              </div>
              {card ? (
                <Card>
                  <BlockStack gap="400">{children}</BlockStack>
                </Card>
              ) : (
                <BlockStack gap="400">{children}</BlockStack>
              )}
            </>
          )}
        </BlockStack>
      </div>
    </OnboardingShell>
  );
}
