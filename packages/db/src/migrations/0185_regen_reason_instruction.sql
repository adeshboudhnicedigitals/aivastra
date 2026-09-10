-- The regeneration workflow's reason-prompt node (TextEncodeQwenImageEditPlusPro_lrzjason,
-- node 154 in regen.json) has two independently-patchable inputs: `prompt` and
-- `instruction`. regenerationReasonPrompts already carried per-reason `prompt`
-- overrides; this backfills a blank `instruction` key onto every existing
-- entry so older rows (seeded before the field existed) match the shape the
-- app now reads/writes. Blank means "no override" — same convention as
-- `prompt` — so this is purely additive and changes no behavior on its own.
UPDATE workflow_templates
SET regeneration_reason_prompts = (
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'instruction' THEN elem
      ELSE elem || jsonb_build_object('instruction', '')
    END
  )
  FROM jsonb_array_elements(regeneration_reason_prompts) AS elem
)
WHERE workflow_type = 'regeneration'
  AND jsonb_typeof(regeneration_reason_prompts) = 'array'
  AND jsonb_array_length(regeneration_reason_prompts) > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(regeneration_reason_prompts) AS e
    WHERE NOT (e ? 'instruction')
  );
