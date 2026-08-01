import type { ShopifyWidgetConfig } from '@aivastra/db';
import type { FastifyBaseLogger } from 'fastify';
import { shopifyAdminFetch } from './service.js';

export async function writeWidgetKeyMetafield(
  shop: string,
  accessToken: string,
  widgetKey: string,
  log: FastifyBaseLogger,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    const res = await shopifyAdminFetch(
      shop,
      accessToken,
      '/metafields.json',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metafield: {
            namespace: 'aivastra',
            key: 'widget_key',
            value: widgetKey,
            type: 'single_line_text_field',
          },
        }),
      },
      fetchFn,
    );
    if (!res.ok) {
      log.error({ shop, status: res.status }, 'failed to write widget_key metafield');
    }
  } catch (err) {
    log.error({ err, shop }, 'failed to write widget_key metafield');
  }
}

// GraphQL, not REST POST /metafields.json: that endpoint 422s when a metafield
// with the same namespace/key already exists. writeWidgetKeyMetafield above
// gets away with REST because it runs exactly once, at install. Widget config
// is re-saved every time the merchant edits it, so it needs a real upsert —
// which is what metafieldsSet is.
const METAFIELDS_SET = `
  mutation SetWidgetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

export async function writeWidgetConfigMetafield(
  shop: string,
  accessToken: string,
  shopifyShopId: number,
  config: ShopifyWidgetConfig,
  log: FastifyBaseLogger,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await shopifyAdminFetch(
      shop,
      accessToken,
      '/graphql.json',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: METAFIELDS_SET,
          variables: {
            metafields: [
              {
                ownerId: `gid://shopify/Shop/${shopifyShopId}`,
                namespace: 'aivastra',
                key: 'widget_config',
                type: 'json',
                value: JSON.stringify(config),
              },
            ],
          },
        }),
      },
      fetchFn,
    );

    if (!res.ok) {
      log.error({ shop, status: res.status }, 'failed to write widget_config metafield');
      return false;
    }

    // A GraphQL mutation can answer 200 and still have refused the write.
    const body = (await res.json()) as {
      data?: { metafieldsSet?: { userErrors?: { field: string[]; message: string }[] } };
      errors?: { message: string }[];
    };
    const metafieldsSet = body.data?.metafieldsSet;
    if (body.errors?.length || !metafieldsSet) {
      log.error({ shop, errors: body.errors }, 'shopify rejected widget_config metafield');
      return false;
    }

    const errors = metafieldsSet.userErrors ?? [];
    if (errors.length > 0) {
      log.error({ shop, errors }, 'shopify rejected widget_config metafield');
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err, shop }, 'failed to write widget_config metafield');
    return false;
  }
}
