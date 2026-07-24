import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl } from './ssrf-guard.js';

describe('assertPublicHttpUrl', () => {
  it('accepts a public IP literal', async () => {
    const url = await assertPublicHttpUrl('http://1.1.1.1/image.jpg');
    expect(url.hostname).toBe('1.1.1.1');
  });

  it('rejects loopback', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/x.jpg')).rejects.toThrow(/not allowed/);
  });

  it('rejects private 10.x', async () => {
    await expect(assertPublicHttpUrl('http://10.0.0.5/x.jpg')).rejects.toThrow(/not allowed/);
  });

  it('rejects private 192.168.x', async () => {
    await expect(assertPublicHttpUrl('http://192.168.1.1/x.jpg')).rejects.toThrow(/not allowed/);
  });

  it('rejects private 172.16-31.x', async () => {
    await expect(assertPublicHttpUrl('http://172.20.0.5/x.jpg')).rejects.toThrow(/not allowed/);
  });

  it('rejects link-local / cloud metadata address', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/x.jpg')).rejects.toThrow(
      /not allowed/,
    );
  });

  it('rejects IPv6 loopback', async () => {
    await expect(assertPublicHttpUrl('http://[::1]/x.jpg')).rejects.toThrow(/not allowed/);
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com/x.jpg')).rejects.toThrow(
      /only http\/https/,
    );
  });

  it('rejects a malformed URL', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/not a valid URL/);
  });
});
