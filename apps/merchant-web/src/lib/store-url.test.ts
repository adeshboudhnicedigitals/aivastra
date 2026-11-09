import { describe, expect, it } from 'vitest';
import { toStoreUrlPayload, validateStoreUrl } from './store-url';

describe('validateStoreUrl', () => {
  it('accepts empty or whitespace (meaning clear)', () => {
    expect(validateStoreUrl('')).toBeNull();
    expect(validateStoreUrl('   ')).toBeNull();
  });
  it('accepts http and https URLs', () => {
    expect(validateStoreUrl('http://x.com')).toBeNull();
    expect(validateStoreUrl('https://x.com/a')).toBeNull();
    expect(validateStoreUrl('  https://x.com/a  ')).toBeNull();
  });
  it('rejects other schemes', () => {
    expect(validateStoreUrl('javascript:alert(1)')).toEqual(expect.any(String));
    expect(validateStoreUrl('data:text/html,x')).toEqual(expect.any(String));
    expect(validateStoreUrl('ftp://x')).toEqual(expect.any(String));
  });
  it('rejects unparseable input', () => {
    expect(validateStoreUrl('not a url')).toEqual(expect.any(String));
  });
  it('rejects more than 500 characters', () => {
    const long = `https://x.com/${'a'.repeat(487)}`;
    expect(long.length).toBe(501);
    expect(validateStoreUrl(long)).toEqual(expect.any(String));
    expect(validateStoreUrl(long.slice(0, 500))).toBeNull();
  });
});

describe('toStoreUrlPayload', () => {
  it('trims and maps empty to null', () => {
    expect(toStoreUrlPayload('  https://x.com ')).toBe('https://x.com');
    expect(toStoreUrlPayload('')).toBeNull();
    expect(toStoreUrlPayload('   ')).toBeNull();
  });
});
