-- Regeneration reasons are now meaningful on exactly one workflow template
-- (the dedicated 'regeneration' type) instead of on every template — clear
-- the field everywhere else so an admin can't mistake a 'regular'/'tryon'/
-- etc. template's reason list for something that still does anything. The
-- admin UI (WorkflowsPage.tsx) stops writing to this field for other types
-- going forward.
UPDATE workflow_templates
SET regeneration_reason_prompts = '[]'::jsonb
WHERE workflow_type <> 'regeneration';

-- Seed the live regeneration workflow from regen.json (repo root). Node
-- mapping — see docs/superpowers/specs/2026-08-31-dedicated-regeneration-workflow-design.md:
--   151 = source image (LoadImage, title "person") — the job output being regenerated
--   154 = reason prompt (TextEncodeQwenImageEditPlusPro_lrzjason, .inputs.prompt) — patched
--   149 = negative prompt (CLIPTextEncode, .inputs.text) — fixed, never patched
--   150 = result (Save Image With Callback)
INSERT INTO workflow_templates (
  slug, label, json_content, workflow_type,
  face_node_id, pose_node_id, bg_node_id, upper_node_ids,
  face_phase_prompt_node, garment_phase_prompt_node,
  default_face_phase_prompt, default_garment_phase_prompt,
  tryon_person_node_id, tryon_output_node_id,
  regeneration_reason_prompts, is_active
) VALUES (
  'regeneration_v1',
  'Regeneration',
  '{
    "140": {"inputs": {"lora_name": "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors", "strength_model": 1, "model": ["152", 0]}, "class_type": "LoraLoaderModelOnly", "_meta": {"title": "Load LoRA"}},
    "141": {"inputs": {"style": "%Y%m%d%H%M%S"}, "class_type": "Get Date Time String (JPS)", "_meta": {"title": "Get Date Time String (JPS)"}},
    "142": {"inputs": {"upscale_method": "lanczos", "megapixels": 2, "resolution_steps": 1, "image": ["151", 0]}, "class_type": "ImageScaleToTotalPixels", "_meta": {"title": "ImageScaleToTotalPixels"}},
    "143": {"inputs": {"clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors", "type": "qwen_image", "device": "default"}, "class_type": "CLIPLoader", "_meta": {"title": "Load CLIP"}},
    "144": {"inputs": {"vae_name": "Qwen_Image-VAE.safetensors"}, "class_type": "VAELoader", "_meta": {"title": "Load VAE"}},
    "145": {"inputs": {"samples": ["146", 0], "vae": ["144", 0]}, "class_type": "VAEDecode", "_meta": {"title": "VAE Decode"}},
    "146": {"inputs": {"seed": 12345, "steps": 4, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["140", 0], "positive": ["154", 0], "negative": ["149", 0], "latent_image": ["154", 1]}, "class_type": "KSampler", "_meta": {"title": "KSampler"}},
    "148": {"inputs": {"unet_name": "qwen-image-edit-2511-Q8_0.gguf"}, "class_type": "UnetLoaderGGUF", "_meta": {"title": "Unet Loader (GGUF)"}},
    "149": {"inputs": {"text": "nude, nude body, nude lower, nude upper, open chest, bare chest, exposed skin on torso, extra hands, duplicate hands, plastic hands, mannequin body,mannequin waist, mannequin hands, mannequin legs, 3 legs, 4 legs, extra legs, duplicate legs, extra head, duplicate head, extra buttons, extra zip, tucked upperwear, artifacts, frayed edges, threads, torn fabric, distorted sleeves, extra cloth, inside pants, tight waist fit, unnatural folds, compressed face, enlarged face, flattened face, plastic skin, wax figure, mannequin, doll-like, airbrushed skin, overly smooth skin, fake texture, unnatural skin tone, shiny skin, 3D render look, deformed chest, keep image1 sleeve, keep image1 neck type", "clip": ["143", 0]}, "class_type": "CLIPTextEncode", "_meta": {"title": "CLIP Text Encode (Prompt)"}},
    "150": {"inputs": {"filename_prefix": ["141", 0], "images": ["145", 0]}, "class_type": "Save Image With Callback", "_meta": {"title": "Save Image With Callback"}},
    "151": {"inputs": {"image": "20260825101708_00001_.png"}, "class_type": "LoadImage", "_meta": {"title": "person"}},
    "152": {"inputs": {"lora_name": "qwen_image_edit_2511_upscale.safetensors", "strength_model": 0.5, "model": ["148", 0]}, "class_type": "LoraLoaderModelOnly", "_meta": {"title": "Load LoRA"}},
    "154": {"inputs": {"prompt": "Remove extra footwear from image 1\n", "vl_resize_indexs": "0,1,2", "main_image_index": 1, "target_size": 1344, "target_vl_size": 384, "upscale_method": "lanczos", "crop_method": "pad", "instruction": "dont remove model footwear\n", "clip": ["143", 0], "vae": ["144", 0], "image1": ["142", 0]}, "class_type": "TextEncodeQwenImageEditPlusPro_lrzjason", "_meta": {"title": "TextEncodeQwenImageEditPlusPro lrzjason"}}
  }'::jsonb,
  'regeneration',
  '', '', '', ARRAY[]::text[],
  '149', '154',
  'nude, nude body, nude lower, nude upper, open chest, bare chest, exposed skin on torso, extra hands, duplicate hands, plastic hands, mannequin body,mannequin waist, mannequin hands, mannequin legs, 3 legs, 4 legs, extra legs, duplicate legs, extra head, duplicate head, extra buttons, extra zip, tucked upperwear, artifacts, frayed edges, threads, torn fabric, distorted sleeves, extra cloth, inside pants, tight waist fit, unnatural folds, compressed face, enlarged face, flattened face, plastic skin, wax figure, mannequin, doll-like, airbrushed skin, overly smooth skin, fake texture, unnatural skin tone, shiny skin, 3D render look, deformed chest, keep image1 sleeve, keep image1 neck type',
  'Remove extra footwear from image 1
',
  '151', '150',
  '[
    {"reason": "Multiple body parts", "prompt": ""},
    {"reason": "Nudity", "prompt": ""},
    {"reason": "Draping issue", "prompt": ""},
    {"reason": "Additional assets", "prompt": ""},
    {"reason": "Texture issue", "prompt": ""}
  ]'::jsonb,
  true
);