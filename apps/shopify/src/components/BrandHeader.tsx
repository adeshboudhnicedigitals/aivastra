import type { ReactNode } from 'react';
import brandLogo from '../assets/brand-logo.png';
import shopifyMark from '../assets/shopify-mark.png';

/**
 * Logo + "Shopify App" chip on the left, an optional slot on the right. The app
 * pages pass `compact` (logo only) and a `center` slot for the section nav.
 */
export function BrandHeader({
  right,
  center,
  compact = false,
}: {
  right?: ReactNode;
  center?: ReactNode;
  compact?: boolean;
}) {
  return (
    <header className="av-hdr">
      <div className="av-brand">
        {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
        <img className="av-logo" src={brandLogo} alt="Ai Vastra logo" />
        <span className="av-bn">Ai Vastra</span>
        {!compact && (
          <>
            <span className="av-vr" aria-hidden />
            <span className="av-sp">
              {/* biome-ignore lint/performance/noImgElement: Vite SPA; the Next.js <Image> advice does not apply */}
              <img src={shopifyMark} alt="" />
              <span>Shopify App</span>
            </span>
          </>
        )}
      </div>
      {center}
      {right}
    </header>
  );
}
