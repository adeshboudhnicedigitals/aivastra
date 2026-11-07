import { describe, expect, it } from 'vitest';
import {
  AdminMerchantUpdateBody,
  SHOPIFY_REFUSAL_EVENT_TYPES,
  ShopifyCustomerJobRequest,
  ShopifyStoreLimitsPatch,
  storeUrlSchema,
} from './widget.js';

const base = { customerPhotoKey: 'k', shopifyProductId: 1 };

describe('ShopifyStoreLimitsPatch.loginRequired', () => {
  it('accepts booleans and rejects other values', () => {
    expect(ShopifyStoreLimitsPatch.parse({ loginRequired: true })).toEqual({ loginRequired: true });
    expect(ShopifyStoreLimitsPatch.parse({ loginRequired: false })).toEqual({
      loginRequired: false,
    });
    expect(ShopifyStoreLimitsPatch.safeParse({ loginRequired: 'yes' }).success).toBe(false);
    expect(ShopifyStoreLimitsPatch.safeParse({ loginRequired: null }).success).toBe(false);
  });
});

describe('ShopifyCustomerJobRequest.phone', () => {
  it('is optional', () => {
    expect(ShopifyCustomerJobRequest.safeParse(base).success).toBe(true);
  });
  it('trims and accepts a valid phone', () => {
    const r = ShopifyCustomerJobRequest.parse({ ...base, phone: '  +91 98765-43210 ' });
    expect(r.phone).toBe('+91 98765-43210');
  });
  it.each(['', '123456', 'call me', '+()- .'])('rejects %j', (phone) => {
    expect(ShopifyCustomerJobRequest.safeParse({ ...base, phone }).success).toBe(false);
  });
});

describe('refusal event types', () => {
  it('include the login and contact gates', () => {
    expect(SHOPIFY_REFUSAL_EVENT_TYPES).toContain('refused_login_gate');
    expect(SHOPIFY_REFUSAL_EVENT_TYPES).toContain('refused_contact_gate');
  });
});

describe('storeUrlSchema (shared by admin merchant update and merchant brand update)', () => {
  const nullableOptional = storeUrlSchema.nullable().optional();
  it('accepts http(s) URLs and null/undefined via the admin wrapper', () => {
    expect(storeUrlSchema.safeParse('https://shop.example.com').success).toBe(true);
    expect(storeUrlSchema.safeParse('http://shop.example.com').success).toBe(true);
    expect(nullableOptional.safeParse(null).success).toBe(true);
    expect(nullableOptional.safeParse(undefined).success).toBe(true);
    expect(storeUrlSchema.safeParse(null).success).toBe(false);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'ftp://x.com',
    `https://x.com/${'a'.repeat(490)}`,
    '',
  ])('rejects %s', (v) => {
    expect(storeUrlSchema.safeParse(v).success).toBe(false);
    expect(AdminMerchantUpdateBody.safeParse({ storeUrl: v }).success).toBe(false);
  });
  it('keeps the http(s) refine message on the admin body', () => {
    const r = AdminMerchantUpdateBody.safeParse({ storeUrl: 'ftp://x.com' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('must be an http(s) URL');
  });
});
