import type { FastifyBaseLogger } from 'fastify';
import { SHOPIFY_API_VERSION } from './service.js';

export async function writeWidgetKeyMetafield(
  shop: string,
  accessToken: string,
  widgetKey: string,
  log: FastifyBaseLogger,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  try {
    const res = await fetchFn(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/metafields.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metafield: {
          namespace: 'aivastra',
          key: 'widget_key',
          value: widgetKey,
          type: 'single_line_text_field',
        },
      }),
    });
    if (!res.ok) {
      log.error({ shop, status: res.status }, 'failed to write widget_key metafield');
    }
  } catch (err) {
    log.error({ err, shop }, 'failed to write widget_key metafield');
  }
}
