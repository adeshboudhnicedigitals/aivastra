import type { ReactNode } from 'react';
import { tryOnsFromCredits } from '../lib/packs';
import type { ShopifyMe } from '../types';
import { AvCard } from './AvCard';

// Billing's balance card: credits with the try-ons they cover on the same row,
// then the page's own actions in `action`.
export function BalanceCard({ me, action }: { me: ShopifyMe | null; action?: ReactNode }) {
  const balance = me?.creditBalance ?? 0;
  const tryOns = me?.runway?.tryOnsRemaining ?? tryOnsFromCredits(balance);

  return (
    <AvCard>
      <div className="av2-bal">
        <div className="av2-bal-label">Available Credits</div>
        <div className="av2-bal-row">
          <div className="av-big">{balance.toLocaleString()} credits</div>
          <span className="av2-bal-try">≈ {tryOns.toLocaleString()} try-ons remaining</span>
        </div>
        {action && (
          <>
            <hr className="av2-hr" />
            {action}
          </>
        )}
      </div>
    </AvCard>
  );
}
