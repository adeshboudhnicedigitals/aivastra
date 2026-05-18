import { z } from 'zod';
export const CreditsResponse = z.object({
  balance: z.number().int().min(0),
  recent: z.array(z.object({
    id: z.string().uuid(),
    delta: z.number().int(),
    reason: z.string(),
    createdAt: z.string(),
  })),
});
