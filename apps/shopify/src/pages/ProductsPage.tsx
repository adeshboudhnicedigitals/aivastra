import {
  Badge,
  Banner,
  IndexTable,
  Page,
  Select,
  TextField,
  Thumbnail,
  useIndexResourceState,
} from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePickerModal } from '../components/ImagePickerModal';
import { apiFetch } from '../lib/api';
import type { FunnelTemplateItem, ShopifyProductListItem } from '../types';

type DisplayStatus = 'active' | 'processing' | 'failed' | 'disabled';

// Reconciles two independent real-data axes (sync `status` and the `enabled`
// toggle) into the single status bucket shown in the UI: a disabled product
// always reads as "Disabled", regardless of its underlying sync status.
function displayStatus(item: ShopifyProductListItem): DisplayStatus {
  if (!item.enabled) return 'disabled';
  return item.status as DisplayStatus;
}

const STATUS_TONE: Record<DisplayStatus, 'success' | 'attention' | 'critical' | 'read-only'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
  disabled: 'read-only',
};

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

  const { selectedResources } = useIndexResourceState(
    filteredItems.map((i) => ({ id: String(i.shopifyProductId) })),
  );

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
    <Page title="Products">
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
      <IndexTable
        resourceName={{ singular: 'product', plural: 'products' }}
        itemCount={filteredItems.length}
        selectedItemsCount={selectedResources.length}
        headings={[
          { title: 'Image' },
          { title: 'Title' },
          { title: 'Status' },
          { title: 'Try-on enabled' },
          { title: 'Funnel' },
        ]}
        loading={loading}
      >
        {filteredItems.map((item, index) => (
          <IndexTable.Row
            id={String(item.shopifyProductId)}
            key={item.shopifyProductId}
            position={index}
          >
            <IndexTable.Cell>
              <Thumbnail source={item.thumbnailUrl} alt={item.title ?? ''} size="small" />
              <button
                type="button"
                onClick={() => setPickerProductId(item.shopifyProductId)}
                style={{ display: 'block', marginTop: '4px' }}
              >
                Change image
              </button>
            </IndexTable.Cell>
            <IndexTable.Cell>{item.title}</IndexTable.Cell>
            <IndexTable.Cell>
              <Badge tone={STATUS_TONE[displayStatus(item)]}>
                {STATUS_LABEL[displayStatus(item)]}
              </Badge>
            </IndexTable.Cell>
            <IndexTable.Cell>
              <input
                type="checkbox"
                checked={item.enabled}
                disabled={item.status !== 'active' && !item.enabled}
                title={item.status !== 'active' ? 'Waiting for product sync' : undefined}
                onChange={(e) => toggleEnabled(item.shopifyProductId, e.target.checked)}
              />
            </IndexTable.Cell>
            <IndexTable.Cell>
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
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
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
