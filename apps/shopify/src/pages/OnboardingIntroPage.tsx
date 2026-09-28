import { Icon, Text } from '@shopify/polaris';
import { CartIcon, PlusIcon } from '@shopify/polaris-icons';
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import garmentImage from '../assets/welcome-garment.jpg';
import logoMark from '../assets/welcome-logo-mark.svg';
import logoText from '../assets/welcome-logo-text.svg';
import personImage from '../assets/welcome-person.jpg';
import resultImage from '../assets/welcome-result.jpg';
import { OnboardingShell } from '../components/OnboardingShell';

// The panel is white in every colour scheme (see OnboardingShell), so these are
// fixed light greys rather than Polaris surface tokens that would darken.
const GREY_FILL = '#f1f1f1';
const LINE = '#dcdcdc';

// The photo is 6:7 (a little wider than the portrait originals, which are cropped
// from the bottom). Its height follows the viewport (595px is roughly everything on
// the page that is not the photo), so the page fits without scrolling on most
// laptops; card width is derived from that height, capped for narrow windows. The
// connectors reuse PHOTO_H to sit mid-photo.
const CARD_W = 'clamp(170px, min(calc((100vh - 595px) * 6 / 7), 23vw), 340px)';
const PHOTO_H = `calc(${CARD_W} * 7 / 6)`;

// Lucide icons (ISC licence, https://lucide.dev) drawn inline, so the page does not
// take on the whole icon package for three shapes. Same 24px grid and 2px round
// stroke as Lucide's own components.
function LucideGlyph({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the card's own text names it
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const UserRoundGlyph = (
  <LucideGlyph>
    <circle cx="12" cy="8" r="5" />
    <path d="M20 21a8 8 0 0 0-16 0" />
  </LucideGlyph>
);

const ShirtGlyph = (
  <LucideGlyph>
    <path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
  </LucideGlyph>
);

const WandSparklesGlyph = (
  <LucideGlyph>
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
    <path d="m14 7 3 3" />
    <path d="M5 6v4" />
    <path d="M19 14v4" />
    <path d="M10 2v2" />
    <path d="M7 8H3" />
    <path d="M21 16h-4" />
    <path d="M11 3H9" />
  </LucideGlyph>
);

// Three bars rising left to right; unlike Polaris's bar chart icon, whose bars
// are uneven, this one reads as "growth".
const ChartIncreasingGlyph = (
  <LucideGlyph size={20}>
    <path d="M5 21v-6" />
    <path d="M12 21V9" />
    <path d="M19 21V3" />
  </LucideGlyph>
);

const UsersRoundGlyph = (
  <LucideGlyph size={20}>
    <path d="M18 21a8 8 0 0 0-16 0" />
    <circle cx="10" cy="8" r="5" />
    <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
  </LucideGlyph>
);

const CARDS = [
  {
    image: personImage,
    // Actual file dimensions of the 1080px-wide source — only used as the
    // intrinsic-size hint on <img>; the visible size is set by CARD_W/PHOTO_H
    // via style, not by these.
    width: 1080,
    height: 1440,
    alt: "A customer's own photo",
    icon: UserRoundGlyph,
    title: 'Customer Photo',
    caption: "Your customer's image",
  },
  {
    image: garmentImage,
    width: 1080,
    height: 1438,
    alt: 'A product photo from the store',
    icon: ShirtGlyph,
    title: 'Your Product Image',
    caption: 'From your store',
  },
  {
    image: resultImage,
    width: 1080,
    height: 1440,
    alt: 'The customer wearing the product',
    icon: WandSparklesGlyph,
    title: 'Virtual Try-On',
    caption: 'Realistic results in seconds',
  },
];

const BENEFITS = [
  { icon: ChartIncreasingGlyph, text: 'Increase conversions' },
  { icon: <Icon source={CartIcon} />, text: 'Reduce returns' },
  { icon: UsersRoundGlyph, text: 'Build customer confidence' },
];

function IconCircle({ children, size }: { children: ReactNode; size: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    borderRadius: '50%',
    background: GREY_FILL,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  return <div style={style}>{children}</div>;
}

/** "+" or "=" between two cards, on a thin line that runs into both. */
function Connector({ symbol }: { symbol: '+' | '=' }) {
  return (
    <div
      aria-hidden
      style={{
        flex: '0 1 auto',
        // Cards stretch to one height, so the connector pins itself to the photo row.
        alignSelf: 'flex-start',
        width: 'clamp(40px, 6vw, 88px)',
        height: PHOTO_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(${LINE}, ${LINE}) center / 100% 1px no-repeat`,
        // The card's own 6px padding sits above its photo; matching it centres the line on the photo.
        marginTop: 6,
      }}
    >
      <IconCircle size={44}>
        {symbol === '+' ? (
          <Icon source={PlusIcon} />
        ) : (
          // Polaris has no equals icon; two bars read the same and stay crisp.
          <div style={{ display: 'grid', gap: 5 }}>
            {/* Integer height, not 2.5 — a fractional px rounds to a different
                device pixel per bar (one 2px, one 3px) depending on DPR/zoom,
                which is what made the bottom bar read thicker than the top. */}
            <div style={{ width: 16, height: 2, borderRadius: 2, background: '#303030' }} />
            <div style={{ width: 16, height: 2, borderRadius: 2, background: '#303030' }} />
          </div>
        )}
      </IconCircle>
    </div>
  );
}

export default function OnboardingIntroPage() {
  const navigate = useNavigate();

  return (
    <OnboardingShell page="intro" onContinue={() => navigate('/onboarding/products')}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--p-space-500)',
          margin: 'auto 0',
          padding: 'var(--p-space-200) var(--p-space-400)',
        }}
      >
        {/* The brand mark and wordmark ship as two files (same as the web app), shown in their original colour. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
          <img src={logoMark} alt="" style={{ height: 40, width: 'auto' }} />
          {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
          <img src={logoText} alt="AI Vastra" style={{ height: 44, width: 'auto' }} />
        </div>

        <div style={{ textAlign: 'center', maxWidth: 820 }}>
          {/* Plain h1: Polaris Text tops out at 28px. */}
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(30px, min(5.4vh, 4.6vw), 58px)',
              lineHeight: 1.12,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              // Balances the two lines instead of leaving "products." on its own.
              textWrap: 'balance',
            }}
          >
            Let your customers see themselves in your products.
          </h1>
          <p
            style={{
              margin: 'var(--p-space-300) 0 0',
              fontSize: 'clamp(14px, 2vh, 18px)',
              lineHeight: 1.45,
              textWrap: 'balance',
              color: 'var(--p-color-text-secondary)',
            }}
          >
            Turn customer photos and your product images into realistic virtual try-ons and help
            increase conversions.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}>
          {CARDS.map((card, index) => (
            <Fragment key={card.title}>
              {index > 0 && <Connector symbol={index === 1 ? '+' : '='} />}
              <div
                style={{
                  width: CARD_W,
                  flex: 'none',
                  boxSizing: 'content-box',
                  padding: 6,
                  marginBottom: 16,
                  borderRadius: 22,
                  background: '#fff',
                  border: '1px solid #eee',
                  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.09)',
                }}
              >
                {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
                <img
                  src={card.image}
                  alt={card.alt}
                  width={card.width}
                  height={card.height}
                  loading="eager"
                  decoding="async"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: PHOTO_H,
                    objectFit: 'cover',
                    // Crop from the bottom: the face is what the eye needs.
                    objectPosition: 'center top',
                    borderRadius: 16,
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--p-space-300)',
                    padding: 'var(--p-space-300) var(--p-space-200) var(--p-space-200)',
                  }}
                >
                  <IconCircle size={44}>{card.icon}</IconCircle>
                  <div style={{ minWidth: 0 }}>
                    <Text as="p" fontWeight="bold">
                      {card.title}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {card.caption}
                    </Text>
                  </div>
                </div>
              </div>
            </Fragment>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            rowGap: 'var(--p-space-300)',
          }}
        >
          {BENEFITS.map((benefit, index) => (
            <div
              key={benefit.text}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--p-space-300)',
                padding: '0 var(--p-space-1000)',
                borderLeft: index > 0 ? `1px solid ${LINE}` : undefined,
              }}
            >
              <IconCircle size={40}>{benefit.icon}</IconCircle>
              <Text as="span">{benefit.text}</Text>
            </div>
          ))}
        </div>
      </div>
    </OnboardingShell>
  );
}
