'use client';
import { useState } from 'react';

// ─── template content ─────────────────────────────────────────────────────────
// Hardcoded for v1. Future: accept user-supplied product metadata.

const TC = {
  store: 'FURBO',
  title: 'Women Solid Puff Sleeve Peplum Top - Stylish Ruched Square Neck Casual Top for Women',
  rating: 3.9,
  ratingCount: 44,
  price: '999',
  mrp: '1,999',
  discount: '50%',
  sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  defaultSize: 'M',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

// Convert pipeline ratio string ("3:4") → CSS aspect-ratio ("3 / 4").
export function aspectToCss(ratio: string | null | undefined): string {
  if (!ratio) return '1 / 1';
  const [w, h] = ratio.split(':');
  return w && h ? `${w} / ${h}` : '1 / 1';
}

interface TemplateProps {
  images: Array<string | undefined>;
  activeIndex: number;
  onActiveChange: (i: number) => void;
  ratio: string;
}

// ─── product image ─────────────────────────────────────────────────────────────
// Reserves space via aspect-ratio (no CLS). Warm #f7f7f7 background mirrors
// marketplace image zones. Shimmer skeleton fades to image on load.

function ProductImage({ src, ratio }: { src?: string; ratio: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: ratio,
        background: '#f7f7f7',
        overflow: 'hidden',
      }}
    >
      {(!src || !loaded) && (
        <div className="av-shimmer" style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        // biome-ignore lint/performance/noImgElement: generated catalogue preview image
        <img
          src={src}
          alt="Generated catalogue preview"
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            objectPosition: 'center',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 240ms ease',
          }}
        />
      )}
    </div>
  );
}

// ─── star rating ──────────────────────────────────────────────────────────────

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const pct = (rating / 5) * 100;
  return (
    <span
      role="img"
      aria-label={`${rating} out of 5 stars`}
      style={{ position: 'relative', display: 'inline-block', fontSize: size, lineHeight: 1 }}
    >
      <span style={{ color: '#d5d9d9', letterSpacing: 1 }}>★★★★★</span>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${pct}%`,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          color: '#de7921',
          letterSpacing: 1,
        }}
      >
        ★★★★★
      </span>
    </span>
  );
}

// ─── offer / coupon block ──────────────────────────────────────────────────────
// The single highest-recognition Amazon fidelity signal.

function OfferBlock({ compact = false }: { compact?: boolean }) {
  const offers = [
    {
      label: 'Bank Offer',
      text: compact
        ? 'Upto ₹3,000 off on HDFC Credit Cards'
        : 'Upto ₹3,000 instant discount on HDFC Bank Credit/Debit Cards',
      count: '3 offers',
    },
    {
      label: 'No Cost EMI',
      text: compact ? 'from ₹167/month' : 'No Cost EMI available on select cards from ₹167/month',
      count: '2 offers',
    },
    {
      label: 'Cashback',
      text: compact ? 'Get ₹10 on Amazon Pay' : 'Get ₹10 cashback when you pay via Amazon Pay',
      count: '1 offer',
    },
  ];
  return (
    <div
      style={{
        border: '1px solid #e4e4e4',
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: compact ? 10 : 14,
      }}
    >
      <div
        style={{
          background: '#f4f6f8',
          padding: compact ? '5px 10px' : '6px 12px',
          borderBottom: '1px solid #e4e4e4',
          fontSize: 11,
          fontWeight: 700,
          color: '#0f1111',
        }}
      >
        Applicable Offers
      </div>
      {offers.map((o, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static offer list — index is stable
          key={i}
          style={{
            padding: compact ? '7px 10px' : '8px 12px',
            borderBottom: i < offers.length - 1 ? '1px solid #f0f0f0' : 'none',
            fontSize: 11,
            lineHeight: 1.4,
            display: 'flex',
            gap: 6,
          }}
        >
          <b style={{ color: '#cc0c39', flexShrink: 0 }}>{o.label}</b>
          <span style={{ color: '#565959' }}>
            {o.text}
            {!compact && <span style={{ color: '#007185', marginLeft: 4 }}>· {o.count}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── decorative glyphs (marketplace chrome, all aria-hidden) ─────────────────

const gp = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const MenuG = ({ color = '#fff' }: { color?: string }) => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden set via {...gp} spread above
  <svg width="20" height="20" viewBox="0 0 24 24" style={{ color }} {...gp}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
const CartG = ({ color = '#fff', size = 22 }: { color?: string; size?: number }) => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden set via {...gp} spread above
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} {...gp}>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);
const SearchG = ({ color = '#0f1111' }: { color?: string }) => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden set via {...gp} spread above
  <svg width="18" height="18" viewBox="0 0 24 24" style={{ color }} {...gp}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.34-4.34" />
  </svg>
);
const LockG = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: aria-hidden set via {...gp} spread above
  <svg width="11" height="11" viewBox="0 0 24 24" style={{ color: '#5f6368' }} {...gp}>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// ─── device shells ─────────────────────────────────────────────────────────────

// Generic premium Android phone — no OEM branding, no status bar clutter.
// Punch-hole camera + slim bezels is recognisable as modern flagship without trademark.
export function PhoneShell({
  children,
  scrollRef,
}: {
  children: React.ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      style={{
        width: 360,
        maxWidth: '100%',
        background: '#0d0d0f',
        borderRadius: 46,
        padding: 12,
        boxShadow: '0 30px 60px rgba(0,0,0,0.28), 0 8px 20px rgba(0,0,0,0.14)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 22,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: '#000',
          border: '1.5px solid #23232a',
          zIndex: 3,
        }}
      />
      <div
        ref={scrollRef}
        className="preview-phone-scroll"
        style={{
          height: 720,
          maxHeight: '72vh',
          background: '#fff',
          borderRadius: 36,
          position: 'relative',
          paddingRight: 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Generic browser window — domain-only URL, no Apple hardware.
export function BrowserShell({
  children,
  scrollRef,
}: {
  children: React.ReactNode;
  scrollRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      style={{
        width: 1020,
        maxWidth: '100%',
        background: '#fff',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid #ddd',
        boxShadow: '0 30px 70px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.07)',
      }}
    >
      {/* chrome bar */}
      <div
        style={{
          height: 34,
          background: '#f1f1f2',
          borderBottom: '1px solid #dadada',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 5 }} aria-hidden="true">
          {['#ff5f57', '#febc2e', '#28c840'].map((bg) => (
            <span
              key={bg}
              style={{
                width: 11,
                height: 11,
                borderRadius: '50%',
                background: bg,
                display: 'block',
              }}
            />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            maxWidth: 460,
            margin: '0 auto',
            height: 22,
            background: '#fff',
            borderRadius: 11,
            border: '1px solid #dadada',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px',
            fontSize: 11.5,
            color: '#5f6368',
          }}
        >
          <LockG />
          amazon.in
        </div>
        <div style={{ width: 40 }} aria-hidden="true" />
      </div>
      <div
        ref={scrollRef}
        style={{ height: 640, maxHeight: '68vh', overflow: 'auto', background: '#fff' }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Amazon mobile template ───────────────────────────────────────────────────

export function AmazonMobileTemplate({
  images,
  activeIndex,
  onActiveChange,
  ratio,
}: TemplateProps) {
  const [size, setSize] = useState(TC.defaultSize);
  const active = images[activeIndex];

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, color: '#0f1111' }}>
      {/* header — slim */}
      <div
        style={{
          background: '#131921',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MenuG />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
          amazon<span style={{ color: '#ff9900' }}>.in</span>
        </span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#fff',
          }}
        >
          <span style={{ fontSize: 11 }}>Sign in ›</span>
          <CartG size={19} />
        </div>
      </div>

      {/* search */}
      <div style={{ background: '#232f3e', padding: '6px 8px', display: 'flex' }}>
        <div
          style={{
            flex: 1,
            background: '#fff',
            borderRadius: '4px 0 0 4px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 10px',
            fontSize: 12,
            color: '#888',
            height: 30,
          }}
        >
          Search Amazon.in
        </div>
        <div
          style={{
            width: 38,
            background: '#febd69',
            borderRadius: '0 4px 4px 0',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <SearchG />
        </div>
      </div>

      {/* delivery strip — compressed */}
      <div style={{ background: '#37475a', color: '#fff', fontSize: 10.5, padding: '4px 10px' }}>
        Delivering to Hyderabad 500032 · <span style={{ color: '#febd69' }}>Update location</span>
      </div>

      {/* product image — appears immediately with no nav clutter above */}
      <ProductImage src={active} ratio={ratio} />

      {/* carousel dots — only show for resolved image slots */}
      {(() => {
        const resolved = images.map((url, i) => ({ url, i })).filter(({ url }) => Boolean(url));
        if (resolved.length <= 1) return null;
        return (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, padding: '7px 0 3px' }}>
            {resolved.map(({ i }) => (
              <button
                key={i}
                type="button"
                onClick={() => onActiveChange(i)}
                aria-label={`Show image ${i + 1}`}
                style={{
                  width: i === activeIndex ? 9 : 7,
                  height: i === activeIndex ? 9 : 7,
                  borderRadius: '50%',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  background: i === activeIndex ? '#007185' : '#c7cdd1',
                }}
              />
            ))}
          </div>
        );
      })()}

      {/* details */}
      <div style={{ padding: '10px 12px 28px' }}>
        {/* Amazon's Choice — mobile sizing */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: '#232f3e',
            borderRadius: 3,
            padding: '2px 6px',
            marginBottom: 4,
          }}
        >
          <span style={{ color: '#fff', fontSize: 9, fontWeight: 700 }}>Amazon's</span>
          <span style={{ color: '#ff9900', fontSize: 9, fontWeight: 700 }}>Choice</span>
          <span style={{ color: '#ccc', fontSize: 8.5, marginLeft: 1 }}>in Women's Tops</span>
        </div>
        <div style={{ color: '#007185', fontSize: 11, marginBottom: 3 }}>
          Visit the {TC.store} Store
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.2, marginBottom: 6 }}>{TC.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          <span style={{ fontSize: 12 }}>{TC.rating}</span>
          <Stars rating={TC.rating} />
          <span style={{ color: '#007185', fontSize: 11 }}>({TC.ratingCount})</span>
        </div>

        {/* price */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: '#cc0c39', fontSize: 16 }}>-{TC.discount}</span>
          <span style={{ fontSize: 11, marginTop: 1 }}>
            ₹<span style={{ fontSize: 22, fontWeight: 500 }}>{TC.price}</span>
            <sup>00</sup>
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#565959', marginBottom: 2 }}>
          M.R.P.: <span style={{ textDecoration: 'line-through' }}>₹{TC.mrp}</span>
        </div>
        <div style={{ fontSize: 10.5, color: '#565959', marginBottom: 8 }}>
          Inclusive of all taxes
        </div>

        {/* delivery */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 11,
            marginBottom: 10,
            lineHeight: 1.45,
          }}
        >
          <div>
            <b>FREE delivery</b> Saturday, 31 May ·{' '}
            <span style={{ color: '#007185' }}>Details</span>
          </div>
          <div>
            Or fastest delivery <b>Thursday, 29 May</b>
          </div>
        </div>

        <div style={{ color: '#007600', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
          In stock
        </div>

        {/* size */}
        <div style={{ fontSize: 11.5, marginBottom: 5 }}>
          Size: <b>{size}</b>
        </div>
        <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
          {TC.sizes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              style={{
                width: 40,
                height: 32,
                borderRadius: 5,
                border: `1px solid ${s === size ? '#007185' : '#d5d9d9'}`,
                boxShadow: s === size ? '0 0 0 1px #007185' : 'none',
                background: '#fff',
                fontSize: 12,
                cursor: 'pointer',
                color: '#0f1111',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        <button
          type="button"
          style={{
            width: '100%',
            height: 34,
            borderRadius: 18,
            border: 'none',
            background: '#ffd814',
            fontWeight: 500,
            fontSize: 13,
            marginBottom: 6,
            cursor: 'pointer',
          }}
        >
          Add to cart
        </button>
        <button
          type="button"
          style={{
            width: '100%',
            height: 34,
            borderRadius: 18,
            border: 'none',
            background: '#ffa41c',
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Buy Now
        </button>

        {/* offers — highest-recognition commerce signal */}
        <OfferBlock compact />

        {/* returns trust signal */}
        <div style={{ marginTop: 6, fontSize: 10.5, color: '#565959' }}>
          ✓ <b style={{ color: '#0f1111' }}>10 days</b> returnable · Secure transaction
        </div>

        {/* sold by */}
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            display: 'grid',
            gridTemplateColumns: '70px 1fr',
            rowGap: 2,
            color: '#565959',
          }}
        >
          <span>Sold by</span>
          <span style={{ color: '#007185' }}>Furbo Fashion</span>
          <span>Ships from</span>
          <span>Amazon</span>
          <span>Payment</span>
          <span>Secure transaction</span>
        </div>
      </div>
    </div>
  );
}

// ─── Amazon desktop template ──────────────────────────────────────────────────

export function AmazonDesktopTemplate({
  images,
  activeIndex,
  onActiveChange,
  ratio,
}: TemplateProps) {
  const [size, setSize] = useState(TC.defaultSize);
  const active = images[activeIndex];

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, color: '#0f1111' }}>
      {/* top nav */}
      <div
        style={{
          background: '#131921',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '7px 14px',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
          amazon<span style={{ color: '#ff9900' }}>.in</span>
        </span>
        <span style={{ color: '#fff', fontSize: 10.5, lineHeight: 1.2, flexShrink: 0 }}>
          <span style={{ color: '#ccc' }}>Deliver to</span>
          <br />
          <b>Hyderabad 500032</b>
        </span>
        <div style={{ flex: 1, display: 'flex', height: 32 }}>
          <div
            style={{
              width: 44,
              background: '#e6e6e6',
              borderRadius: '4px 0 0 4px',
              display: 'grid',
              placeItems: 'center',
              fontSize: 10.5,
              color: '#555',
            }}
          >
            All
          </div>
          <div style={{ flex: 1, background: '#fff' }} />
          <div
            style={{
              width: 42,
              background: '#febd69',
              borderRadius: '0 4px 4px 0',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <SearchG />
          </div>
        </div>
        <span style={{ color: '#fff', fontSize: 10.5, lineHeight: 1.2, flexShrink: 0 }}>
          Hello, sign in
          <br />
          <b>Account & Lists</b>
        </span>
        <span style={{ color: '#fff', fontSize: 10.5, lineHeight: 1.2, flexShrink: 0 }}>
          Returns
          <br />
          <b>& Orders</b>
        </span>
        <CartG size={20} />
      </div>

      {/* subnav */}
      <div
        style={{
          background: '#232f3e',
          color: '#fff',
          fontSize: 11.5,
          padding: '6px 14px',
          display: 'flex',
          gap: 14,
          overflow: 'hidden',
        }}
      >
        {[
          '☰ All',
          'Fresh',
          'Sell',
          'Bestsellers',
          'Mobiles',
          "Today's Deals",
          'Prime',
          'Customer Service',
          'Fashion',
          'Electronics',
          'Home & Kitchen',
        ].map((x) => (
          <span key={x} style={{ whiteSpace: 'nowrap' }}>
            {x}
          </span>
        ))}
      </div>

      {/* breadcrumb */}
      <div style={{ fontSize: 11, color: '#565959', padding: '8px 18px 2px' }}>
        Home &amp; Kitchen › Fashion › Women › Tops, T-Shirts &amp; Shirts › Tops &amp; Tunics
      </div>

      {/* 3-column: 42% image | flex details | 190px buy box */}
      <div
        style={{ display: 'flex', gap: 18, padding: '10px 18px 32px', alignItems: 'flex-start' }}
      >
        {/* col 1: thumbnail rail + zoomable main image */}
        <div style={{ flex: '0 0 42%', display: 'flex', gap: 10, minWidth: 0 }}>
          {/* thumbnail rail — hover swaps main image */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flexShrink: 0 }}>
            {images.slice(0, 7).map((url, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: gallery index is stable
                key={i}
                type="button"
                onClick={() => onActiveChange(i)}
                onMouseEnter={() => onActiveChange(i)}
                aria-label={`Show image ${i + 1}`}
                style={{
                  width: 44,
                  height: 56,
                  borderRadius: 4,
                  border: `1px solid ${i === activeIndex ? '#e77600' : '#d5d9d9'}`,
                  boxShadow: i === activeIndex ? '0 0 0 2px #e77600' : 'none',
                  overflow: 'hidden',
                  padding: 0,
                  cursor: 'pointer',
                  background: '#f7f7f7',
                  flexShrink: 0,
                }}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  // biome-ignore lint/performance/noImgElement: preview panel image
                  <img
                    src={url}
                    alt=""
                    aria-hidden="true"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <div
                    className="av-shimmer"
                    style={{ width: '100%', height: '100%' }}
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
            {images.length > 7 && (
              <div
                style={{
                  width: 44,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  color: '#007185',
                  cursor: 'pointer',
                }}
              >
                {images.length - 7}+ more
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <ProductImage src={active} ratio={ratio} />
            <div style={{ textAlign: 'center', fontSize: 10.5, color: '#565959', marginTop: 6 }}>
              Roll over image to zoom in
            </div>
          </div>
        </div>

        {/* col 2: product details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Amazon's Choice badge — high-recognition trust signal */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: '#232f3e',
              borderRadius: 3,
              padding: '3px 8px',
              marginBottom: 6,
            }}
          >
            <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>
              Amazon's
            </span>
            <span style={{ color: '#ff9900', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>
              Choice
            </span>
            <span style={{ color: '#ccc', fontSize: 9.5, marginLeft: 2 }}>in Women's Tops</span>
          </div>
          <div style={{ fontSize: 18, lineHeight: 1.25, color: '#0f1111', marginBottom: 4 }}>
            {TC.title}
          </div>
          <div style={{ color: '#007185', fontSize: 11.5, marginBottom: 5 }}>
            Visit the {TC.store} Store
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 12.5 }}>{TC.rating}</span>
            <Stars rating={TC.rating} size={13} />
            <span style={{ color: '#007185', fontSize: 11.5 }}>({TC.ratingCount} ratings)</span>
          </div>
          <div style={{ fontSize: 11, color: '#565959', marginBottom: 8 }}>
            1,204 bought in past month
          </div>

          <div style={{ height: 1, background: '#e7e7e7', marginBottom: 10 }} />

          {/* price */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
            <span style={{ color: '#cc0c39', fontSize: 16 }}>-{TC.discount}</span>
            <span>
              ₹<span style={{ fontSize: 24, fontWeight: 500 }}>{TC.price}</span>
              <sup>00</sup>
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#565959', marginBottom: 10 }}>
            M.R.P.: <span style={{ textDecoration: 'line-through' }}>₹{TC.mrp}</span> · Inclusive of
            all taxes
          </div>

          {/* EMI teaser */}
          <div style={{ fontSize: 11, color: '#565959', marginBottom: 10 }}>
            EMI starts at <b style={{ color: '#0f1111' }}>₹167</b>. No Cost EMI available ·{' '}
            <span style={{ color: '#007185' }}>EMI options</span>
          </div>

          {/* offers block */}
          <OfferBlock />

          <div style={{ height: 1, background: '#e7e7e7', margin: '14px 0 10px' }} />

          {/* size */}
          <div style={{ fontSize: 12, marginBottom: 7 }}>
            Size: <b>{size}</b>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {TC.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                style={{
                  minWidth: 44,
                  height: 34,
                  borderRadius: 6,
                  border: `1px solid ${s === size ? '#007185' : '#d5d9d9'}`,
                  boxShadow: s === size ? '0 0 0 1px #007185' : 'none',
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#0f1111',
                  fontSize: 13,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* returns + trust metadata */}
          <div style={{ fontSize: 11, color: '#565959', lineHeight: 1.6 }}>
            <div>
              ✓ <b style={{ color: '#0f1111' }}>10 days</b> returnable · Ships from Amazon
            </div>
            <div>✓ Secure transaction · Packaging doesn't reveal contents</div>
          </div>
        </div>

        {/* col 3: buy box — 190px */}
        <div
          style={{
            flex: '0 0 190px',
            border: '1px solid #d5d9d9',
            borderRadius: 8,
            padding: '14px 12px',
            fontSize: 12,
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ marginBottom: 4 }}>
            ₹<span style={{ fontSize: 22, fontWeight: 500 }}>{TC.price}</span>
          </div>
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: '#007185' }}>FREE delivery</span> Saturday, 31 May
          </div>
          <div style={{ fontSize: 11, marginBottom: 10, color: '#565959' }}>
            Or fastest delivery <b style={{ color: '#0f1111' }}>Thu, 29 May</b>
          </div>
          <div style={{ color: '#007600', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            In stock
          </div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>
            <label
              htmlFor="qty-select"
              style={{ display: 'block', marginBottom: 3, color: '#565959' }}
            >
              Quantity
            </label>
            <select
              id="qty-select"
              style={{
                width: '100%',
                padding: '4px 6px',
                borderRadius: 4,
                border: '1px solid #d5d9d9',
                fontSize: 12,
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            style={{
              width: '100%',
              height: 30,
              borderRadius: 16,
              border: 'none',
              background: '#ffd814',
              cursor: 'pointer',
              marginBottom: 7,
              fontSize: 12,
            }}
          >
            Add to Cart
          </button>
          <button
            type="button"
            style={{
              width: '100%',
              height: 30,
              borderRadius: 16,
              border: 'none',
              background: '#ffa41c',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Buy Now
          </button>
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              display: 'grid',
              gridTemplateColumns: '62px 1fr',
              rowGap: 2,
              color: '#565959',
            }}
          >
            <span>Sold by</span>
            <span style={{ color: '#007185' }}>Furbo Fashion</span>
            <span>Ships from</span>
            <span>Amazon</span>
            <span>Payment</span>
            <span style={{ color: '#007185' }}>Secure transaction</span>
          </div>
          <div
            style={{
              marginTop: 12,
              border: '1px solid #eee',
              borderRadius: 6,
              padding: '7px 9px',
              fontSize: 11,
              color: '#565959',
            }}
          >
            <div style={{ fontWeight: 600, color: '#0f1111', marginBottom: 3 }}>
              Add a Protection Plan:
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginTop: 2 }} />
              1-Year Fashion Protection Plan — ₹99
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
