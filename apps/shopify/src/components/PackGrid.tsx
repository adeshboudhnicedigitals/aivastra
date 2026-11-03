import type { ReactNode } from 'react';
import { useState } from 'react';
import { apiFetch, navigateTopLevel } from '../lib/api';
import { type ClassifiedError, classifyError } from '../lib/errors';
import { PACK_DISPLAY } from '../lib/packs';

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
    <div className={`av-grid ${leadingCard ? 'av-g4' : 'av-g3'}`}>
      {leadingCard}
      {PACK_DISPLAY.map((pack) => (
        <div
          key={pack.id}
          className="av-c"
          style={{
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            border: pack.bestValue ? '2px solid #5a2cf0' : undefined,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <h2 className="av-h2">{pack.label}</h2>
            {pack.bestValue && <span className="av-chip ok">Best value</span>}
          </div>
          <div className="av-big lg">${pack.priceUsd}</div>
          <div className="av-sub" style={{ color: '#12101f', fontWeight: 500 }}>
            {pack.tryOns.toLocaleString()} try-ons
          </div>
          <div className="av-sub" style={{ marginTop: 4, marginBottom: 20 }}>
            {pack.credits.toLocaleString()} credits · never expire
          </div>
          <button
            type="button"
            className="av-btn-primary"
            style={{ marginTop: 'auto', width: '100%', height: 48, fontSize: 16 }}
            disabled={buying !== null}
            aria-busy={buying === pack.id || undefined}
            onClick={() => buyPack(pack.id)}
          >
            Buy credits
          </button>
        </div>
      ))}
    </div>
  );
}
