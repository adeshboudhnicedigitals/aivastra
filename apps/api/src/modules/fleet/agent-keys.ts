import { createHash, randomBytes } from 'node:crypto';
import { FLEET_AGENT_KEY_PREFIX, FLEET_ENROLL_TOKEN_PREFIX } from '@aivastra/types';

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateAgentKey(): { key: string; keyHash: string; keyPrefix: string } {
  const key = FLEET_AGENT_KEY_PREFIX + randomBytes(32).toString('base64url');
  // The first characters are random, so the prefix identifies a key in the list without
  // being enough to use it.
  return { key, keyHash: hashAgentKey(key), keyPrefix: key.slice(0, 11) };
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7) || undefined;
}

/** Enrolment tokens share the key format and hashing; only the prefix differs ("fe_"). */
export function generateEnrollToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = FLEET_ENROLL_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, tokenHash: hashAgentKey(token), tokenPrefix: token.slice(0, 11) };
}
