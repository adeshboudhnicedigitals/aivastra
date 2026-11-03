import { useNavigate } from 'react-router-dom';
import garmentImage from '../assets/welcome-garment.jpg';
import personImage from '../assets/welcome-person.jpg';
import resultImage from '../assets/welcome-result.jpg';
import { OnboardingShell } from '../components/OnboardingShell';
import { STEP_LABELS, STEP_PAGES } from '../lib/onboarding';

const PHOTOS = [
  { src: garmentImage, alt: 'A product photo from the store', width: 314 },
  { src: personImage, alt: "A customer's own photo", width: 267 },
  { src: resultImage, alt: 'The customer wearing the product', width: 314 },
];

const ARROW = (
  // biome-ignore lint/a11y/noSvgWithoutTitle: decorative
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const INTRO_CSS = `
.av-intro { margin: auto 0; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 8px 8px 16px; }
.av-intro .eyebrow { display: inline-block; padding: 8px 20px; border-radius: 14px; background: #e9e4fb; color: #4b1fd6; font-size: 14px; font-weight: 600; letter-spacing: .07em; }
.av-intro h1 { margin: var(--av-gap) 0 0; font-size: clamp(26px, min(4.4vw, 5.6vh), 50px); line-height: 1.1; font-weight: 800; letter-spacing: -.025em; max-width: 900px; text-wrap: balance; }
.av-intro h1 em { font-style: normal; color: #5a2cf0; }
.av-intro .lead { margin: 10px 0 0; font-size: clamp(15px, min(1.8vw, 2.4vh), 21px); line-height: 1.45; color: #5d5b78; max-width: 700px; }
.av-trio { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 20px; margin-top: var(--av-gap); }
.av-trio img { height: clamp(110px, 24vh, 250px); object-fit: cover; display: block; border-radius: 28px; box-shadow: 0 14px 34px rgba(91,44,230,.1); max-width: 100%; }
.av-trio .res { border: 2px solid #c8b8f8; box-shadow: 0 0 0 7px rgba(139,92,246,.08), 0 14px 34px rgba(91,44,230,.14); }
.av-arr { width: 44px; height: 44px; border-radius: 50%; background: #fff; border: 1px solid #e1ddf0; display: grid; place-items: center; flex-shrink: 0; }
.av-rule { display: flex; align-items: center; gap: 20px; width: 100%; max-width: 900px; margin-top: var(--av-gap); color: #5d5b78; font-size: 16px; }
.av-rule span { flex: 1; height: 1px; background: #d9d6ea; }
.av-rule p { margin: 0; }
.av-mini { display: flex; flex-wrap: wrap; justify-content: center; row-gap: 12px; margin: 12px 0 0; padding: 0; list-style: none; }
.av-mini li { display: flex; align-items: center; gap: 10px; padding: 0 26px; font-size: 16px; font-weight: 600; }
.av-mini li + li { border-left: 1px solid #d9d6ea; }
.av-mini b { width: 36px; height: 36px; border-radius: 50%; background: #e9e4fb; color: #4b1fd6; display: grid; place-items: center; font-size: 16px; font-weight: 700; }
@media (max-width: 760px) { .av-arr { display: none; } .av-trio { gap: 12px; } .av-mini li { padding: 0 12px; } .av-mini li + li { border-left: 0; } }`;

export default function OnboardingIntroPage() {
  const navigate = useNavigate();

  return (
    <OnboardingShell page="intro" hideFooter onContinue={() => navigate('/onboarding/products')}>
      <style>{INTRO_CSS}</style>
      <div className="av-intro">
        <span className="eyebrow">WELCOME TO AI VASTRA</span>
        <h1>
          Bring <em>Virtual Try-On</em> to your store.
        </h1>
        <p className="lead">
          Let shoppers see how your products look on them, directly from your Shopify store.
        </p>
        <div className="av-trio">
          {PHOTOS.map((photo, index) => (
            <div key={photo.src} style={{ display: 'contents' }}>
              {index > 0 && (
                <span className="av-arr" aria-hidden>
                  {ARROW}
                </span>
              )}
              {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
              <img
                className={index === PHOTOS.length - 1 ? 'res' : undefined}
                src={photo.src}
                alt={photo.alt}
                loading="eager"
                decoding="async"
                style={{ aspectRatio: '3 / 4', width: 'auto' }}
              />
            </div>
          ))}
        </div>
        <div className="av-rule">
          <span />
          <p>Complete your setup in {STEP_PAGES.length} simple steps</p>
          <span />
        </div>
        <ol className="av-mini">
          {STEP_PAGES.map((step, index) => (
            <li key={step}>
              <b>{index + 1}</b>
              {STEP_LABELS[step]}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="av-btn-primary"
          style={{
            marginTop: 'var(--av-gap)',
            height: 'clamp(48px, 7vh, 64px)',
            padding: '0 40px',
            fontSize: 18,
          }}
          onClick={() => navigate('/onboarding/products')}
        >
          Start Setup
          {ARROW}
        </button>
      </div>
    </OnboardingShell>
  );
}
