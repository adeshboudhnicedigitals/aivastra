import type { ReactNode } from 'react';
import { useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { PACK_DISPLAY } from '../lib/packs';
import { Glyph } from './PageHead';

// Shared between DashboardPage and PricingPage, same pattern as
// DashboardPage's own LowCreditsBanner: one definition, imported wherever the
// buy-a-pack flow needs to render. `onError` bubbles a failed purchase up to
// whichever page-level Banner the caller already has, instead of duplicating
// one here.
//
// `leadingCard` renders as an extra tile ahead of the paid packs, same grid,
// same card sizing: currently the Dashboard's free-tier tile for stores that
// haven't bought a pack yet, but kept generic rather than importing that
// concern directly here.
export function PackGrid({
  onError,
  leadingCard,
}: {
  onError?: (error: ClassifiedError) => void;
  leadingCard?: ReactNode;
}) {
  const [buying, setBuying] = useState<string | null>(null);

  async function buyPack(packId: string) {
    setBuying(packId);
    try {
      const { confirmationUrl } = await apiFetch<{ purchaseId: string; confirmationUrl: string }>(
        '/v1/shopify/billing/purchase',
        { method: 'POST', body: JSON.stringify({ packId }) },
      );
      // Shopify's approval page is outside the embedded app's origin, so this
      // must be a top-level navigation; an iframe navigation is blocked.
      navigateTopLevel(confirmationUrl);
    } catch (err) {
      onError?.(classifyError(err));
      setBuying(null);
    }
  }

  return (
    <div className={`av2-packs${leadingCard ? ' lead' : ''}`}>
      {leadingCard}
      {PACK_DISPLAY.map((pack) => (
        <div key={pack.id} className={`av2-pack${pack.bestValue ? ' hot' : ''}`}>
          <div className="av2-pack-head">
            <h3>{pack.label}</h3>
            {pack.bestValue && (
              <span className="av-chip brand">
                <Glyph size={14}>
                  <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
                </Glyph>
                Most Popular
              </span>
            )}
          </div>
          <div className="av2-pack-n">{pack.credits.toLocaleString()} credits</div>
          <div className="av2-pack-t">≈ {pack.tryOns.toLocaleString()} try-ons</div>
          <div className="av2-pack-p">${pack.priceUsd}</div>
          <div className="av2-pack-note">Never expire</div>
          <button
            type="button"
            className={pack.bestValue ? 'av-btn-primary' : 'av-btn-ghost'}
            disabled={buying !== null}
            aria-busy={buying === pack.id || undefined}
            onClick={() => buyPack(pack.id)}
          >
            Buy Now
          </button>
        </div>
      ))}
    </div>
  );
}
