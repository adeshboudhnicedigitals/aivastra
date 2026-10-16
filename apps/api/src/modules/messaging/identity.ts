import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { DB } from '@aivastra/db';
import { schema } from '@aivastra/db';
import type { MessagingAccount } from '@aivastra/types';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../lib/errors.js';

type RedisClient = FastifyInstance['redis'];
const M = schema.messagingAccounts;
export type MessagingAccountRow = typeof M.$inferSelect;

export const CHANNEL_WHATSAPP = 'whatsapp' as const;
export type Channel = typeof CHANNEL_WHATSAPP;

// Chat-started tokens outlive web codes: the seller may have to register and
// verify their email before reaching the confirm page (T4). A token is not a
// credential — the confirm page requires the normal web login — so a longer
// life costs little.
export const CHAT_TOKEN_TTL_SECONDS = 30 * 60;
export const WEB_CODE_TTL_SECONDS = 10 * 60;
const CHAT_TOKEN_PREFIX = 'msg:connect:chat:';
const WEB_CODE_PREFIX = 'msg:connect:web:';
// No I, L, O, 0, 1: the code may be read off a screen and typed by hand when
// wa.me cannot prefill it. 31^8 ≈ 8.5e11 combinations against a 10-minute life
// and the inbound per-sender rate limit (plan 3).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export type ChatTokenPayload = { channel: Channel; externalId: string };
export type ConnectInput = {
  channel: Channel;
  externalId: string;
  userId: string;
  linkedVia: 'chat_link' | 'web_code';
};

// Only the hash is ever a Redis key, so a Redis dump does not hand out live links.
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const connectTokenExpired = () =>
  new AppError(
    'CONNECT_TOKEN_EXPIRED',
    410,
    'This link has expired or was already used. Send any message to the Aivastra WhatsApp number to get a new one.',
  );

export const numberInUse = () =>
  new AppError(
    'NUMBER_IN_USE',
    409,
    'This WhatsApp number is connected to another Aivastra account. Disconnect it there first.',
  );

/** WhatsApp sends `wa_id` as bare digits ('919109516207'); stored as E.164. */
export function toE164FromWaId(waId: string): string {
  const digits = waId.replace(/\D/g, '');
  // E.164 allows at most 15 digits; nothing real is shorter than 8.
  if (digits.length < 8 || digits.length > 15) {
    throw new AppError('VALIDATION', 400, 'invalid WhatsApp number');
  }
  return `+${digits}`;
}

/** '+919109516207' → '+9191•••••207'. A forwarded connect link must not reveal the full number. */
export function maskPhone(e164: string): string {
  if (e164.length <= 8) return e164;
  return `${e164.slice(0, 5)}${'•'.repeat(e164.length - 8)}${e164.slice(-3)}`;
}

/**
 * D29: compares the WhatsApp number's last 10 digits with users.phone, which
 * PATCH /v1/me holds to exactly 10 digits with no country code — so this
 * assumes Indian numbers, which is all the profile field can hold today.
 */
export function matchesProfilePhone(e164: string, profilePhone: string | null): boolean {
  if (!profilePhone) return false;
  const profile = profilePhone.replace(/\D/g, '');
  if (profile.length !== 10) return false;
  return e164.replace(/\D/g, '').slice(-10) === profile;
}

export function waConnectLink(displayNumber: string, code: string): string {
  return `https://wa.me/${displayNumber}?text=${encodeURIComponent(`CONNECT ${code}`)}`;
}

export function chatConnectUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/+$/, '')}/connect/whatsapp?t=${encodeURIComponent(token)}`;
}

/** 'CONNECT ab2cd3ef' → 'AB2CD3EF'; anything else → null. */
export function parseConnectCommand(text: string): string | null {
  const match = /^\s*connect\s+([a-z0-9]+)\s*$/i.exec(text);
  return match ? match[1].toUpperCase() : null;
}

export async function createChatConnectToken(
  redis: RedisClient,
  externalId: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const payload: ChatTokenPayload = { channel: CHANNEL_WHATSAPP, externalId };
  await redis.set(
    CHAT_TOKEN_PREFIX + sha256(token),
    JSON.stringify(payload),
    'EX',
    CHAT_TOKEN_TTL_SECONDS,
  );
  return token;
}

/** Read without consuming — the confirm page shows the number before the seller confirms. */
export async function peekChatConnectToken(
  redis: RedisClient,
  token: string,
): Promise<ChatTokenPayload | null> {
  const raw = await redis.get(CHAT_TOKEN_PREFIX + sha256(token));
  return raw ? (JSON.parse(raw) as ChatTokenPayload) : null;
}

/** GETDEL: atomic, so two confirm clicks can never both redeem one token. */
export async function consumeChatConnectToken(
  redis: RedisClient,
  token: string,
): Promise<ChatTokenPayload | null> {
  const raw = await redis.getdel(CHAT_TOKEN_PREFIX + sha256(token));
  return raw ? (JSON.parse(raw) as ChatTokenPayload) : null;
}

export async function createWebConnectCode(redis: RedisClient, userId: string): Promise<string> {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  await redis.set(
    WEB_CODE_PREFIX + sha256(code),
    JSON.stringify({ userId }),
    'EX',
    WEB_CODE_TTL_SECONDS,
  );
  return code;
}

export async function consumeWebConnectCode(
  redis: RedisClient,
  code: string,
): Promise<{ userId: string } | null> {
  const raw = await redis.getdel(WEB_CODE_PREFIX + sha256(code.trim().toUpperCase()));
  return raw ? (JSON.parse(raw) as { userId: string }) : null;
}

/**
 * Idempotent for the same user; NUMBER_IN_USE for a different one. Insert-first
 * on the unique index instead of select-then-insert, so two concurrent connects
 * of one number can never both succeed.
 */
export async function connectAccount(
  db: DB,
  input: ConnectInput,
): Promise<{ account: MessagingAccountRow; created: boolean }> {
  const [inserted] = await db
    .insert(M)
    .values({
      channel: input.channel,
      externalId: input.externalId,
      userId: input.userId,
      linkedVia: input.linkedVia,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { account: inserted, created: true };

  const existing = await findAccountByExternalId(db, input.channel, input.externalId);
  if (!existing || existing.userId !== input.userId) throw numberInUse();
  return { account: existing, created: false };
}

export async function findAccountByExternalId(
  db: DB,
  channel: Channel,
  externalId: string,
): Promise<MessagingAccountRow | null> {
  const [row] = await db
    .select()
    .from(M)
    .where(and(eq(M.channel, channel), eq(M.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

export async function listAccounts(db: DB, userId: string): Promise<MessagingAccountRow[]> {
  return db.select().from(M).where(eq(M.userId, userId)).orderBy(asc(M.createdAt));
}

/** Deletes the row (and with it the stored number). Scoped to the owner. */
export async function disconnectAccount(db: DB, userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(M)
    .where(and(eq(M.id, id), eq(M.userId, userId)))
    .returning({ id: M.id });
  return deleted.length > 0;
}

export function toMessagingAccountDto(row: MessagingAccountRow): MessagingAccount {
  return {
    id: row.id,
    channel: row.channel as Channel,
    externalId: row.externalId,
    optedOut: row.optedOutAt !== null,
    connectedAt: row.createdAt.toISOString(),
  };
}
