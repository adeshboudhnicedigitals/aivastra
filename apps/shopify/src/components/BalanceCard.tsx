import type { ReactNode } from 'react';
import { tryOnsFromCredits } from '../lib/packs';
import type { ShopifyMe } from '../types';
import { AvCard } from './AvCard';

// Shared between DashboardPage and PricingPage, same pattern as
// LowCreditsBanner and PackGrid. `action` is the page's own button (Buy credits
// on the Dashboard, View packs on Credits).
export function BalanceCard({ me, action }: { me: ShopifyMe | null; action?: ReactNode }) {
  const balance = me?.creditBalance ?? 0;

  return (
    <AvCard>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="av-k">Current balance</span>
            <span className="av-chip brand">{me?.currentPack ? me.currentPack.label : 'Free'}</span>
          </div>
          <div className="av-big xl">{balance.toLocaleString()} credits</div>
          <div className="av-sub">
            About {(me?.runway?.tryOnsRemaining ?? tryOnsFromCredits(balance)).toLocaleString()}{' '}
            try-ons remaining
            {me?.runway?.daysRemaining != null
              ? ` — roughly ${Math.max(1, Math.round(me.runway.daysRemaining))} days at your current rate`
              : ''}
          </div>
        </div>
        {action}
      </div>
    </AvCard>
  );
}
