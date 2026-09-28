import { BlockStack, Card, Text } from '@shopify/polaris';
import type { ReactNode } from 'react';
import type { OnboardingPage } from '../lib/onboarding';
import { OnboardingShell } from './OnboardingShell';

// Back is derived from the page's position in the wizard (OnboardingShell). Each
// page's own guard decides whether the earlier page may render; the App gate
// bounces a finished wizard to the dashboard, hence hideBack on the last page.
export function OnboardingLayout({
  page,
  hideBack,
  heading,
  title,
  titleAlign = 'start',
  largeTitle = false,
  bare = false,
  fullWidth = false,
  padding = 'var(--p-space-1600) var(--p-space-800)',
  card = true,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
  children,
}: {
  page: OnboardingPage;
  hideBack?: boolean;
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
  /** CSS padding of the content column, for a page that wants tighter top or wider sides. */
  padding?: string;
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
      page={page}
      hideBack={hideBack}
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
          padding,
        }}
      >
        <BlockStack gap="400">
          {/* Plain h1 for the same reason as the intro page: Polaris Text tops
              out at 28px. The step title below becomes the section heading. */}
          {heading && (
            <h1
              style={{
                margin: 0,
                marginBottom: 8,
                // Smaller than the other onboarding titles' fixed 36px — the
                // only caller (products page) passes a much longer sentence,
                // and 36px wrapped it awkwardly.
                fontSize: 30,
                lineHeight: 1.25,
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
              <div style={{ textAlign: titleAlign === 'center' ? 'center' : undefined }}>
                {largeTitle ? (
                  // Plain h1: Polaris Text tops out at 28px. 700 is a bold, heavy weight
                  // for the wizard's Public Sans.
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
