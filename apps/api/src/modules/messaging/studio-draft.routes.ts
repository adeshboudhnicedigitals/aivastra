import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { readStudioDraft } from './studio-draft.js';

const Params = z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) });

/**
 * The studio reads the draft a WhatsApp hand-off link points at. Tokens travel
 * in the path (not a query string logged elsewhere with the user's data), expire
 * with the upload binding, and only the owner can read one.
 */
export async function studioDraftRoutes(app: FastifyInstance) {
  // requireUser is explicit: routes are public unless they opt in, and the
  // owner check below needs req.userId.
  app.get('/v1/studio/drafts/:token', { preHandler: app.requireUser }, async (req) => {
    const parsed = Params.safeParse(req.params);
    const draft = parsed.success
      ? await readStudioDraft(app.redis, parsed.data.token, req.userId)
      : null;
    if (!draft) throw new AppError('NOT_FOUND', 404, 'not found');
    return {
      gender: draft.gender,
      garmentTypeId: draft.garmentTypeId,
      garmentKey: draft.garmentKey,
    };
  });
}
