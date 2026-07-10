import { Banner, Page, Select, TextField, Thumbnail } from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePickerModal } from '../components/ImagePickerModal';
import { apiFetch } from '../lib/api';
import { STATUS_BADGE_BG, STATUS_BADGE_TEXT, STATUS_DOT_COLOR } from '../lib/statusColors';
import type { FunnelTemplateItem, ShopifyProductListItem } from '../types';

type DisplayStatus = 'active' | 'processing' | 'failed' | 'disabled';

// Reconciles two independent real-data axes (sync `status` and the `enabled`
// toggle) into the single status bucket shown in the UI: a disabled product
// always reads as "Disabled", regardless of its underlying sync status.
function displayStatus(item: ShopifyProductListItem): DisplayStatus {
  if (!item.enabled || item.status === 'deleted') return 'disabled';
  return item.status as DisplayStatus;
}

const STATUS_LABEL: Record<DisplayStatus, string> = {
  active: 'Active',
  processing: 'Processing',
  failed: 'Failed',
  disabled: 'Disabled',
};

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Processing', value: 'processing' },
  { label: 'Failed', value: 'failed' },
  { label: 'Disabled', value: 'disabled' },
];

function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        borderRadius: 'var(--p-border-radius-full)',
        fontSize: '12px',
        fontWeight: 600,
        background: STATUS_BADGE_BG[status],
        color: STATUS_BADGE_TEXT[status],
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: STATUS_DOT_COLOR[status],
        }}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function ProductsPage() {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerProductId, setPickerProductId] = useState<number | null>(null);
  const [funnelTemplates, setFunnelTemplates] = useState<FunnelTemplateItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredItems = useMemo(() => {
    return items
      .filter((item) => statusFilter === 'all' || displayStatus(item) === statusFilter)
      .filter((item) => (item.title ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
  }, [items, statusFilter, searchQuery]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100'),
      apiFetch<{ items: FunnelTemplateItem[] }>('/v1/shopify/funnel-templates'),
    ])
      .then(([products, funnels]) => {
        setItems(products.items);
        setFunnelTemplates(funnels.items);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleEnabled(shopifyProductId: number, enabled: boolean) {
    setError(null);
    try {
      const updated = await apiFetch<ShopifyProductListItem>(
        `/v1/shopify/products/${shopifyProductId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        },
      );
      setItems((prev) => prev.map((p) => (p.shopifyProductId === shopifyProductId ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function selectImage(shopifyProductId: number, src: string) {
    setError(null);
    try {
      const updated = await apiFetch<ShopifyProductListItem>(
        `/v1/shopify/products/${shopifyProductId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ garmentImageUrl: src }),
        },
      );
      setItems((prev) => prev.map((p) => (p.shopifyProductId === shopifyProductId ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPickerProductId(null);
    }
  }

  async function setFunnel(shopifyProductId: number, funnelTemplateId: string | null) {
    setError(null);
    try {
      await apiFetch(`/v1/shopify/products/${shopifyProductId}/funnel`, {
        method: 'PATCH',
        body: JSON.stringify({ funnelTemplateId }),
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Page title="Products" subtitle="Manage which products show the AiVastra try-on widget.">
      {error && (
        <Banner tone="critical" title="Something went wrong">
          {error}
        </Banner>
      )}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Search products"
            labelHidden
            autoComplete="off"
            placeholder="Search products"
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>
        <div style={{ width: '200px' }}>
          <Select
            label="Status"
            labelHidden
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </div>
      </div>

      <div
        style={{
          background: 'var(--p-color-bg-surface)',
          borderRadius: 'var(--p-border-radius-300)',
          boxShadow: 'var(--p-shadow-100)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '10px 16px',
            borderBottom: '1px solid var(--p-color-border-secondary)',
            color: 'var(--p-color-text-secondary)',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <div style={{ flex: '1 1 auto' }}>Product</div>
          <div style={{ width: '120px' }}>Status</div>
          <div style={{ width: '140px' }}>Try-on enabled</div>
          <div style={{ width: '220px' }}>Funnel</div>
        </div>

        {loading && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--p-color-text-secondary)',
              fontSize: '13px',
            }}
          >
            Loading products…
          </div>
        )}

        {!loading &&
          filteredItems.map((item) => (
            <div
              key={item.shopifyProductId}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px 16px',
                borderBottom: '1px solid var(--p-color-border-secondary)',
                gap: '12px',
              }}
            >
              <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Thumbnail source={item.thumbnailUrl} alt={item.title ?? ''} size="small" />
                <div>
                  <div style={{ fontSize: '13.5px', fontWeight: 500 }}>{item.title}</div>
                  <button
                    type="button"
                    onClick={() => setPickerProductId(item.shopifyProductId)}
                    style={{ marginTop: '2px', fontSize: '12px' }}
                  >
                    Change image
                  </button>
                </div>
              </div>
              <div style={{ width: '120px' }}>
                <StatusBadge status={displayStatus(item)} />
              </div>
              <div style={{ width: '140px' }}>
                <input
                  type="checkbox"
                  checked={item.enabled}
                  disabled={item.status !== 'active' && !item.enabled}
                  title={item.status !== 'active' ? 'Waiting for product sync' : undefined}
                  onChange={(e) => toggleEnabled(item.shopifyProductId, e.target.checked)}
                />
              </div>
              <div style={{ width: '220px' }}>
                <select
                  value={item.funnelTemplateId ?? ''}
                  onChange={(e) => setFunnel(item.shopifyProductId, e.target.value || null)}
                >
                  <option value="">Automated (no manual pin)</option>
                  {funnelTemplates.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}

        {!loading && filteredItems.length === 0 && (
          <div
            style={{
              padding: '28px',
              textAlign: 'center',
              color: 'var(--p-color-text-secondary)',
              fontSize: '13px',
            }}
          >
            No products match your search.
          </div>
        )}
      </div>

      {pickerProductId !== null && (
        <ImagePickerModal
          shopifyProductId={pickerProductId}
          onClose={() => setPickerProductId(null)}
          onSelect={(src) => selectImage(pickerProductId, src)}
        />
      )}
    </Page>
  );
}
