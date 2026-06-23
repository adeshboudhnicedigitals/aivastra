# Standard Admin Registration & Role-Based Access

**Date:** 2026-06-11
**Status:** Draft

## Summary

Add an `ADMIN` role (standard admin) with restricted access: no workflow management, no asset deletion (faces, backgrounds, poses, lower garments, shoes). Implement a registration flow where users request admin status and super admins approve or reject.

## Motivation

Currently only a single super admin exists, bootstrapped via environment variables. Need the ability to create standard admin accounts with limited privileges — they can manage day-to-day operations but cannot delete critical assets or modify ComfyUI workflow templates.

## Database Changes

### `admin_users` table

```sql
ALTER TABLE admin_users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
```

| Column | Type | Description |
|--------|------|-------------|
| `role` | `TEXT NOT NULL DEFAULT 'SUPPORT'` | Extended enum: `SUPER_ADMIN \| MODERATOR \| SUPPORT \| ADMIN` |
| `status` (new) | `TEXT NOT NULL DEFAULT 'active'` | `pending`, `active`, `rejected` |

- Existing rows (bootstrap super admin, any moderators) default to `status = 'active'`.
- The `role = 'ADMIN'` paired with `status = 'pending'` represents a pending request.
- On rejection, `status = 'rejected'` — user can re-apply, which resets to `pending`.
- Revoke = delete the `admin_users` row entirely.

### Migration

```sql
-- packages/db/src/migrations/000X_add_admin_status.sql
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
```

## New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/auth/request-admin` | requireUser | Request admin status. Inserts `adminUsers` row with `role='ADMIN'`, `status='pending'`. Idempotent: rejected users re-apply (rejected→pending). Blocks if already an active admin (409). |
| `GET` | `/admin/admin-requests` | SUPER\_ADMIN | List all pending admin requests with user email, displayName, requestedAt. |
| `POST` | `/admin/admin-requests/:userId/approve` | SUPER\_ADMIN | Approve a pending request. Sets `status='active'`. |
| `POST` | `/admin/admin-requests/:userId/reject` | SUPER\_ADMIN | Reject a pending request. Sets `status='rejected'`. User can re-apply later. |
| `DELETE` | `/admin/admin-users/:userId` | SUPER\_ADMIN | Revoke/demote an admin. Deletes the `admin_users` row. |

### Request body (POST /v1/auth/request-admin)

No body required. The user is identified from the JWT (`req.userId`).

### Response shapes

**POST /v1/auth/request-admin:**
```json
{ "status": "pending", "role": "ADMIN" }
```

**GET /admin/admin-requests:**
```json
{
  "items": [
    {
      "userId": "uuid",
      "email": "user@example.com",
      "displayName": "John",
      "requestedAt": "2026-06-11T00:00:00Z"
    }
  ]
}
```

**POST /admin/admin-requests/:userId/approve:**
```json
{ "ok": true, "status": "active" }
```

**POST /admin/admin-requests/:userId/reject:**
```json
{ "ok": true, "status": "rejected" }
```

**DELETE /admin/admin-users/:userId:**
```json
{ "ok": true }
```

## Guard Updates

### `apps/api/src/modules/admin/guard.ts`

```typescript
export function requireAdmin(
  roles: ('SUPER_ADMIN' | 'MODERATOR' | 'SUPPORT' | 'ADMIN')[]
) {
  return async (req: FastifyRequest) => {
    const app = req.server as FastifyInstance;
    await app.requireUser(req as any, undefined as any);
    const [a] = await app.db
      .select()
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.userId, req.userId));
    if (!a) throw new AppError('FORBIDDEN', 403, 'admin required');
    if (a.status !== 'active')
      throw new AppError('FORBIDDEN', 403, 'admin account not active');
    if (!roles.includes(a.role as any))
      throw new AppError('FORBIDDEN', 403, 'insufficient admin role');
    req.adminRole = a.role;
  };
}
```

Key additions:
1. `'ADMIN'` in the role union type.
2. `status !== 'active'` check: pending and rejected admins cannot pass.

## Route-Level Permissions

### Workflows (`workflows.routes.ts`)

| Method | Path | Roles (unchanged) |
|--------|------|-------------------|
| All | `/admin/workflows/*` | `SUPER_ADMIN`, `MODERATOR` |

No changes needed — `ADMIN` was never included.

### Assets (`models.routes.ts`)

Split `W` into `RW` (read-write, includes ADMIN) and `D` (delete, excludes ADMIN):

```typescript
const RW = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
const D  = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
```

| Method | Path | Guard |
|--------|------|-------|
| GET | `/admin/assets/faces` | RW |
| POST | `/admin/assets/faces/presign` | RW |
| POST | `/admin/assets/faces/confirm` | RW |
| PATCH | `/admin/assets/faces/:id` | RW |
| DELETE | `/admin/assets/faces/:id` | D |
| DELETE | `/admin/assets/faces` (bulk) | D |
| GET | `/admin/assets/backgrounds` | RW |
| POST | `/admin/assets/backgrounds/presign` | RW |
| POST | `/admin/assets/backgrounds/confirm` | RW |
| PATCH | `/admin/assets/backgrounds/:id` | RW |
| DELETE | `/admin/assets/backgrounds/:id` | D |
| DELETE | `/admin/assets/backgrounds` (bulk) | D |
| GET | `/admin/assets/poses` | RW |
| POST | `/admin/assets/poses/presign` | RW |
| POST | `/admin/assets/poses/confirm` | RW |
| PATCH | `/admin/assets/poses/:id` | RW |
| PATCH | `/admin/assets/poses/bulk-workflow` | RW |
| POST | `/admin/assets/poses/:id/clone` | RW |
| POST | `/admin/assets/poses/clone-bulk` | RW |
| DELETE | `/admin/assets/poses` (bulk) | D |
| DELETE | `/admin/assets/poses/:id` | D |
| GET | `/admin/assets/pose-assets` | RW |
| POST | `/admin/assets/pose-assets/presign` | RW |
| POST | `/admin/assets/pose-assets` | RW |
| PATCH | `/admin/assets/pose-assets/:id` | RW |
| DELETE | `/admin/assets/pose-assets/:id` | D |
| DELETE | `/admin/assets/pose-assets` (bulk) | D |
| POST | `/admin/assets/pose-assets/:id/map` | RW |
| POST | `/admin/assets/pose-assets/bulk-map` | RW |
| Post | Presign re-upload routes | RW |
| GET | `/admin/assets/recycle-bin` | RW |
| POST | `/admin/assets/recycle-bin/restore` | RW |
| DELETE | `/admin/assets/recycle-bin` (hard delete) | D |

### Subcategories / Garment Types (`subcategories.routes.ts`)

| Method | Path | Guard |
|--------|------|-------|
| GET | `/admin/assets/garment-types` | RW |
| POST | `/admin/assets/garment-types/presign` | RW |
| POST | `/admin/assets/garment-types` | RW |
| PATCH | `/admin/assets/garment-types/:id` | RW |
| DELETE | `/admin/assets/garment-types/:id` | D |

### Catalog (`catalog.routes.ts`)

| Method | Path | Guard |
|--------|------|-------|
| GET | `/admin/catalog/items` | RW |
| GET | `/admin/catalog/categories` | RW |
| POST | `/admin/catalog/items/presign` | RW |
| POST | `/admin/catalog/items/confirm` | RW |
| PATCH | `/admin/catalog/items/:id` | RW |
| DELETE | `/admin/catalog/items/:id` | D |
| POST | `/admin/catalog/categories` | RW |
| PATCH | `/admin/catalog/categories/:id` | RW |
| DELETE | `/admin/catalog/categories/:id` | D |
| GET | `/admin/catalog/types` | RW |
| PATCH | `/admin/catalog/items/bulk-subcategories` | RW |

### Other Admin Routes

| Route group | ADMIN access |
|-------------|-------------|
| Users (list, view, patch, ban) | Full write (user delete remains SUPER\_ADMIN only) |
| Jobs (list, view, retry, cancel, stream) | Full write |
| Credits (grant, deduct, ledger, stats) | Full write |
| Config (read) | Full read |
| Config (write) | SUPER\_ADMIN only |
| Credit plans (CRUD) | SUPER\_ADMIN only |
| Workers (list, drain) | Full write |
| `/admin/me` | Full read (includes role info) |
| `/admin/stats` | Full read |

Guard aliases in each file:
```typescript
const ALL = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ADMIN']);
const WRITE = requireAdmin(['SUPER_ADMIN', 'MODERATOR', 'ADMIN']);
```

## Edge Cases

1. **Active admin cannot re-request:** If a user already has `adminUsers` row with `status='active'`, `POST /v1/auth/request-admin` returns 409.
2. **Rejected users re-apply:** If `status='rejected'`, the endpoint updates it back to `status='pending'`.
3. **Pending status blocks access:** A user with `status='pending'` has an `adminUsers` row but the guard rejects them — they cannot access any admin routes until approved.
4. **Revoke is a hard delete:** `DELETE /admin/admin-users/:userId` removes the `adminUsers` row. The user returns to being a regular user with no admin privileges. They can request admin again later.
5. **Concurrent approval/rejection:** If two super admins act on the same request simultaneously, the last write wins. This is acceptable since these are manual actions.
6. **Status default `'active'`:** Bootstrap super admin and any future manual DB inserts default to active. Only the `/v1/auth/request-admin` endpoint creates `pending` rows.
7. **No email notifications:** All status changes are reflected only in the UI. No emails sent on approval or rejection.

## Testing Plan

### New test file: `admin-approval.test.ts`

| Test case | Description |
|-----------|-------------|
| Regular user requests admin | Inserts `pending` row, returns 201 |
| Active admin cannot re-request | Returns 409 |
| Rejected user re-applies | Updates back to `pending` |
| Pending user blocked from admin routes | All admin endpoints return 403 |
| Super admin approves | Pending→active, user gains access |
| Super admin rejects | Pending→rejected |
| Rejected user blocked from admin routes | All admin endpoints return 403 |
| Revoke active admin | Admin row deleted, user loses access |
| Revoked user can re-request | New pending row inserted |
| Super admin lists pending requests | Returns filtered list |

### Existing test file updates

| Test file | Changes |
|-----------|---------|
| `models.test.ts` | Verify ADMIN can GET/POST/PATCH but DELETE returns 403 |
| `workflows.test.ts` | Verify ADMIN gets 403 on all workflow endpoints |
| `catalog.test.ts` | Verify ADMIN can GET/POST/PATCH catalog but DELETE returns 403 |
| `users.test.ts` | Verify ADMIN can list, view, patch users (but not delete) |

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/schema/admin.ts` | Add `status` column to `adminUsers` table definition |
| `packages/db/src/migrations/000X_add_admin_status.sql` | New migration |
| `apps/api/src/modules/admin/guard.ts` | Add `'ADMIN'` role, check `status === 'active'` |
| `apps/api/src/modules/auth/routes.ts` | Add `POST /v1/auth/request-admin` endpoint |
| `apps/api/src/modules/admin/users.routes.ts` | Add admin request management routes (list, approve, reject, revoke) |
| `apps/api/src/modules/admin/models.routes.ts` | Split `W` into `RW` + `D`, apply correct guards |
| `apps/api/src/modules/admin/subcategories.routes.ts` | Split guards for read-write vs delete |
| `apps/api/src/modules/admin/catalog.routes.ts` | Split guards for read-write vs delete |
| `apps/api/src/modules/admin/jobs.routes.ts` | Add `ADMIN` to write guard |
| `apps/api/src/modules/admin/credits.routes.ts` | Add `ADMIN` to write guard |
| `apps/api/src/modules/admin/me.routes.ts` | Add `ADMIN` to ALL guard |
| `apps/api/src/modules/admin/workers.routes.ts` | Add `ADMIN` to write guard |
| `apps/api/src/modules/admin/config.routes.ts` | Add `ADMIN` to read guard only |
| `apps/api/src/server.ts` | Register new routes (if separate file for admin requests) |

## Dependencies

None. This feature is self-contained within the existing monorepo.

## Rollback

- Drop the `status` column: `ALTER TABLE admin_users DROP COLUMN status;`
- Remove `'ADMIN'` from guard union type
- Remove `request-admin` endpoint
