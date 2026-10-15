import type { Logger } from '@aivastra/logger';
import { storageReadFallbackTotal } from '@aivastra/observability';
import {
  createR2Provider,
  createRoutedStorage,
  resolveUserStorageConfig,
  type StorageProvider,
} from '@aivastra/storage';
import type { Env } from '../env.js';

/** Routes each key to MinIO or R2 by prefix — see packages/storage/src/routing.ts.
 *  Every dispatcher object read/write must go through this, never a raw S3
 *  client: a raw client is pinned to one bucket and bypasses the routing. */
export function makeStorage(env: Env, log: Logger): StorageProvider {
  const asset = createR2Provider({
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.R2_PUBLIC_URL,
    forcePathStyle: env.R2_FORCE_PATH_STYLE,
    presignBaseUrl: env.R2_PUBLIC_PRESIGN_BASE,
    signEndpoint: env.R2_SIGN_ENDPOINT,
  });
  const userConfig = resolveUserStorageConfig(env);
  const readFallback = userConfig !== undefined && env.USER_STORAGE_READ_FALLBACK === true;
  log.info(
    { userStorage: userConfig ? userConfig.bucket : 'off', readFallback },
    'storage routing configured',
  );
  return createRoutedStorage({
    asset,
    user: userConfig ? createR2Provider(userConfig) : undefined,
    readFallback,
    onFallback: (key, op) => {
      storageReadFallbackTotal.inc({ service: 'dispatcher', op });
      log.warn({ key, op }, 'user storage read fell back to MinIO');
    },
    onUnroutedRead: (key) => {
      log.warn({ key }, 'storage key has no routing rule — served from MinIO');
    },
  });
}
