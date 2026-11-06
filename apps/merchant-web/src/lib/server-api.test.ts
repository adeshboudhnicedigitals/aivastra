import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { forwardedIpHeaders } from './server-api';

describe('forwardedIpHeaders', () => {
  it('forwards cf-connecting-ip when present', () => {
    const req = new NextRequest('http://localhost:3010/x', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(forwardedIpHeaders(req)).toEqual({ 'cf-connecting-ip': '203.0.113.7' });
  });

  it('returns no headers when absent', () => {
    expect(forwardedIpHeaders(new NextRequest('http://localhost:3010/x'))).toEqual({});
  });
});
