import { Banner, Button, Page, Select, TextField, Thumbnail } from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

function StatusBadge({
  status,
  disabled,
  title,
  onClick,
}: {
  status: DisplayStatus;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '3px 10px',
        border: 'none',
        borderRadius: 'var(--p-border-radius-full)',
        fontSize: '12px',
        fontWeight: 600,
        background: STATUS_BADGE_BG[status],
        color: STATUS_BADGE_TEXT[status],
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
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
    </button>
  );
}

export default function ProductsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [funnelTemplates, setFunnelTemplates] = useState<FunnelTemplateItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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

  const refreshProducts = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      await apiFetch('/v1/shopify/products/sync', { method: 'POST' });
      setSyncMessage(
        'Refreshing your catalog from Shopify — this can take a minute for large stores.',
      );
      // Sync runs async on the server (Redis-queued, paginated against Shopify's
      // Admin API) — nothing to await here. Re-poll the list once, giving a
      // typical single-page catalog time to land before showing it.
      setTimeout(() => {
        load();
        setSyncing(false);
      }, 4000);
    } catch (err) {
      setError((err as Error).message);
      setSyncing(false);
    }
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
    <Page
      title="Products"
      subtitle="Manage which products show the AiVastra try-on widget."
      primaryAction={{
        content: 'Refresh',
        onAction: refreshProducts,
        loading: syncing,
      }}
    >
      {error && (
        <Banner tone="critical" title="Something went wrong">
          {error}
        </Banner>
      )}
      {syncMessage && !error && (
        <Banner tone="info" onDismiss={() => setSyncMessage(null)}>
          {syncMessage}
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
          <div style={{ width: '140px' }}>Status</div>
          <div style={{ width: '220px' }}>Funnel</div>
          <div style={{ width: '120px' }}>Images</div>
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
                <div style={{ fontSize: '13.5px', fontWeight: 500 }}>{item.title}</div>
              </div>
              <div style={{ width: '140px' }}>
                <StatusBadge
                  status={displayStatus(item)}
                  disabled={item.status !== 'active' && !item.enabled}
                  title={item.status !== 'active' ? 'Waiting for product sync' : undefined}
                  onClick={() => toggleEnabled(item.shopifyProductId, !item.enabled)}
                />
              </div>
              <div style={{ width: '220px' }}>
                <select
                  value={item.funnelTemplateId ?? ''}
                  onChange={(e) => setFunnel(item.shopifyProductId, e.target.value || null)}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 'var(--p-border-radius-200)',
                    border: '1px solid var(--p-color-border)',
                    background: 'var(--p-color-bg-surface)',
                    color: 'var(--p-color-text)',
                    fontSize: '13px',
                  }}
                >
                  <option value="">Automated (no manual pin)</option>
                  {funnelTemplates.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: '120px' }}>
                <Button
                  size="slim"
                  onClick={() => navigate(`/generated-images?productId=${item.shopifyProductId}`)}
                >
                  View images
                </Button>
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
    </Page>
  );
}
