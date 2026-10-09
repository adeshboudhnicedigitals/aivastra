import type { StorePurchase } from '../types';

interface Props {
  purchases: StorePurchase[];
  loading: boolean;
  checkingId: string | null;
  canCheck: boolean;
  onCheck: (purchaseId: string) => void;
}

/**
 * Credit-pack purchases for one store, with Shopify's charge status and our
 * payment status side by side — ACTIVE (invoiced) and PAID (collected) are
 * different facts under hold-until-paid. "Check payment" asks the Partner API
 * now instead of waiting for the settlement loop. Presentational: the page owns
 * the fetch because it renders this card in both of its always-mounted layouts.
 */
export function StorePurchasesCard({ purchases, loading, checkingId, canCheck, onCheck }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Credit-pack purchases</h3>
      </div>
      <div className="card-body">
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>
        ) : purchases.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>No purchases yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pack</th>
                  <th style={{ textAlign: 'right' }}>Credits</th>
                  <th>Charge</th>
                  <th>Payment</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{p.packId}</td>
                    <td style={{ textAlign: 'right' }}>{p.credits.toLocaleString()}</td>
                    <td>{p.status}</td>
                    <td>
                      {p.paymentStatus}
                      {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleString()}` : ''}
                    </td>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                    <td>
                      {(p.paymentStatus === 'AWAITING' || p.paymentStatus === 'UNPAID') &&
                        canCheck && (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={checkingId === p.id}
                            onClick={() => onCheck(p.id)}
                          >
                            {checkingId === p.id ? 'Checking…' : 'Check payment'}
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
