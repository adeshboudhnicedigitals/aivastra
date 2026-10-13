import { schema } from '@aivastra/db';
import {
  type ChatConnectConfirmResponse,
  type ChatConnectPreviewResponse,
  ChatConnectTokenBody,
  type MessagingAccountsResponse,
  type WebConnectCodeResponse,
} from '@aivastra/types';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  connectAccount,
  connectTokenExpired,
  consumeChatConnectToken,
  createWebConnectCode,
  disconnectAccount,
  findAccountByExternalId,
  listAccounts,
  maskPhone,
  matchesProfilePhone,
  numberInUse,
  peekChatConnectToken,
  toMessagingAccountDto,
  WEB_CODE_TTL_SECONDS,
  waConnectLink,
} from './identity.js';

function assertEnabled(app: FastifyInstance) {
  // `=== true`, not truthiness: tests build Env directly and leave the flag undefined.
  if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) {
    throw new AppError('NOT_FOUND', 404, 'not found');
  }
}

/**
 * Web side of connecting a WhatsApp number (spec section 7). Both directions end
 * in one messaging_accounts row. Tokens and codes travel in request bodies, never
 * URLs, so the request log never records a live one.
 */
export async function messagingConnectRoutes(app: FastifyInstance) {
  // The one route that answers with the flag off: the web asks it to decide
  // whether to show any WhatsApp UI at all.
  app.get(
    '/v1/messaging/accounts',
    { preHandler: app.requireUser },
    async (req): Promise<MessagingAccountsResponse> => {
      if (app.env.MESSAGING_WHATSAPP_ENABLED !== true) return { enabled: false, accounts: [] };
      const rows = await listAccounts(app.db, req.userId);
      return { enabled: true, accounts: rows.map(toMessagingAccountDto) };
    },
  );

  app.delete(
    '/v1/messaging/accounts/:id',
    { preHandler: app.requireUser, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      assertEnabled(app);
      const { id } = req.params as { id: string };
      const removed = await disconnectAccount(app.db, req.userId, id);
      if (!removed) throw new AppError('NOT_FOUND', 404, 'connected number not found');
      return reply.code(204).send();
    },
  );

  // Web-started: the seller taps "Connect WhatsApp", WhatsApp opens with
  // "CONNECT <code>" prefilled, and the inbound consumer (plan 3) redeems it
  // against the sender's number.
  app.post(
    '/v1/messaging/connect/web-code',
    {
      preHandler: app.requireUser,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req): Promise<WebConnectCodeResponse> => {
      assertEnabled(app);
      const displayNumber = app.env.WHATSAPP_DISPLAY_NUMBER;
      if (!displayNumber) {
        throw new AppError('NOT_CONFIGURED', 503, 'WhatsApp connection is not configured');
      }
      const code = await createWebConnectCode(app.redis, req.userId);
      return {
        code,
        displayNumber,
        waLink: waConnectLink(displayNumber, code),
        expiresInSeconds: WEB_CODE_TTL_SECONDS,
      };
    },
  );

  // Chat-started, step 1: show which number is about to be connected, without
  // consuming the token, so a seller who backs out can still use the link.
  app.post(
    '/v1/messaging/connect/chat/preview',
    {
      preHandler: app.requireUser,
      schema: { body: ChatConnectTokenBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<ChatConnectPreviewResponse> => {
      assertEnabled(app);
      const { token } = req.body as ChatConnectTokenBody;
      const payload = await peekChatConnectToken(app.redis, token);
      if (!payload) throw connectTokenExpired();

      const existing = await findAccountByExternalId(app.db, payload.channel, payload.externalId);
      if (existing && existing.userId !== req.userId) throw numberInUse();

      const [user] = await app.db
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(eq(schema.users.id, req.userId));
      const profilePhone = user?.phone ?? null;
      return {
        phoneMasked: maskPhone(payload.externalId),
        matchesProfile: matchesProfilePhone(payload.externalId, profilePhone),
        profilePhoneLast4: profilePhone ? profilePhone.slice(-4) : null,
        alreadyConnected: existing?.userId === req.userId,
      };
    },
  );

  // Chat-started, step 2. Consumed before connecting: a NUMBER_IN_USE failure
  // still burns the token, which is fine — the seller has to disconnect the
  // number elsewhere and ask the bot for a fresh link anyway.
  app.post(
    '/v1/messaging/connect/chat/confirm',
    {
      preHandler: app.requireUser,
      schema: { body: ChatConnectTokenBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req): Promise<ChatConnectConfirmResponse> => {
      assertEnabled(app);
      const { token } = req.body as ChatConnectTokenBody;
      const payload = await consumeChatConnectToken(app.redis, token);
      if (!payload) throw connectTokenExpired();
      const { account } = await connectAccount(app.db, {
        channel: payload.channel,
        externalId: payload.externalId,
        userId: req.userId,
        linkedVia: 'chat_link',
      });
      return { account: toMessagingAccountDto(account) };
    },
  );
}
