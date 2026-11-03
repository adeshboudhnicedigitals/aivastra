import { z } from 'zod';

// Fleet inventory: which box and GPU each worker runs on, and the rental facts beside them.
// Operator-maintained, so every write carries a reason that lands in the audit trail.

const slug = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{0,48}$/,
    'Use lowercase letters, digits and hyphens (max 49 characters).',
  );
export const fleetInventoryIdSchema = slug;
const reason = z.string().trim().min(3).max(300);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

export const fleetHostReviewViewSchema = z.object({
  note: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string(),
});

export const fleetHostViewSchema = z.object({
  id: slug,
  label: z.string(),
  provider: z.string().nullable(),
  rented: z.boolean().nullable(),
  monthlyCostUsd: z.number().nullable(),
  inventoryVerified: z.boolean(),
  updatedAt: z.string(),
  latestReview: fleetHostReviewViewSchema.nullable(),
});
export type FleetHostView = z.infer<typeof fleetHostViewSchema>;

export const fleetGpuViewSchema = z.object({
  id: slug,
  hostId: slug,
  model: z.string().nullable(),
  vramTotalMb: z.number().int().nullable(),
  updatedAt: z.string(),
});
export type FleetGpuView = z.infer<typeof fleetGpuViewSchema>;

export const fleetWorkerMappingViewSchema = z.object({
  workerId: z.string(),
  label: z.string(),
  hostId: slug.nullable(),
  gpuId: slug.nullable(),
});
export type FleetWorkerMappingView = z.infer<typeof fleetWorkerMappingViewSchema>;

export const fleetInventorySchema = z.object({
  generatedAt: z.string(),
  hosts: z.array(fleetHostViewSchema),
  gpus: z.array(fleetGpuViewSchema),
  workers: z.array(fleetWorkerMappingViewSchema),
});
export type FleetInventory = z.infer<typeof fleetInventorySchema>;

export const fleetHostUpsertSchema = z.object({
  label: z.string().trim().min(1).max(80),
  provider: optText(80),
  rented: z.boolean().nullable(),
  // Whole cents, so the stored decimal round-trips exactly.
  monthlyCostUsd: z
    .number()
    .min(0)
    .max(1_000_000)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'At most two decimals.')
    .nullable(),
  inventoryVerified: z.boolean(),
  reason,
});

export const fleetGpuUpsertSchema = z.object({
  hostId: slug,
  model: optText(100),
  vramTotalMb: z.number().int().min(1).max(1_000_000).nullable(),
  reason,
});

export const fleetWorkerMapSchema = z
  .object({ hostId: slug.nullable(), gpuId: slug.nullable(), reason })
  .refine((v) => (v.hostId === null) === (v.gpuId === null), {
    message: 'Give both a host and a GPU, or neither to unmap the worker.',
  });

export const fleetInventoryDeleteSchema = z.object({ reason });

export const fleetHostReviewCreateSchema = z.object({ note: z.string().trim().min(3).max(500) });
