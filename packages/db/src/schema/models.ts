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
  uuid,
} from 'drizzle-orm/pg-core';
import { catalogItems } from './catalog.js';

export const modelFaces = pgTable('model_faces', {
  id: uuid('id').primaryKey().defaultRandom(),
  gender: text('gender').notNull(), // 'men' | 'women' | 'boys' | 'girls'
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
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
  genderSlug: text('gender_slug'), // nullable — null means shown for all genders
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
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  requiresLowerUpload: boolean('requires_lower_upload').notNull().default(false),
  defaultLowerCatalogId: uuid('default_lower_catalog_id').references(() => catalogItems.id, {
    onDelete: 'set null',
  }),
  defaultShoeCatalogId: uuid('default_shoe_catalog_id').references(() => catalogItems.id, {
    onDelete: 'set null',
  }),
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
  faceNodeId: text('face_node_id').notNull(),
  poseNodeId: text('pose_node_id').notNull(),
  bgNodeId: text('bg_node_id').notNull(),
  upperNodeIds: text('upper_node_ids').array().notNull(),
  lowerNodeId: text('lower_node_id'), // nullable — some workflows have no lower garment
  shoeNodeId: text('shoe_node_id'), // nullable — some workflows have no shoe garment
  sizeNodeId: text('size_node_id'), // kept for backward compat — use sizeNodeIds
  sizeNodeIds: text('size_node_ids').array().notNull().default(sql`ARRAY[]::text[]`), // all nodes controlling output dimensions

  // Prompt node IDs
  facePhasePromptNode: text('face_phase_prompt_node').notNull(),
  garmentPhasePromptNode: text('garment_phase_prompt_node').notNull(),

  // Default prompts extracted from JSON at upload time
  defaultFacePhasePrompt: text('default_face_phase_prompt').notNull().default(''),
  defaultGarmentPhasePrompt: text('default_garment_phase_prompt').notNull().default(''),

  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Centralised pose image asset — R2 objects managed independently of garment type mappings.
// Deleting this row removes the R2 object; model_poses rows are mappings that reference it.
export const modelPoseAssets = pgTable('model_pose_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  displayName: text('display_name'),
  poseVariant: text('pose_variant'),
  r2Key: text('r2_key').notNull(),
  faceSideR2Key: text('face_side_r2_key'),
  bgComfyR2Key: text('bg_comfy_r2_key'),
  thumbnailKey: text('thumbnail_key').notNull(),
  genderSlug: text('gender_slug'),
  faceId: uuid('face_id').references(() => modelFaces.id, { onDelete: 'set null' }),
  backgroundId: uuid('background_id').references(() => modelBackgrounds.id, {
    onDelete: 'set null',
  }),
  workflowTemplateId: uuid('workflow_template_id').references(() => workflowTemplates.id, {
    onDelete: 'set null',
  }),
  promptGarmentPhase: text('prompt_garment_phase'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Poses belong to a garment subcategory AND are per (face × background) combo
// e.g. m1bg1p1 → face=model1, background=bg1, pose variant 1
export const modelPoses = pgTable(
  'model_poses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => garmentSubcategories.id),
    faceId: uuid('face_id')
      .notNull()
      .references(() => modelFaces.id),
    backgroundId: uuid('background_id')
      .notNull()
      .references(() => modelBackgrounds.id),
    label: text('label').notNull(),
    r2Key: text('r2_key').notNull(),
    thumbnailKey: text('thumbnail_key').notNull(),
    showsLower: boolean('shows_lower').notNull().default(false),
    showsShoes: boolean('shows_shoes').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    workflowTemplateId: uuid('workflow_template_id')
      .notNull()
      .references(() => workflowTemplates.id),
    promptFacePhase: text('prompt_face_phase'),
    promptGarmentPhase: text('prompt_garment_phase'),
    faceSideR2Key: text('face_side_r2_key'),
    bgComfyR2Key: text('bg_comfy_r2_key'),
    poseAssetId: uuid('pose_asset_id').references(() => modelPoseAssets.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subcategoryIdx: index('model_poses_subcategory_id_idx').on(table.subcategoryId),
    faceIdx: index('model_poses_face_id_idx').on(table.faceId),
    backgroundIdx: index('model_poses_background_id_idx').on(table.backgroundId),
    workflowIdx: index('model_poses_workflow_template_id_idx').on(table.workflowTemplateId),
    // Only one pose per cell can be the template
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
