import { randomInt } from 'node:crypto';
import { schema } from '@aivastra/db';
import type { IdentifyStartResponse, IdentifyStatusResponse } from '@aivastra/types';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { channelForMerchant, identifyBlockers } from './channel.js';

// CRM phase 2, Task 4: "Get these looks on WhatsApp" (spec §5, decision A1). The tablet asks for
// a code bound to its session; the shopper's phone sends `LOOKS <code>` to the brand's number;
// the inbound consumer (inbound.ts) redeems it. Codes live in Redis only, single use.

export const IDENTIFY_CODE_TTL_SECONDS = 15 * 60;
// A visit can be identified a little after it ended: the QR is on the last screen.
const ENDED_GRACE_MINUTES = 30;
// Same alphabet as the seller CONNECT code (messaging/identity.ts): no I, L, O, 0, 1.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const codeKey = (code: string) => `crm:identify:code:${code}`;
const sessionKey = (sessionId: string) => `crm:identify:session:${sessionId}`;
export const verifiedKey = (sessionId: string) => `crm:identify:verified:${sessionId}`;

export interface IdentifyTicket {
  sessionId: string;
  merchantId: string;
}

function newCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Atomically takes a code: it can be redeemed exactly once. */
export async function takeIdentifyCode(
  app: FastifyInstance,
  code: string,
): Promise<IdentifyTicket | null> {
  const raw = await app.redis.getdel(codeKey(code.trim().toUpperCase()));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdentifyTicket;
  } catch {
    return null;
  }
}

export async function deviceIdentifyRoutes(app: FastifyInstance) {
  const params = z.object({ id: z.string().uuid() });

  const ownSession = async (deviceId: string, sessionId: string) => {
    const [s] = await app.db
      .select({ id: schema.instoreSessions.id, merchantId: schema.instoreSessions.merchantId })
      .from(schema.instoreSessions)
      .where(
        and(
          eq(schema.instoreSessions.id, sessionId),
          eq(schema.instoreSessions.deviceId, deviceId),
          or(
            isNull(schema.instoreSessions.endedAt),
            gt(
              schema.instoreSessions.endedAt,
              sql`now() - make_interval(mins => ${ENDED_GRACE_MINUTES})`,
            ),
          ),
        ),
      )
      .limit(1);
    if (!s) throw new AppError('NOT_FOUND', 404, 'session not found');
    return s;
  };

  app.post(
    '/v1/device/sessions/:id/identify',
    {
      preHandler: app.requireDevice,
      schema: { params },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply): Promise<IdentifyStartResponse> => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const s = await ownSession(d.deviceId, id);
      const blockers = await identifyBlockers(app, d.merchantId);
      const channel = blockers.length === 0 ? await channelForMerchant(app.db, d.merchantId) : null;
      if (!channel) {
        // Not an error for the shopper: the tablet shows the QR download (mode C) instead.
        return reply.code(409).send({
          error: { code: 'IDENTIFY_UNAVAILABLE', message: 'WhatsApp delivery is not set up' },
          fallback: 'qr',
          blockers,
        }) as never;
      }
      // One live code per session: showing the QR again replaces the previous code.
      const previous = await app.redis.get(sessionKey(s.id));
      if (previous) await app.redis.del(codeKey(previous));
      let code = newCode();
      const ticket: IdentifyTicket = { sessionId: s.id, merchantId: s.merchantId };
      for (let i = 0; i < 5; i++) {
        const ok = await app.redis.set(
          codeKey(code),
          JSON.stringify(ticket),
          'EX',
          IDENTIFY_CODE_TTL_SECONDS,
          'NX',
        );
        if (ok === 'OK') break;
        code = newCode();
      }
      await app.redis.set(sessionKey(s.id), code, 'EX', IDENTIFY_CODE_TTL_SECONDS);
      return {
        code,
        waLink: `https://wa.me/${channel.displayNumber}?text=${encodeURIComponent(`LOOKS ${code}`)}`,
        expiresAt: new Date(Date.now() + IDENTIFY_CODE_TTL_SECONDS * 1000).toISOString(),
      };
    },
  );

  // The tablet polls this while the QR is up, to say "Sent! Check WhatsApp".
  app.get(
    '/v1/device/sessions/:id/identify',
    { preHandler: app.requireDevice, schema: { params } },
    async (req): Promise<IdentifyStatusResponse> => {
      const d = req.device!;
      const { id } = req.params as { id: string };
      const s = await ownSession(d.deviceId, id);
      if (await app.redis.get(verifiedKey(s.id))) return { status: 'verified' };
      const code = await app.redis.get(sessionKey(s.id));
      return { status: code && (await app.redis.exists(codeKey(code))) ? 'pending' : 'expired' };
    },
  );
}
