import { describe, expect, it } from 'vitest';
import { shopifyInstallNotifyHtml } from './mailer.js';

const base = {
  shopName: 'Asha Fashions',
  shopDomain: 'asha.myshopify.com',
  partnerDevelopment: false,
};

describe('shopifyInstallNotifyHtml', () => {
  it('shows phone, country and the store creation time in IST', () => {
    const html = shopifyInstallNotifyHtml({
      ...base,
      phone: '+91 98765 43210',
      country: 'India',
      // 12:15 UTC is 5:45 pm in India (UTC+5:30, no daylight saving).
      shopCreatedAt: '2026-11-13T12:15:00Z',
    });
    expect(html).toContain('+91 98765 43210');
    expect(html).toContain('India');
    expect(html).toContain('Store created');
    expect(html).toMatch(/13 Nov 2026, 5:45 pm IST/i);
  });

  it('rolls the date over when IST is already the next day', () => {
    // 20:00 UTC on the 13th is 1:30 am on the 14th in India.
    const html = shopifyInstallNotifyHtml({ ...base, shopCreatedAt: '2026-11-13T20:00:00Z' });
    expect(html).toMatch(/14 Nov 2026, 1:30 am IST/i);
  });

  it('omits the rows when Shopify gave nothing, and ignores a bad timestamp', () => {
    const html = shopifyInstallNotifyHtml({
      ...base,
      phone: null,
      country: '  ',
      shopCreatedAt: 'nonsense',
    });
    expect(html).not.toContain('>Phone<');
    expect(html).not.toContain('>Country<');
    expect(html).not.toContain('Store created');
  });
});
