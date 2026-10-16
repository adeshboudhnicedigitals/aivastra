import { Writable } from 'node:stream';
import { createLogger, redactUrl, requestSerializers } from '@aivastra/logger';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

describe('redactUrl', () => {
  it('blanks the WhatsApp verify token (both spellings Meta sends) and keeps the challenge', () => {
    expect(
      redactUrl(
        '/v1/whatsapp/webhook?hub.mode=subscribe&hub.challenge=719161199&hub.verify_token=s3cret&hub_verify_token=s3cret',
      ),
    ).toBe(
      '/v1/whatsapp/webhook?hub.mode=subscribe&hub.challenge=719161199&hub.verify_token=[redacted]&hub_verify_token=[redacted]',
    );
  });

  it('blanks email-verification and OAuth-style credentials', () => {
    expect(redactUrl('/v1/auth/verify-email?token=abc')).toBe(
      '/v1/auth/verify-email?token=[redacted]',
    );
    expect(redactUrl('/cb?code=x&state=y&hmac=z')).toBe(
      '/cb?code=[redacted]&state=y&hmac=[redacted]',
    );
    // Percent-encoded names must not slip past the match.
    expect(redactUrl('/w?hub%2Everify_token=s3cret')).toBe('/w?hub%2Everify_token=[redacted]');
  });

  it('leaves URLs without sensitive params untouched', () => {
    expect(redactUrl('/health')).toBe('/health');
    expect(redactUrl('/v1/catalog/lower?page=2&q=jeans')).toBe('/v1/catalog/lower?page=2&q=jeans');
  });
});

describe('request logging', () => {
  it('createLogger wires the redacting req serializer', () => {
    // pino keeps serializers behind a symbol; pino isn't a direct dependency here,
    // so find it by description rather than importing pino.symbols.
    const logger = createLogger('test') as unknown as Record<symbol, Record<string, unknown>>;
    const sym = Object.getOwnPropertySymbols(logger).find(
      (s) => s.description === 'pino.serializers',
    );
    expect(sym && logger[sym]?.req).toBe(requestSerializers.req);
  });

  it("Fastify's incoming-request log line does not carry the verify token", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    // Fastify merges its default serializers *under* the instance's own, which is
    // the precedence production relies on (createLogger -> loggerInstance).
    const app = Fastify({ logger: { serializers: requestSerializers, stream: sink } });
    app.get('/v1/whatsapp/webhook', async () => 'ok');

    await app.inject({
      method: 'GET',
      url: '/v1/whatsapp/webhook?hub.mode=subscribe&hub.challenge=1&hub.verify_token=s3cret-value',
    });
    await app.close();

    const out = lines.join('');
    expect(out).toContain('hub.verify_token=[redacted]');
    expect(out).not.toContain('s3cret-value');
  });
});
