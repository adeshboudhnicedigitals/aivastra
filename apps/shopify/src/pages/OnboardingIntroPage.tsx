import { Navigate, useNavigate } from 'react-router-dom';
import heroImage from '../assets/onboarding-hero.jpg';
import { OnboardingShell } from '../components/OnboardingShell';
import { getOnboardingProgress, getOnboardingStep, onboardingPath } from '../lib/onboarding';
import type { ShopifyMe } from '../types';

export default function OnboardingIntroPage({ me }: { me: ShopifyMe }) {
  const navigate = useNavigate();

  const currentStep = getOnboardingStep(me);
  if (currentStep !== 'intro') {
    return <Navigate to={onboardingPath(currentStep)} replace />;
  }

  return (
    <OnboardingShell
      progress={getOnboardingProgress(me, 'intro')}
      onContinue={() => navigate('/onboarding/products')}
    >
      <div style={{ textAlign: 'center' }}>
        {/* Plain h1 rather than Polaris Text: its largest heading variant tops
            out at 28px, short of the size wanted here. 700 is the heaviest
            weight Roboto Mono ships. */}
        <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.15, fontWeight: 700 }}>
          Welcome to AI Vastra
        </h1>
        <p
          style={{
            margin: 'var(--p-space-100) 0 0',
            fontSize: 18,
            lineHeight: 1.4,
            fontWeight: 500,
            color: 'var(--p-color-text-secondary)',
          }}
        >
          We help merchants increase conversions and go viral with Virtual Try-On
        </p>
      </div>

      {/* One pre-composed landscape (customer photo + product = try-on) so the
          labels and arrows in the artwork can't drift out of alignment with the
          frames the way separately laid-out images would. It takes whatever height
          the text leaves over (flex: 1 + object-fit: contain) so the whole page
          fits without scrolling. */}
      <img
        src={heroImage}
        alt="A shopper's outfit plus your product equals a virtual try-on of that product"
        style={{
          flex: '1 1 0',
          minHeight: 0,
          width: '100%',
          objectFit: 'contain',
          borderRadius: 8,
        }}
      />

      <p
        style={{
          margin: 0,
          fontSize: 20,
          lineHeight: 1.3,
          fontWeight: 600,
          textAlign: 'center',
        }}
      >
        Let&apos;s show your customers how good they look in your brand
      </p>
    </OnboardingShell>
  );
}
