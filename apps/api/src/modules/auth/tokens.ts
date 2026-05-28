import { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';
import { newRefreshToken, signAccess } from './service.js';

export async function issueTokens(
  app: FastifyInstance,
  userId: string,
  reply: any,
  status: number,
) {
  const secret = new TextEncoder().encode(app.env.JWT_SECRET);
  const accessToken = await signAccess(secret, userId, { kind: 'access' }, app.env.JWT_EXPIRY);
  const r = newRefreshToken();
  const expiresAt = new Date(Date.now() + parseDuration(app.env.REFRESH_TOKEN_EXPIRY));
  await app.db.insert(schema.refreshTokens).values({ userId, tokenHash: r.hash, expiresAt });
  reply.setCookie('refresh', r.plain, {
    httpOnly: true,
    secure: app.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/v1/auth',
    expires: expiresAt,
    signed: false,
  });
  reply.code(status);
  return { accessToken };
}

export function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) throw new Error(`bad duration: ${s}`);
  const n = Number(m[1]);
  return (
    n * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[m[2]!]!
  );
}
