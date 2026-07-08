import { createLogger } from '@aivastra/logger';
import { describe, expect, it, vi } from 'vitest';
import { writeWidgetKeyMetafield } from '../src/modules/shopify/metafields.js';

const log = createLogger('test');

describe('writeWidgetKeyMetafield', () => {
  it('POSTs the widget key as a shop metafield', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return { ok: true, status: 201 } as Response;
    });

    await writeWidgetKeyMetafield(
      'shop.myshopify.com',
      'shpat_token',
      'wk-123',
      log,
      fakeFetch as unknown as typeof fetch,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/admin/api/');
    expect(calls[0].url).toContain('/metafields.json');
    expect(calls[0].body).toEqual({
      metafield: {
        namespace: 'aivastra',
        key: 'widget_key',
        value: 'wk-123',
        type: 'single_line_text_field',
      },
    });
  });

  it('does not throw when the request fails', async () => {
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    await expect(
      writeWidgetKeyMetafield(
        'shop.myshopify.com',
        'shpat_token',
        'wk-123',
        log,
        fakeFetch as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });

  it('does not throw when fetch itself rejects', async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      writeWidgetKeyMetafield(
        'shop.myshopify.com',
        'shpat_token',
        'wk-123',
        log,
        fakeFetch as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });
});
