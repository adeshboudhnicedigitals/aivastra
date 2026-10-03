import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveImageUrl } from './images';

function setLocation(hostname: string, origin: string) {
  vi.stubGlobal('window', { location: { hostname, origin } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveImageUrl', () => {
  it('routes a loopback URL through the same-origin /minio proxy when the page is not itself loopback', () => {
    setLocation('wispy-plaza-mullets.ngrok-free.dev', 'https://wispy-plaza-mullets.ngrok-free.dev');
    expect(resolveImageUrl('http://127.0.0.1:9000/bucket/key.jpg?sig=abc')).toBe(
      'https://wispy-plaza-mullets.ngrok-free.dev/minio/bucket/key.jpg?sig=abc',
    );
  });

  it('leaves a loopback URL alone when the page itself is loopback (plain local dev)', () => {
    setLocation('localhost', 'http://localhost:5174');
    expect(resolveImageUrl('http://127.0.0.1:9000/bucket/key.jpg')).toBe(
      'http://127.0.0.1:9000/bucket/key.jpg',
    );
  });

  it('leaves a non-loopback URL alone (production R2/MinIO)', () => {
    setLocation('wispy-plaza-mullets.ngrok-free.dev', 'https://wispy-plaza-mullets.ngrok-free.dev');
    expect(resolveImageUrl('https://app.aivastra.com/minio/bucket/key.jpg')).toBe(
      'https://app.aivastra.com/minio/bucket/key.jpg',
    );
  });

  it('returns the input unchanged if it is not a valid URL', () => {
    setLocation('wispy-plaza-mullets.ngrok-free.dev', 'https://wispy-plaza-mullets.ngrok-free.dev');
    expect(resolveImageUrl('not-a-url')).toBe('not-a-url');
  });
});
