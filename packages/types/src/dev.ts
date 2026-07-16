import { z } from 'zod';

export const DevJobStatus = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']);

export const DevTryonResponse = z.object({
  jobId: z.string().uuid(),
  status: DevJobStatus,
});

export const DevJobResponse = z.object({
  jobId: z.string().uuid(),
  status: DevJobStatus,
  imageUrl: z.string().url().optional(),
  error: z.string().optional(),
});

export const DevJobParams = z.object({ id: z.string().uuid() });

export const DevCategoriesResponse = z.object({
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export const DevMeResponse = z.object({
  merchantId: z.string().uuid(),
  companyName: z.string(),
  credits: z.number().int(),
});

export const ApiKeyCreateBody = z.object({
  label: z.string().min(1).max(64),
});

// `key` is present ONLY here — the one and only time the plaintext is returned.
export const ApiKeyCreateResponse = z.object({
  id: z.string().uuid(),
  label: z.string(),
  key: z.string(),
  keyPrefix: z.string(),
  createdAt: z.string(),
});

export const ApiKeyListResponse = z.object({
  keys: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      keyPrefix: z.string(),
      lastUsedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
