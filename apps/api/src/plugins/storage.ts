import { storageReadFallbackTotal } from '@aivastra/observability';
import {
  createR2Provider,
  createRoutedStorage,
  resolveUserStorageConfig,
  type StorageProvider,
} from '@aivastra/storage';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    storage: StorageProvider;
  }
}
export const storagePlugin = fp(async (app) => {
  const asset = createR2Provider({
    endpoint: app.env.R2_ENDPOINT,
    accessKeyId: app.env.R2_ACCESS_KEY_ID,
    secretAccessKey: app.env.R2_SECRET_ACCESS_KEY,
    bucket: app.env.R2_BUCKET,
    publicUrl: app.env.R2_PUBLIC_URL,
    forcePathStyle: app.env.R2_FORCE_PATH_STYLE,
    presignBaseUrl: app.env.R2_PUBLIC_PRESIGN_BASE,
    signEndpoint: app.env.R2_SIGN_ENDPOINT,
  });
  const userConfig = resolveUserStorageConfig(app.env);
  // `=== true`: tests build Env objects by hand, so an absent flag is undefined.
  const readFallback = userConfig !== undefined && app.env.USER_STORAGE_READ_FALLBACK === true;
  app.log.info(
    { userStorage: userConfig ? userConfig.bucket : 'off', readFallback },
    'storage routing configured',
  );
  app.decorate(
    'storage',
    createRoutedStorage({
      asset,
      user: userConfig ? createR2Provider(userConfig) : undefined,
      readFallback,
      onFallback: (key, op) => {
        storageReadFallbackTotal.inc({ service: 'api', op });
        app.log.warn({ key, op }, 'user storage read fell back to MinIO');
      },
      onUnroutedRead: (key) => {
        app.log.warn({ key }, 'storage key has no routing rule — served from MinIO');
      },
    }),
  );
});
