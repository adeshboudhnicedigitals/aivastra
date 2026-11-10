import { boolean, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: text('role').notNull(),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    uniq: unique().on(t.role, t.permissionId),
  }),
);

// Independent of role_permissions on purpose — a role can have a permission (so its
// API calls succeed) but still have the matching sidebar item hidden here, or the
// reverse. No row for a (role, navKey) pair means "inherit the permission-driven
// default"; `visible` only exists when an admin has explicitly overridden that
// default from the Roles & Permissions > Sidebar tab. navKey matches the `k` field
// of a NavItem in apps/admin-web/src/components/Sidebar.tsx.
export const roleNavOverrides = pgTable(
  'role_nav_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: text('role').notNull(),
    navKey: text('nav_key').notNull(),
    visible: boolean('visible').notNull(),
  },
  (t) => ({
    uniq: unique().on(t.role, t.navKey),
  }),
);
