import {
  Badge,
  Banner,
  IndexTable,
  Page,
  Thumbnail,
  useIndexResourceState,
} from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import { ImagePickerModal } from '../components/ImagePickerModal';
import { apiFetch } from '../lib/api';
import type { ShopifyProductListItem } from '../types';

const STATUS_TONE: Record<string, 'success' | 'attention' | 'critical'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
};

export default function ProductsPage() {
  const [items, setItems] = useState<ShopifyProductListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerProductId, setPickerProductId] = useState<number | null>(null);
  const { selectedResources } = useIndexResourceState(
    items.map((i) => ({ id: String(i.shopifyProductId) })),
  );

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<{ items: ShopifyProductListItem[] }>('/v1/shopify/products?pageSize=100')
      .then((data) => setItems(data.items))
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

  return (
    <Page title="Products">
      {error && (
        <Banner tone="critical" title="Something went wrong">
          {error}
        </Banner>
      )}
      <IndexTable
        resourceName={{ singular: 'product', plural: 'products' }}
        itemCount={items.length}
        selectedItemsCount={selectedResources.length}
        headings={[
          { title: 'Image' },
          { title: 'Title' },
          { title: 'Status' },
          { title: 'Try-on enabled' },
        ]}
        loading={loading}
      >
        {items.map((item, index) => (
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
              <Badge tone={STATUS_TONE[item.status] ?? 'attention'}>{item.status}</Badge>
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
