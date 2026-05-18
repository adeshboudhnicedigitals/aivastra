import { hash, verify, Algorithm } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, createHash } from 'node:crypto';

export const ARGON: Parameters<typeof hash>[1] = {
  algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1,
};

export async function hashPassword(pw: string) { return hash(pw, ARGON); }
export async function verifyPassword(stored: string, pw: string) {
  try { return await verify(stored, pw); } catch { return false; }
}

export async function signAccess(secret: Uint8Array, sub: string, claims: Record<string, unknown>, exp: string) {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setIssuedAt().setExpirationTime(exp).sign(secret);
}
export async function verifyAccess(secret: Uint8Array, token: string) {
  return (await jwtVerify(token, secret)).payload;
}

export function newRefreshToken(): { plain: string; hash: string } {
  const plain = randomBytes(48).toString('base64url');
  return { plain, hash: createHash('sha256').update(plain).digest('hex') };
}
export const hashRefresh = (plain: string) => createHash('sha256').update(plain).digest('hex');
