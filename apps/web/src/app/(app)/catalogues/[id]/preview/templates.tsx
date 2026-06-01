'use client';
import { useEffect, useState } from 'react';

// ─── shared content + helpers ──────────────────────────────────────────────────

// Single source for all marketplace copy. Hardcoded for v1; later this can accept
// real product metadata (title, price, SKU) supplied by the user.
const TEMPLATE_CONTENT = {
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

interface TemplateProps {
  images: Array<string | undefined>;
  activeIndex: number;
  onActiveChange: (i: number) => void;
  ratio: string; // CSS aspect-ratio value, e.g. "3 / 4"
}

// Convert pipeline ratio strings ("3:4") to a CSS aspect-ratio value ("3 / 4").
export function aspectToCss(ratio: string | null | undefined): string {
  if (!ratio) return '1 / 1';
  const [w, h] = ratio.split(':');
  return w && h ? `${w} / ${h}` : '1 / 1';
}

// Product image slot: reserves space via aspect-ratio (no CLS), shimmer skeleton
// until the image loads, then fades in. contain-on-white mirrors marketplace cropping.
function ProductImage({ src, ratio }: { src?: string; ratio: string }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: ratio,
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {(!src || !loaded) && (
        <div className="av-shimmer" style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Generated catalogue preview"
          onLoad={() => setLoaded(true)}
          style={{
            position: 'relative',
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

// Partial-fill star rating — two stacked layers clipped by percentage.
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

// ─── decorative glyphs (marketplace chrome — aria-hidden) ──────────────────────

const glyphProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const MenuGlyph = ({ color = '#fff' }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" style={{ color }} {...glyphProps}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);
const CartGlyph = ({ color = '#fff', size = 22 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ color }} {...glyphProps}>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
);
const SearchGlyph = ({ color = '#0f1111' }: { color?: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" style={{ color }} {...glyphProps}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.34-4.34" />
  </svg>
);
const PinGlyph = ({ color = '#fff' }: { color?: string }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" style={{ color }} {...glyphProps}>
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const LockGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" style={{ color: '#5f6368' }} {...glyphProps}>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// ─── device shells ─────────────────────────────────────────────────────────────

// Generic premium Android-style phone. Chrome is decorative; screen content is real.
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
        boxShadow: '0 30px 60px rgba(0,0,0,0.26), 0 8px 20px rgba(0,0,0,0.12)',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {/* punch-hole camera */}
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
        style={{
          height: 720,
          maxHeight: '72vh',
          background: '#fff',
          borderRadius: 36,
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Generic browser window — traffic lights + domain-only URL. No OEM hardware.
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
        width: 980,
        maxWidth: '100%',
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #e6e6e6',
        boxShadow: '0 30px 60px rgba(0,0,0,0.16), 0 8px 20px rgba(0,0,0,0.06)',
      }}
    >
      {/* browser top chrome */}
      <div
        style={{
          height: 44,
          background: '#f1f1f2',
          borderBottom: '1px solid #e2e2e2',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 7 }} aria-hidden="true">
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840' }} />
        </div>
        <div
          style={{
            flex: 1,
            maxWidth: 440,
            margin: '0 auto',
            height: 28,
            background: '#fff',
            borderRadius: 14,
            border: '1px solid #e2e2e2',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 14px',
            fontSize: 12.5,
            color: '#5f6368',
          }}
        >
          <LockGlyph />
          amazon.in
        </div>
        <div style={{ width: 52 }} aria-hidden="true" />
      </div>
      <div
        ref={scrollRef}
        style={{ height: 620, maxHeight: '66vh', overflow: 'auto', background: '#fff' }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Amazon templates (static, inspired — not pixel clones) ────────────────────

export function AmazonMobileTemplate({
  images,
  activeIndex,
  onActiveChange,
  ratio,
}: TemplateProps) {
  const [size, setSize] = useState(TEMPLATE_CONTENT.defaultSize);
  const active = images[activeIndex];

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, color: '#0f1111' }}>
      {/* header */}
      <div
        style={{
          background: '#131921',
          padding: '9px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MenuGlyph />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
          amazon<span style={{ color: '#ff9900' }}>.in</span>
        </span>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: '#fff',
          }}
        >
          <span style={{ fontSize: 11 }}>Sign in ›</span>
          <CartGlyph size={20} />
        </div>
      </div>
      {/* search */}
      <div style={{ background: '#232f3e', padding: 8, display: 'flex' }}>
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
            height: 34,
          }}
        >
          Search Amazon.in
        </div>
        <div
          style={{
            width: 42,
            background: '#febd69',
            borderRadius: '0 4px 4px 0',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <SearchGlyph />
        </div>
      </div>
      {/* delivery */}
      <div
        style={{
          background: '#37475a',
          color: '#fff',
          fontSize: 11,
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <PinGlyph /> Delivering to Hyderabad 500032 · Update location
      </div>
      {/* category nav */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '8px 10px',
          overflowX: 'auto',
          borderBottom: '1px solid #eee',
          fontSize: 11,
        }}
      >
        {['Prime', 'Mobiles', 'Fashion', 'Home', 'Electronics', 'miniTV'].map((c) => (
          <span key={c} style={{ whiteSpace: 'nowrap', color: '#0f1111' }}>
            {c}
          </span>
        ))}
      </div>

      {/* main image + carousel dots */}
      <div style={{ padding: '6px 0 0' }}>
        <ProductImage src={active} ratio={ratio} />
        {images.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '10px 0 6px' }}>
            {images.map((_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: gallery slots are positional and stable
                key={i}
                type="button"
                onClick={() => onActiveChange(i)}
                aria-label={`Show image ${i + 1}`}
                style={{
                  width: i === activeIndex ? 8 : 7,
                  height: i === activeIndex ? 8 : 7,
                  borderRadius: '50%',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  background: i === activeIndex ? '#007185' : '#c7cdd1',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* details */}
      <div style={{ padding: '8px 14px 24px' }}>
        <div style={{ color: '#007185', fontSize: 12, marginBottom: 4 }}>
          Visit the {TEMPLATE_CONTENT.store} Store
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.35, marginBottom: 6 }}>
          {TEMPLATE_CONTENT.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>{TEMPLATE_CONTENT.rating}</span>
          <Stars rating={TEMPLATE_CONTENT.rating} />
          <span style={{ color: '#007185', fontSize: 12 }}>({TEMPLATE_CONTENT.ratingCount})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: '#cc0c39', fontSize: 18 }}>-{TEMPLATE_CONTENT.discount}</span>
          <span style={{ fontSize: 12, marginTop: 2 }}>
            ₹<span style={{ fontSize: 22, fontWeight: 500 }}>{TEMPLATE_CONTENT.price}</span>
            <sup>00</sup>
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#565959', marginBottom: 2 }}>
          M.R.P.: <span style={{ textDecoration: 'line-through' }}>₹{TEMPLATE_CONTENT.mrp}</span>
        </div>
        <div style={{ fontSize: 11, color: '#565959', marginBottom: 10 }}>
          Inclusive of all taxes
        </div>
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 8,
            padding: 10,
            fontSize: 11,
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          <div>
            <b>FREE delivery</b> Saturday, 31 May. <span style={{ color: '#007185' }}>Details</span>
          </div>
          <div>
            Or fastest delivery <b>Thursday, 29 May</b>.{' '}
            <span style={{ color: '#007185' }}>Details</span>
          </div>
        </div>
        <div style={{ color: '#007600', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
          In stock
        </div>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Size: <b>{size}</b>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {TEMPLATE_CONTENT.sizes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              style={{
                width: 42,
                height: 34,
                borderRadius: 6,
                border: `1px solid ${s === size ? '#007185' : '#d5d9d9'}`,
                boxShadow: s === size ? '0 0 0 1px #007185' : 'none',
                background: '#fff',
                fontSize: 13,
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
            height: 38,
            borderRadius: 20,
            border: 'none',
            background: '#ffd814',
            fontWeight: 500,
            fontSize: 13,
            marginBottom: 8,
            cursor: 'pointer',
          }}
        >
          Add to cart
        </button>
        <button
          type="button"
          style={{
            width: '100%',
            height: 38,
            borderRadius: 20,
            border: 'none',
            background: '#ffa41c',
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Buy Now
        </button>
      </div>
    </div>
  );
}

export function AmazonDesktopTemplate({
  images,
  activeIndex,
  onActiveChange,
  ratio,
}: TemplateProps) {
  const [size, setSize] = useState(TEMPLATE_CONTENT.defaultSize);
  const active = images[activeIndex];

  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, color: '#0f1111' }}>
      {/* top nav */}
      <div
        style={{
          background: '#131921',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 14px',
        }}
      >
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>
          amazon<span style={{ color: '#ff9900' }}>.in</span>
        </span>
        <span style={{ color: '#fff', fontSize: 11, lineHeight: 1.25 }}>
          <span style={{ color: '#ccc' }}>Deliver to</span>
          <br />
          <b>Hyderabad 500032</b>
        </span>
        <div style={{ flex: 1, display: 'flex', height: 34 }}>
          <div
            style={{
              width: 48,
              background: '#e6e6e6',
              borderRadius: '4px 0 0 4px',
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              color: '#555',
            }}
          >
            All
          </div>
          <div style={{ flex: 1, background: '#fff' }} />
          <div
            style={{
              width: 44,
              background: '#febd69',
              borderRadius: '0 4px 4px 0',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <SearchGlyph />
          </div>
        </div>
        <span style={{ color: '#fff', fontSize: 11, lineHeight: 1.25 }}>
          Hello, sign in
          <br />
          <b>Account & Lists</b>
        </span>
        <span style={{ color: '#fff', fontSize: 11, lineHeight: 1.25 }}>
          Returns
          <br />
          <b>& Orders</b>
        </span>
        <CartGlyph />
      </div>
      {/* subnav */}
      <div
        style={{
          background: '#232f3e',
          color: '#fff',
          fontSize: 12,
          padding: '7px 14px',
          display: 'flex',
          gap: 16,
          overflow: 'hidden',
        }}
      >
        {[
          'All',
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
      <div style={{ fontSize: 11, color: '#565959', padding: '10px 18px 4px' }}>
        Home &amp; Kitchen › Fashion › Women › Tops, T-Shirts &amp; Shirts › Tops &amp; Tunics
      </div>

      {/* main 3-column */}
      <div style={{ display: 'flex', gap: 22, padding: '8px 18px 28px' }}>
        {/* left: thumb rail + main image */}
        <div style={{ display: 'flex', gap: 10, width: 430, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 42 }}>
            {images.slice(0, 6).map((url, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: gallery slots are positional and stable
                key={i}
                type="button"
                onClick={() => onActiveChange(i)}
                aria-label={`Show image ${i + 1}`}
                style={{
                  width: 42,
                  height: 52,
                  borderRadius: 6,
                  border: `1px solid ${i === activeIndex ? '#e77600' : '#d5d9d9'}`,
                  boxShadow: i === activeIndex ? '0 0 0 1px #e77600' : 'none',
                  overflow: 'hidden',
                  padding: 0,
                  cursor: 'pointer',
                  background: '#fff',
                }}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt=""
                    aria-hidden="true"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
          </div>
          <div style={{ flex: 1 }}>
            <ProductImage src={active} ratio={ratio} />
            <div style={{ textAlign: 'center', fontSize: 11, color: '#565959', marginTop: 8 }}>
              Roll over image to zoom in
            </div>
          </div>
        </div>

        {/* middle: details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, lineHeight: 1.3 }}>{TEMPLATE_CONTENT.title}</div>
          <div style={{ color: '#007185', fontSize: 12, margin: '5px 0' }}>
            Visit the {TEMPLATE_CONTENT.store} Store
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{TEMPLATE_CONTENT.rating}</span>
            <Stars rating={TEMPLATE_CONTENT.rating} />
            <span style={{ color: '#007185', fontSize: 12 }}>
              ({TEMPLATE_CONTENT.ratingCount} ratings)
            </span>
          </div>
          <div style={{ height: 1, background: '#e7e7e7', margin: '12px 0' }} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: '#cc0c39', fontSize: 18 }}>-{TEMPLATE_CONTENT.discount}</span>
            <span>
              ₹<span style={{ fontSize: 24, fontWeight: 500 }}>{TEMPLATE_CONTENT.price}</span>
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#565959' }}>
            M.R.P.: <span style={{ textDecoration: 'line-through' }}>₹{TEMPLATE_CONTENT.mrp}</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 12 }}>
            Size: <b>{size}</b>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            {TEMPLATE_CONTENT.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                style={{
                  minWidth: 42,
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
        </div>

        {/* right: buy box */}
        <div
          style={{
            width: 230,
            flexShrink: 0,
            border: '1px solid #d5d9d9',
            borderRadius: 8,
            padding: 14,
            fontSize: 12,
            height: 'fit-content',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            ₹<span style={{ fontSize: 22, fontWeight: 500 }}>{TEMPLATE_CONTENT.price}</span>
          </div>
          <div style={{ fontSize: 11, marginBottom: 8 }}>
            <span style={{ color: '#007185' }}>FREE delivery</span> Saturday, 31 May
          </div>
          <div style={{ color: '#007600', fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
            In stock
          </div>
          <button
            type="button"
            style={{
              width: '100%',
              height: 32,
              borderRadius: 18,
              border: 'none',
              background: '#ffd814',
              cursor: 'pointer',
              marginBottom: 8,
              fontSize: 12,
            }}
          >
            Add to Cart
          </button>
          <button
            type="button"
            style={{
              width: '100%',
              height: 32,
              borderRadius: 18,
              border: 'none',
              background: '#ffa41c',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Buy Now
          </button>
          <div style={{ fontSize: 11, color: '#007185', marginTop: 12 }}>Secure transaction</div>
        </div>
      </div>
    </div>
  );
}
