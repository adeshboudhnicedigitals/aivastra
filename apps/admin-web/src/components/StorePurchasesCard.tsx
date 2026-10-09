import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage, apiFetch } from '../lib/data';
import type { StorePurchase } from '../types';

interface Props {
  storeId: string;
  toast: (t: { kind?: 'error'; title: string; body?: string }) => void;
}

/**
 * Credit-pack purchases for one store, with Shopify's charge status and our
 * payment status side by side — ACTIVE (invoiced) and PAID (collected) are
 * different facts under hold-until-paid. "Check payment" asks the Partner API
 * now instead of waiting for the settlement loop.
 */
export function StorePurchasesCard({ storeId, toast }: Props) {
  const { hasPermission } = useAuth();
  const [purchases, setPurchases] = useState<StorePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ purchases: StorePurchase[] }>(
        `/admin/shopify-stores/${storeId}/purchases`,
      );
      setPurchases(data.purchases);
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Failed to load purchases',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkPayment(id: string) {
    setChecking(id);
    try {
      const res = await apiFetch<{ paymentStatus: string }>(
        `/admin/shopify/purchases/${id}/check-payment`,
        { method: 'POST' },
      );
      toast({ title: `Payment status: ${res.paymentStatus}` });
      await load();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Payment check failed',
        body: apiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setChecking(null);
    }
  }

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
                        hasPermission('credits.write') && (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={checking === p.id}
                            onClick={() => void checkPayment(p.id)}
                          >
                            {checking === p.id ? 'Checking…' : 'Check payment'}
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
