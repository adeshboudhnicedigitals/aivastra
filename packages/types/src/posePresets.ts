import { z } from 'zod';

export const PosePresetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  poseIds: z.array(z.string().uuid()),
  isLastUsed: z.boolean(),
  updatedAt: z.string(),
});
export type PosePreset = z.infer<typeof PosePresetSchema>;

export const CreatePosePresetRequest = z.object({
  name: z.string().trim().min(1).max(40),
  poseIds: z.array(z.string().uuid()).min(1),
});
export type CreatePosePresetBody = z.infer<typeof CreatePosePresetRequest>;

export const ListPosePresetsResponse = z.object({
  lastUsed: PosePresetSchema.nullable(),
  named: z.array(PosePresetSchema),
});
export type ListPosePresetsResult = z.infer<typeof ListPosePresetsResponse>;
