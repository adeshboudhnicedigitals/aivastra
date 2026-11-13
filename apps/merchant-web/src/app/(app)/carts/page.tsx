'use client';
import type { CartView } from '@aivastra/types';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { C } from '@/components/tokens';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { normaliseCartCode, rupees } from '@/lib/cart-format';
import { ApiError } from '@/lib/errors';

// CRM phase 3 (plan P6): a kiosk shopper brings the cart code shown on the tablet to the counter;
// staff look it up here and mark it billed once the POS has rung it up. Staff see carts of their
// own branch only (server-enforced).

const card: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const btn = (primary?: boolean): React.CSSProperties => ({
  height: 40,
  padding: '0 16px',
  borderRadius: 8,
  border: primary ? 'none' : `1px solid ${C.border2}`,
  background: primary ? C.btnPrimary : C.white,
  color: primary ? C.white : C.text,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});

export default function CartsPage() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: (c: string) => apiFetch<CartView>(`/v1/merchant/carts/${c}`),
    onSuccess: (next, c) => {
      setCart(next);
      setCode(c);
    },
    onError: (e: unknown) => {
      setCart(null);
      setError(
        e instanceof ApiError && e.status === 404
          ? 'No cart with this code at your branch.'
          : 'The request could not be completed.',
      );
    },
  });
  const bill = useMutation({
    mutationFn: (c: string) =>
      apiFetch<CartView>(`/v1/merchant/carts/${c}/bill`, { method: 'POST', body: '{}' }),
    onSuccess: (next) => {
      setCart(next);
      toast.show('Cart marked as billed', 'success');
    },
    onError: (e: unknown) =>
      toast.show(e instanceof Error ? e.message : 'The request could not be completed.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normaliseCartCode(text);
    if (!c) {
      setError('Enter the 8-character code shown on the tablet.');
      return;
    }
    setError(null);
    lookup.mutate(c);
  };

  const open = cart?.lines.filter((l) => !l.billed) ?? [];
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
        Bill a cart
      </h1>
      <form onSubmit={submit} style={card}>
        <label htmlFor="cart-code" style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
          Cart code
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            id="cart-code"
            autoComplete="off"
            autoCapitalize="characters"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'cart-code-err' : undefined}
            style={{
              flex: '1 1 200px',
              height: 40,
              padding: '0 12px',
              borderRadius: 8,
              border: `1px solid ${error ? C.danger : C.border2}`,
              background: C.field,
              color: C.text,
              fontFamily: 'inherit',
              fontSize: 16,
              letterSpacing: 2,
              minWidth: 0,
            }}
          />
          <button type="submit" disabled={lookup.isPending} style={btn(true)}>
            {lookup.isPending ? 'Looking up...' : 'Find cart'}
          </button>
        </div>
        {error && (
          <div
            id="cart-code-err"
            role="alert"
            style={{ color: C.danger, fontSize: 13, marginTop: 8 }}
          >
            {error}
          </div>
        )}
      </form>

      {cart && code && (
        <section style={card} aria-labelledby="cart-heading">
          <h2 id="cart-heading" style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
            Cart {cart.cartCode} ·{' '}
            {cart.status === 'billed' ? 'Billed' : cart.status === 'abandoned' ? 'Expired' : 'Open'}
          </h2>
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 480 }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: C.mid }}>
                  <th style={{ padding: 8 }}>Item</th>
                  <th style={{ padding: 8 }}>Size</th>
                  <th style={{ padding: 8 }}>Barcode / SKU</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Amount</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {cart.lines.map((l) => (
                  <tr key={l.id} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
                    <td style={{ padding: 8 }}>{l.label}</td>
                    <td style={{ padding: 8 }}>
                      {l.size}
                      {l.colour ? ` · ${l.colour}` : ''}
                    </td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {l.barcode ?? l.sku ?? '—'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{l.quantity}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      {rupees(l.unitPricePaise * l.quantity)}
                    </td>
                    <td style={{ padding: 8, color: l.billed ? C.text : C.mid }}>
                      {l.billed ? 'Billed' : 'Not billed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, fontWeight: 700, color: C.text }}>
            Total {rupees(cart.totalPaise)}
          </div>
          {cart.status === 'open' && open.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                disabled={bill.isPending}
                style={btn(true)}
                onClick={() => bill.mutate(code)}
              >
                {bill.isPending
                  ? 'Saving...'
                  : `Mark ${open.length === cart.lines.length ? 'all' : 'the rest'} as billed`}
              </button>
              <div style={{ fontSize: 12, color: C.light, marginTop: 6 }}>
                Do this after the POS has billed these items. Each billed item counts as a sale for
                you.
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
