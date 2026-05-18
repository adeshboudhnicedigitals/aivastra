import type { FastifyInstance } from 'fastify';
import { PresignUploadBody } from '@aivastra/types';
import { keys } from '@aivastra/storage';
import { randomUUID } from 'node:crypto';

export async function uploadsRoutes(app: FastifyInstance) {
  app.post('/v1/uploads/presign', {
    preHandler: app.requireUser,
    schema: { body: PresignUploadBody },
  }, async (req) => {
    const { contentType, contentLength } = req.body as any;
    const jobToken = randomUUID();        // pre-job upload identifier
    const r2Key = keys.inputGarment(jobToken);
    const { url, expiresIn } = await app.storage.presignPut(r2Key, contentType, contentLength, 300);
    return { uploadUrl: url, r2Key, expiresIn };
  });
}
