ALTER TABLE "model_poses"
  ADD COLUMN "workflow_template" text NOT NULL DEFAULT 'twopiece',
  ADD COLUMN "prompt_face_phase" text,
  ADD COLUMN "prompt_garment_phase" text,
  ADD COLUMN "face_side_r2_key" text;
