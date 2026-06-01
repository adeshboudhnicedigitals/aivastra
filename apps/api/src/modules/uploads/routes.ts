import { randomUUID } from 'node:crypto';
import { keys } from '@aivastra/storage';
import { PresignUploadBody } from '@aivastra/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function uploadsRoutes(app: FastifyInstance) {
  app.post(
    '/v1/uploads/presign',
    {
      preHandler: app.requireUser,
      schema: { body: PresignUploadBody },
    },
    async (req) => {
      const { contentType, contentLength } = req.body as z.infer<typeof PresignUploadBody>;
      const jobToken = randomUUID(); // pre-job upload identifier
      const r2Key = keys.inputGarment(jobToken);
      const { url, expiresIn } = await app.storage.presignPut(
        r2Key,
        contentType,
        contentLength,
        300,
      );
      return { uploadUrl: url, r2Key, expiresIn };
    },
  );

  app.get(
    '/v1/uploads/thumbnail',
    {
      preHandler: app.requireUser,
      schema: { querystring: z.object({ key: z.string().min(1) }) },
    },
    async (req) => {
      const { key } = req.query as { key: string };
      const { url, expiresIn } = await app.storage.presignGet(key, 3600);
      return { thumbnailUrl: url, expiresIn };
    },
  );
}
