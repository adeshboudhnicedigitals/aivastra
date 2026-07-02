import { z } from 'zod';

export const RESOLUTION_COSTS = {
  HD: 25,
  '2K': 35,
  '4K': 40,
} as const;

export type Resolution = keyof typeof RESOLUTION_COSTS;

/**
 * Shape of a user-uploaded garment R2 key, exactly as issued by
 * `/v1/uploads/presign` (`inputs/<uuid>/garment.jpg`). Pinning the format here
 * rejects arbitrary/traversal keys at the API boundary; ownership of the key is
 * additionally enforced server-side against the issuing user (see createJob).
 */
export const INPUT_GARMENT_KEY =
  /^inputs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/garment\.jpg$/;

export const CreateTryOnJobRequest = z.object({
  catalogueId: z.string().uuid().optional(),
  inputs: z.object({
    upperGarmentKey: z.string().regex(INPUT_GARMENT_KEY),
    faceId: z.string().uuid(),
    backgroundId: z.string().uuid(),
    poseIds: z.array(z.string().uuid()).min(1).max(6),
    garmentTypeId: z.string().uuid().optional(),
    lowerCatalogId: z.string().uuid().optional(),
    lowerGarmentKey: z.string().regex(INPUT_GARMENT_KEY).optional(),
    shoeCatalogId: z.string().uuid().optional(),
  }),
  params: z
    .object({
      seedStage1: z.number().int().optional(),
      seedStage2: z.number().int().optional(),
      stepsStage1: z.number().int().min(1).max(60).optional(),
      stepsStage2: z.number().int().min(1).max(60).optional(),
      outputWidth: z.number().int().min(512).max(4096).optional(),
      outputHeight: z.number().int().min(512).max(4096).optional(),
    })
    .optional(),
  userHint: z.string().max(300).optional(),
  aspectRatio: z.enum(['1:1', '2:3', '3:4', '4:5']),
  resolution: z.enum(['HD', '2K', '4K']),
  platform: z.string().optional(),
});

export const SIMPLE_TRYON_COST = 35;

export const CreateSimpleTryonRequest = z.object({
  personKey: z.string().regex(INPUT_GARMENT_KEY),
  sourceJobId: z.string().uuid(),
});

export const PresignUploadBody = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});

export const PresignUploadResponse = z.object({
  uploadUrl: z.string().url(),
  r2Key: z.string(),
  expiresIn: z.number().int().positive(),
});
