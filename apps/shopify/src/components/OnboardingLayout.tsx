import { BlockStack, Button, Card, InlineStack, Page, Text } from '@shopify/polaris';
import type { ReactNode } from 'react';

// No Back button: a merchant navigating to an already-completed step is
// immediately redirected forward again by each onboarding page's own
// getOnboardingStep check (see lib/onboarding.ts) — a Back control here
// would be clickable but never actually land anywhere.
export function OnboardingLayout({
  step,
  totalSteps,
  title,
  continueLabel = 'Continue',
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  children,
}: {
  step: number;
  totalSteps: number;
  title: string;
  continueLabel?: string;
  onContinue: () => void;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  children: ReactNode;
}) {
  return (
    <Page>
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Step {step} of {totalSteps}
        </Text>
        <Text as="h1" variant="headingLg">
          {title}
        </Text>
        <Card>
          <BlockStack gap="400">{children}</BlockStack>
        </Card>
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={onContinue}
            disabled={continueDisabled}
            loading={continueLoading}
          >
            {continueLabel}
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
