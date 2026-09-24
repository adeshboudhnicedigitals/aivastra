import { BlockStack, Button, InlineStack, Page, Text } from '@shopify/polaris';
import { Navigate, useNavigate } from 'react-router-dom';
import garmentPhoto from '../assets/sample-garment.jpg';
import personPhoto from '../assets/sample-photo.jpg';
import resultPhoto from '../assets/sample-result.jpg';
import { getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

function EquationImage({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={140}
      height={140}
      style={{
        width: 140,
        height: 140,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--p-color-border)',
        display: 'block',
      }}
    />
  );
}

export default function OnboardingIntroPage({ me }: { me: ShopifyMe }) {
  const navigate = useNavigate();

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'intro') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  return (
    <Page>
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingLg" alignment="center">
            See how AiVastra works
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            Shoppers upload their photo, pick a garment, and see themselves wearing it instantly.
          </Text>
        </BlockStack>

        <InlineStack gap="400" blockAlign="center" align="center">
          <EquationImage src={personPhoto} alt="Shopper photo" />
          <Text as="span" variant="headingLg">
            +
          </Text>
          <EquationImage src={garmentPhoto} alt="Garment" />
          <Text as="span" variant="headingLg">
            =
          </Text>
          <EquationImage src={resultPhoto} alt="Try-on result" />
        </InlineStack>

        <InlineStack align="center">
          <Button variant="primary" size="large" onClick={() => navigate('/onboarding/products')}>
            Continue
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
