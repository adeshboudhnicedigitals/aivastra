import type { R2Config } from './r2.js';

export interface UserStorageVars {
  USER_STORAGE_ENDPOINT?: string;
  USER_STORAGE_ACCESS_KEY_ID?: string;
  USER_STORAGE_SECRET_ACCESS_KEY?: string;
  USER_STORAGE_BUCKET?: string;
  USER_STORAGE_PUBLIC_URL?: string;
}

const REQUIRED = [
  'USER_STORAGE_ENDPOINT',
  'USER_STORAGE_ACCESS_KEY_ID',
  'USER_STORAGE_SECRET_ACCESS_KEY',
  'USER_STORAGE_BUCKET',
] as const;

/**
 * The R2 config for the `user` backend, or undefined when none of its vars are
 * set (every key then stays on the asset backend). Partially set is a startup
 * error rather than a silent "off": a typo'd var name would otherwise leave
 * user data on MinIO with nothing to say so.
 *
 * Empty strings count as unset — a `.env` line `FOO=` yields '', not undefined.
 */
export function resolveUserStorageConfig(vars: UserStorageVars): R2Config | undefined {
  const present = (name: keyof UserStorageVars) => (vars[name] ?? '') !== '';
  const missing = REQUIRED.filter((n) => !present(n));
  if (missing.length === REQUIRED.length) return undefined;
  if (missing.length > 0) {
    throw new Error(`user storage is partially configured — missing ${missing.join(', ')}`);
  }
  const endpoint = vars.USER_STORAGE_ENDPOINT as string;
  const bucket = vars.USER_STORAGE_BUCKET as string;
  return {
    endpoint,
    accessKeyId: vars.USER_STORAGE_ACCESS_KEY_ID as string,
    secretAccessKey: vars.USER_STORAGE_SECRET_ACCESS_KEY as string,
    bucket,
    // Nothing reads publicUrl for user keys today (results are always served
    // presigned), so the path-style bucket URL is a safe default.
    publicUrl: present('USER_STORAGE_PUBLIC_URL')
      ? (vars.USER_STORAGE_PUBLIC_URL as string)
      : `${endpoint.replace(/\/$/, '')}/${bucket}`,
    // Path-style keeps every presigned URL on the endpoint's own origin, which
    // is what the CSP and the R2 bucket's CORS rule are written against.
    forcePathStyle: true,
    region: 'auto',
  };
}
