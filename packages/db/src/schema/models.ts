import { pgTable, uuid, text, boolean, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const modelFaces = pgTable('model_faces', {
  id: uuid('id').primaryKey().defaultRandom(),
  gender: text('gender').notNull(), // 'men' | 'women' | 'boys' | 'girls'
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Global pool — no faceId FK
export const modelBackgrounds = pgTable('model_backgrounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// e.g. { genderSlug: 'men', slug: 'fullsleeveshirt', label: 'Full Sleeve Shirt' }
export const garmentSubcategories = pgTable('garment_subcategories', {
  id: uuid('id').primaryKey().defaultRandom(),
  genderSlug: text('gender_slug').notNull(),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Poses belong to a garment subcategory AND are per (face × background) combo
// e.g. m1bg1p1 → face=model1, background=bg1, pose variant 1
export const modelPoses = pgTable('model_poses', {
  id: uuid('id').primaryKey().defaultRandom(),
  subcategoryId: uuid('subcategory_id').notNull().references(() => garmentSubcategories.id),
  faceId: uuid('face_id').notNull().references(() => modelFaces.id),
  backgroundId: uuid('background_id').notNull().references(() => modelBackgrounds.id),
  label: text('label').notNull(),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  showsLower: boolean('shows_lower').notNull().default(false),
  showsShoes: boolean('shows_shoes').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  subcategoryIdx: index('model_poses_subcategory_id_idx').on(table.subcategoryId),
  faceIdx: index('model_poses_face_id_idx').on(table.faceId),
  backgroundIdx: index('model_poses_background_id_idx').on(table.backgroundId),
}));

// One row per (subcategory × face × background) combination — 4×4 = 16 per subcategory
export const subcategoryTemplates = pgTable('subcategory_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  subcategoryId: uuid('subcategory_id').notNull().references(() => garmentSubcategories.id),
  faceId: uuid('face_id').notNull().references(() => modelFaces.id),
  backgroundId: uuid('background_id').notNull().references(() => modelBackgrounds.id),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  subcategoryIdx: index('subcategory_templates_subcategory_id_idx').on(table.subcategoryId),
  lookupIdx: uniqueIndex('subcategory_templates_lookup_idx').on(table.subcategoryId, table.faceId, table.backgroundId),
}));
