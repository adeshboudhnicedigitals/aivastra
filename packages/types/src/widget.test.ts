import { describe, expect, it } from 'vitest';
import {
  SHOPIFY_REFUSAL_EVENT_TYPES,
  ShopifyCustomerJobRequest,
  ShopifyStoreLimitsPatch,
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
