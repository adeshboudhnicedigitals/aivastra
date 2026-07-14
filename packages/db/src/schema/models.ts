import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { catalogCategories, catalogItems } from './catalog.js';

export const modelFaces = pgTable('model_faces', {
  id: uuid('id').primaryKey().defaultRandom(),
  gender: text('gender').notNull(), // 'men' | 'women' | 'boys' | 'girls'
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  faceSideR2Key: text('face_side_r2_key'), // ComfyUI-specific face image (moved from model_pose_assets)
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Global pool — no faceId FK
export const modelBackgrounds = pgTable('model_backgrounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  bgComfyR2Key: text('bg_comfy_r2_key'), // ComfyUI-specific background (moved from model_pose_assets)
  categoryId: integer('category_id').references(() => catalogCategories.id), // nullable — null means uncategorized (pre-existing backgrounds)
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`), // free-form entity tags, independent of category (e.g. "warm tone")
  specialTag: text('special_tag'), // 'featured' | 'trending' | 'popular' | null — per-asset, moved off category level
  genderSlug: text('gender_slug'), // nullable — null means shown for all genders
  // 'general' = visible in the admin Backgrounds tab and studio "create your own look";
  // 'template' = uploaded from within a catalogue template's looks builder, hidden from
  // both (managed only via the template that owns it). See scope column on modelPoseAssets.
  scope: text('scope').notNull().default('general'),
  isActive: boolean('is_active').notNull().default(true),
  isWhiteBg: boolean('is_white_bg').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// e.g. { genderSlug: 'men', slug: 'fullsleeveshirt', label: 'Full Sleeve Shirt' }
export const garmentSubcategories = pgTable('garment_subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  genderSlug: text('gender_slug').notNull(),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  thumbnailKey: text('thumbnail_key'),
  instructionImageKey: text('instruction_image_key'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  requiresLowerUpload: boolean('requires_lower_upload').notNull().default(false),
  defaultLowerCatalogId: uuid('default_lower_catalog_id').references(() => catalogItems.id, {
    onDelete: 'set null',
  }),
  defaultShoeCatalogId: uuid('default_shoe_catalog_id').references(() => catalogItems.id, {
    onDelete: 'set null',
  }),
  // FK to tryon_categories.id enforced in SQL only — see migration 0074. Not a
  // typed drizzle reference to avoid a circular import with schema/tryon.ts.
  tryonCategoryId: uuid('tryon_category_id'),
  // Admin-fixed pose used by merchant catalogue-manager's constrained "flat garment
  // -> catalogue image" generation. Null = generation unavailable for this type.
  defaultPoseId: uuid('default_pose_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Workflow templates — defined BEFORE modelPoses because modelPoses has a FK to this table
export const workflowTemplates = pgTable('workflow_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  jsonContent: jsonb('json_content').notNull().$type<Record<string, unknown>>(),

  // Node ID mappings (ComfyUI node IDs as strings — may contain colons e.g. "1345:111")
  faceNodeId: text('face_node_id'),
  poseNodeId: text('pose_node_id').notNull(),
  bgNodeId: text('bg_node_id'),
  upperNodeIds: text('upper_node_ids').array().notNull(),
  lowerNodeId: text('lower_node_id'), // nullable — some workflows have no lower garment
  shoeNodeId: text('shoe_node_id'), // nullable — some workflows have no shoe garment
  sizeNodeId: text('size_node_id'), // kept for backward compat — use sizeNodeIds
  sizeNodeIds: text('size_node_ids').array().notNull().default(sql`ARRAY[]::text[]`), // all nodes controlling output dimensions

  // Dual-size-group templates (build_model_main v2+) — both groups derive their width/height
  // from the same aspectRatio enum, just at different max edges. Empty = use sizeNodeIds above.
  latentSizeNodeIds: text('latent_size_node_ids').array().notNull().default(sql`ARRAY[]::text[]`), // [widthNodeId, heightNodeId]
  latentMaxPx: integer('latent_max_px').notNull().default(2048),
  outputSizeNodeIds: text('output_size_node_ids').array().notNull().default(sql`ARRAY[]::text[]`), // [widthNodeId, heightNodeId]
  outputMaxPx: integer('output_max_px').notNull().default(2048), // matches latentMaxPx by default — full resolution, not downscaled
  resultNodeId: text('result_node_id'), // SaveImage node holding the final deliverable image, when ambiguous

  // Prompt node IDs
  facePhasePromptNode: text('face_phase_prompt_node'),
  garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),

  // Default prompts extracted from JSON at upload time
  defaultFacePhasePrompt: text('default_face_phase_prompt').notNull().default(''),
  defaultGarmentPhasePrompt: text('default_garment_phase_prompt').notNull().default(''),

  // 'regular' = catalogue-creation (pose-based) workflows; 'tryon' = person + garment
  // try-on workflows, used by both the studio Try-On feature and kiosk.
  workflowType: text('workflow_type').notNull().default('regular'), // 'regular' | 'tryon'

  // Tryon workflow node IDs — only set when workflowType = 'tryon'
  tryonPersonNodeId: text('tryon_person_node_id'),
  tryonGarmentNodeId: text('tryon_garment_node_id'),
  tryonOutputNodeId: text('tryon_output_node_id'),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Centralised pose image asset — single source of truth for poses, filtered by genderSlug.
// Replaces model_poses: no longer tied to garment type mappings.
export const modelPoseAssets = pgTable('model_pose_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  displayName: text('display_name'),
  poseVariant: text('pose_variant'),
  // 'full' | 'half' | 'closeup' - validated at the Zod layer, not a DB enum, so
  // adding a category later is a one-line change, not a migration. Set once at
  // pose-upload time; drives garment_shot_type_workflows auto-resolution for
  // template-scoped poses.
  shotType: text('shot_type'),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  genderSlug: text('gender_slug'),
  workflowTemplateId: uuid('workflow_template_id').references(() => workflowTemplates.id, {
    onDelete: 'set null',
  }),
  promptGarmentPhase: text('prompt_garment_phase'),
  promptFacePhase: text('prompt_face_phase'),
  // 'general' = visible in the admin Pose Assets tab and studio "create your own look";
  // 'template' = uploaded from within a catalogue template's looks builder, hidden from
  // both (managed only via the template that owns it).
  scope: text('scope').notNull().default('general'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per-garment-type workflow/prompt/active overrides for a pose asset.
// Null fields mean "use the pose asset's default".
export const poseGarmentConfigs = pgTable(
  'pose_garment_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poseAssetId: uuid('pose_asset_id')
      .notNull()
      .references(() => modelPoseAssets.id, { onDelete: 'cascade' }),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => garmentSubcategories.id, { onDelete: 'cascade' }),
    workflowTemplateId: uuid('workflow_template_id').references(() => workflowTemplates.id, {
      onDelete: 'set null',
    }),
    promptGarmentPhase: text('prompt_garment_phase'),
    promptFacePhase: text('prompt_face_phase'),
    // Null = inherit model_pose_assets.is_active (the global flag). Non-null overrides
    // it for this garment type only — it can only narrow (hide a globally-active pose
    // for one type), never widen a globally-inactive pose back into visibility.
    isActive: boolean('is_active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqPoseSubcat: unique('pose_garment_configs_pose_subcat_unique').on(
      table.poseAssetId,
      table.subcategoryId,
    ),
    poseIdx: index('pose_garment_configs_pose_asset_id_idx').on(table.poseAssetId),
    subcatIdx: index('pose_garment_configs_subcategory_id_idx').on(table.subcategoryId),
  }),
);

// Many-to-many: which garment subcategories a lower/shoe catalog item targets
export const catalogItemSubcategories = pgTable(
  'catalog_item_subcategories',
  {
    catalogItemId: uuid('catalog_item_id').notNull(),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => garmentSubcategories.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.catalogItemId, table.subcategoryId] }),
  }),
);

export const catalogueTemplates = pgTable('catalogue_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  genderSlug: text('gender_slug').notNull(), // 'men' | 'women' | 'boys' | 'girls'
  label: text('label').notNull(),
  thumbnailKey: text('thumbnail_key'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One (pose, background) pairing — a "look" — within a catalogue template. Pose/background
// FKs are NO ACTION: both are soft-deleted (deletedAt / isActive=false), never hard-deleted,
// so a look can never dangle from an actual row removal. A look whose pose or background has
// been deactivated is filtered out at read time (GET /v1/models/catalogue-templates), not here.
export const catalogueTemplateLooks = pgTable(
  'catalogue_template_looks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => catalogueTemplates.id, { onDelete: 'cascade' }),
    poseAssetId: uuid('pose_asset_id')
      .notNull()
      .references(() => modelPoseAssets.id),
    backgroundId: uuid('background_id')
      .notNull()
      .references(() => modelBackgrounds.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => ({
    templateIdx: index('catalogue_template_looks_template_id_idx').on(table.templateId),
  }),
);

// A concrete template-to-garment-type mapping. Its generated ID scopes pose workflows,
// allowing the same global template to render differently for Shirt, Suit, or another type.
export const catalogueTemplateSubcategories = pgTable(
  'catalogue_template_subcategories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => catalogueTemplates.id, { onDelete: 'cascade' }),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => garmentSubcategories.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    uniqTemplateSubcategory: unique(
      'catalogue_template_subcategories_template_subcategory_unique',
    ).on(table.templateId, table.subcategoryId),
    subcategoryIdx: index('catalogue_template_subcategories_subcategory_id_idx').on(
      table.subcategoryId,
    ),
  }),
);

// Workflow selection for one pose inside one mapped template. Global templates
// deliberately carry no workflow; the same template pose can therefore use a
// different workflow when the template is mapped to Shirt, Suit, or another type.
export const catalogueTemplatePoseWorkflows = pgTable(
  'catalogue_template_pose_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingId: uuid('mapping_id')
      .notNull()
      .references(() => catalogueTemplateSubcategories.id, { onDelete: 'cascade' }),
    poseAssetId: uuid('pose_asset_id')
      .notNull()
      .references(() => modelPoseAssets.id, { onDelete: 'cascade' }),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    promptGarmentPhase: text('prompt_garment_phase'),
    // 'auto' = written or last refreshed by the shot-type-default resolver; safe to
    // overwrite on the next resolve. 'manual' = an admin picked this explicitly via
    // the per-pose dropdown; the resolver's ON CONFLICT ... WHERE source = 'auto'
    // guard means it will never touch this row again until the admin clears it.
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqMappingPose: unique('catalogue_template_pose_workflows_mapping_pose_unique').on(
      table.mappingId,
      table.poseAssetId,
    ),
    mappingIdx: index('catalogue_template_pose_workflows_mapping_id_idx').on(table.mappingId),
  }),
);

// The 3-slot default per garment type: "poses tagged X use workflow Y". A join
// table, not fixed columns on garment_subcategories - a 4th shot type later is new
// rows, not a migration. Setting/changing a row here immediately re-resolves every
// matching pose across every template mapped to this garment type - see
// apps/api/src/modules/admin/shot-type-resolve.ts.
export const garmentShotTypeWorkflows = pgTable(
  'garment_shot_type_workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    garmentTypeId: uuid('garment_type_id')
      .notNull()
      .references(() => garmentSubcategories.id, { onDelete: 'cascade' }),
    shotType: text('shot_type').notNull(), // 'full' | 'half' | 'closeup'
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqGarmentTypeShotType: unique('garment_shot_type_workflows_garment_type_shot_type_unique').on(
      table.garmentTypeId,
      table.shotType,
    ),
    garmentTypeIdx: index('garment_shot_type_workflows_garment_type_id_idx').on(
      table.garmentTypeId,
    ),
  }),
);
