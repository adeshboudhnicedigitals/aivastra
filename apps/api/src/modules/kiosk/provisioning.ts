import { createHash, randomBytes } from 'node:crypto';
import { schema } from '@aivastra/db';
import type { FastifyInstance } from 'fastify';

const PAIRING_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join('');
}

export function generatePairingCode(): string {
  return randomBase32(10);
}

export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export async function createKioskDevice(
  app: FastifyInstance,
  widgetClientId: string,
  label: string,
): Promise<{ device: typeof schema.kioskDevices.$inferSelect; pairingCode: string }> {
  const pairingCode = generatePairingCode();
  const [device] = await app.db
    .insert(schema.kioskDevices)
    .values({
      widgetClientId,
      label,
      status: 'pending',
      pairingCodeHash: hashPairingCode(pairingCode),
      pairingCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    .returning();

  return { device, pairingCode };
}
