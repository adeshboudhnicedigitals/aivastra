-- Add new columns to model_pose_assets
ALTER TABLE "model_pose_assets" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "model_pose_assets" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;
ALTER TABLE "model_pose_assets" ADD COLUMN IF NOT EXISTS "prompt_face_phase" text;

-- Migrate job_inputs: update pose_id to point to model_pose_assets via model_poses.pose_asset_id
-- (for existing jobs that have a linked pose asset)
UPDATE job_inputs ji
SET pose_id = mp.pose_asset_id
FROM model_poses mp
WHERE ji.pose_id = mp.id
  AND mp.pose_asset_id IS NOT NULL;

-- Drop the old FK constraint and re-add pointing to model_pose_assets
ALTER TABLE "job_inputs" DROP CONSTRAINT IF EXISTS "job_inputs_pose_id_model_poses_id_fk";
ALTER TABLE "job_inputs" ADD CONSTRAINT "job_inputs_pose_id_model_pose_assets_id_fk"
  FOREIGN KEY ("pose_id") REFERENCES "model_pose_assets"("id");

-- Drop model_poses table
DROP TABLE IF EXISTS "model_poses";

-- Drop now-unused columns from model_pose_assets
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "face_id";
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "background_id";
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "face_side_r2_key";
ALTER TABLE "model_pose_assets" DROP COLUMN IF EXISTS "bg_comfy_r2_key";
