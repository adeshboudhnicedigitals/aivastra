'use client';
import type { MerchantVariantsResponse, StockStatus } from '@aivastra/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSession } from '@/components/session-provider';
import { C } from '@/components/tokens';
import { PremiumSelect } from '@/components/ui/premium-select';
import { ListState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { STOCK_LABEL } from '@/lib/cart-format';

// CRM phase 3, spec §6.2: sizes (the garment type's standard list or free text) and per-branch
// availability for one product. Staff change stock for their own branch only, the admin for any;
// the server enforces both and refuses rows a feed owns.

type Branch = { id: string; name: string; isActive?: boolean };
const OTHER = '__other__';

const input: React.CSSProperties = {
  height: 36,
  padding: '0 10px',
  borderRadius: 8,
  border: `1px solid ${C.border2}`,
  background: C.field,
  color: C.text,
  fontFamily: 'inherit',
  fontSize: 13,
  minWidth: 0,
  boxSizing: 'border-box',
};
const btn: React.CSSProperties = {
  height: 36,
  padding: '0 12px',
  borderRadius: 8,
  border: 'none',
  background: C.btnPrimary,
  color: C.white,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

export function VariantsPanel({ itemId }: { itemId: string }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['catalogue', 'variants', itemId];
  const variants = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<MerchantVariantsResponse>(`/v1/merchant/catalog/${itemId}/variants`),
  });
  const branches = useQuery({
    queryKey: ['org', 'branches'],
    queryFn: () => apiFetch<{ branches: Branch[] }>('/v1/merchant/org/branches'),
  });
  const [size, setSize] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [colour, setColour] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sku, setSku] = useState('');

  const fail = (e: unknown) =>
    toast.show(e instanceof Error ? e.message : 'The request could not be completed.');
  const add = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/v1/merchant/catalog/${itemId}/variants`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      setCustom('');
      setColour('');
      setBarcode('');
      setSku('');
      toast.show('Size added', 'success');
    },
    onError: fail,
  });
  const setStock = useMutation({
    mutationFn: (v: { variantId: string; branchId: string; status: StockStatus }) =>
      apiFetch(`/v1/merchant/variants/${v.variantId}/stock/${v.branchId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: v.status }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: fail,
  });

  const data = variants.data;
  const standard = data?.sizeSet?.sizes ?? [];
  const chosen = size || standard[0] || OTHER;
  const sizeValue = chosen === OTHER ? custom.trim() : chosen;
  const visibleBranches = (branches.data?.branches ?? []).filter((b) => b.isActive !== false);
  const canEdit = (branchId: string) => me?.role === 'admin' || me?.branchId === branchId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sizeValue) {
      toast.show('Enter a size.');
      return;
    }
    add.mutate({
      size: sizeValue,
      colour: colour.trim(),
      ...(sku.trim() ? { sku: sku.trim() } : {}),
      ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
    });
  };

  return (
    <section
      aria-labelledby={`variants-${itemId}`}
      style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: 'grid', gap: 10 }}
    >
      <h3
        id={`variants-${itemId}`}
        style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}
      >
        Sizes and stock
      </h3>
      <ListState
        status={variants.status}
        isEmpty={false}
        emptyText=""
        error="Could not load sizes."
        onRetry={() => void variants.refetch()}
      >
        {data && (
          <>
            {data.variants.length === 0 && (
              <div style={{ fontSize: 13, color: C.mid }}>
                No sizes yet. Add the sizes you sell so shoppers can add this to their cart.
              </div>
            )}
            {data.variants.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 360, width: '100%' }}
                >
                  <thead>
                    <tr style={{ textAlign: 'left', color: C.mid }}>
                      <th style={{ padding: 6 }}>Size</th>
                      <th style={{ padding: 6 }}>Barcode</th>
                      {visibleBranches.map((b) => (
                        <th key={b.id} style={{ padding: 6 }}>
                          {b.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.variants.map((v) => (
                      <tr key={v.id} style={{ borderTop: `1px solid ${C.border}`, color: C.text }}>
                        <td style={{ padding: 6 }}>
                          {v.size}
                          {v.colour ? ` · ${v.colour}` : ''}
                          {v.isCustom ? ' (custom)' : ''}
                        </td>
                        <td style={{ padding: 6, fontFamily: 'monospace' }}>{v.barcode ?? '—'}</td>
                        {visibleBranches.map((b) => {
                          const s = v.stock.find((x) => x.branchId === b.id);
                          const feed = s && s.source !== 'manual';
                          return (
                            <td key={b.id} style={{ padding: 6, minWidth: 130 }}>
                              {canEdit(b.id) && !feed ? (
                                <PremiumSelect
                                  ariaLabel={`${v.size} stock at ${b.name}`}
                                  value={s?.status ?? ''}
                                  placeholder="Not set"
                                  onChange={(val) =>
                                    setStock.mutate({
                                      variantId: v.id,
                                      branchId: b.id,
                                      status: val as StockStatus,
                                    })
                                  }
                                  options={(['in_stock', 'low', 'out'] as const).map((k) => ({
                                    value: k,
                                    label: STOCK_LABEL[k] ?? k,
                                  }))}
                                  height={32}
                                  fontSize={12}
                                  fullWidth
                                />
                              ) : (
                                <span title={feed ? `Managed by ${s?.source}` : undefined}>
                                  {s ? STOCK_LABEL[s.status] : 'Not set'}
                                  {feed ? ` (${s?.source})` : ''}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <form
              onSubmit={submit}
              style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                alignItems: 'end',
              }}
            >
              <div style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: C.mid }}>Size</span>
                <PremiumSelect
                  ariaLabel="Size"
                  value={chosen}
                  onChange={(v) => setSize(String(v))}
                  options={[
                    ...standard.map((s) => ({ value: s, label: s })),
                    { value: OTHER, label: 'Other (type it)' },
                  ]}
                  height={36}
                  fontSize={13}
                  fullWidth
                />
              </div>
              {chosen === OTHER && (
                <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.mid }}>
                  Custom size
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    maxLength={40}
                    style={input}
                  />
                </label>
              )}
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.mid }}>
                Colour (optional)
                <input
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                  maxLength={40}
                  style={input}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.mid }}>
                Barcode (optional)
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  maxLength={32}
                  inputMode="numeric"
                  style={input}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.mid }}>
                SKU (optional)
                <input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  maxLength={64}
                  style={input}
                />
              </label>
              <button type="submit" disabled={add.isPending} style={btn}>
                {add.isPending ? 'Adding...' : 'Add size'}
              </button>
            </form>
          </>
        )}
      </ListState>
    </section>
  );
}
