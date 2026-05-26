import fp from 'fastify-plugin';
import { createR2Provider, type StorageProvider } from '@aivastra/storage';
declare module 'fastify' { interface FastifyInstance { storage: StorageProvider } }
export const storagePlugin = fp(async (app) => {
  app.decorate('storage', createR2Provider({
    endpoint: app.env.R2_ENDPOINT,
    accessKeyId: app.env.R2_ACCESS_KEY_ID,
    secretAccessKey: app.env.R2_SECRET_ACCESS_KEY,
    bucket: app.env.R2_BUCKET,
    publicUrl: app.env.R2_PUBLIC_URL,
    forcePathStyle: app.env.R2_FORCE_PATH_STYLE,
    presignBaseUrl: app.env.R2_PUBLIC_PRESIGN_BASE,
  }));
});
