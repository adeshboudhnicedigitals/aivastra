import { Badge, BlockStack, Button, InlineStack, Text, Thumbnail } from '@shopify/polaris';
import { DeleteIcon } from '@shopify/polaris-icons';
import type { ShopifyProductListItem } from '../../types';

const STATUS_TONE: Record<string, 'success' | 'attention' | 'critical'> = {
  active: 'success',
  processing: 'attention',
  failed: 'critical',
};

/** One product with a remove (trash) button, shared by both step 1 lists. */
export function ProductRow({
  item,
  onRemove,
  removing = false,
}: {
  item: ShopifyProductListItem;
  onRemove: () => void;
  removing?: boolean;
}) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Thumbnail source={item.thumbnailUrl} alt={item.title ?? 'Product'} size="small" />
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">
            {item.title}
          </Text>
          <Text as="span" tone="subdued" variant="bodySm">
            {[item.productType, item.vendor].filter(Boolean).join(' · ') || '—'}
          </Text>
        </BlockStack>
      </InlineStack>
      <InlineStack gap="200" blockAlign="center" wrap={false}>
        <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
        <Button
          icon={DeleteIcon}
          variant="tertiary"
          tone="critical"
          loading={removing}
          accessibilityLabel={`Remove ${item.title ?? 'product'}`}
          onClick={onRemove}
        />
      </InlineStack>
    </InlineStack>
  );
}
