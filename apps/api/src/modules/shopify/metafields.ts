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
