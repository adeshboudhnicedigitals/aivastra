import { type DB, schema } from '@aivastra/db';
import type { AnalyticsQuery } from '@aivastra/types';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../../lib/errors.js';
import type { MerchantMember } from '../../../plugins/portal-auth.js';

export interface AnalyticsScope {
  /** Always set: every analytics query carries merchant_id = this. */
  merchantId: string;
  branchId?: string;
  staffId?: string;
  deviceId?: string;
  isStaff: boolean;
  /** The caller's own staff id (staff callers only), for the `mine` figures. */
  memberStaffId: string | null;
}

/**
 * Turns the caller plus the optional filters into the server-enforced scope.
 *
 * Staff: forced to their own branch. Naming another branch or another staff member is a
 * 403, and so is a device that is not in their branch — the device is looked up scoped by
 * merchant, so a foreign or unknown device id is the same 403 and does not reveal whether
 * it exists.
 *
 * Admin: filters are optional and passed through unchecked. Every query also carries
 * merchant_id = member.merchantId, so an id from another merchant (or an unknown one)
 * simply matches nothing and returns zeros — deliberately not a 404, which would confirm
 * that a foreign id exists.
 */
export async function resolveScope(
  db: DB,
  member: MerchantMember,
  q: Pick<AnalyticsQuery, 'branchId' | 'staffId' | 'deviceId'>,
): Promise<AnalyticsScope> {
  if (member.role === 'admin') {
    return {
      merchantId: member.merchantId,
      branchId: q.branchId,
      staffId: q.staffId,
      deviceId: q.deviceId,
      isStaff: false,
      memberStaffId: null,
    };
  }

  const ownBranch = member.branchId;
  const ownStaff = member.staffId;
  // requireMerchantMember always sets both for staff; refuse rather than widen if not.
  if (!ownBranch || !ownStaff) throw new AppError('FORBIDDEN', 403, 'not a merchant member');

  if (q.branchId !== undefined && q.branchId !== ownBranch) {
    throw new AppError('FORBIDDEN', 403, 'staff can only view their own branch');
  }
  if (q.staffId !== undefined && q.staffId !== ownStaff) {
    throw new AppError('FORBIDDEN', 403, 'staff can only view their own figures');
  }
  if (q.deviceId !== undefined) {
    const [device] = await db
      .select({ branchId: schema.merchantDevices.branchId })
      .from(schema.merchantDevices)
      .where(
        and(
          eq(schema.merchantDevices.id, q.deviceId),
          eq(schema.merchantDevices.merchantId, member.merchantId),
        ),
      )
      .limit(1);
    if (!device || device.branchId !== ownBranch) {
      throw new AppError('FORBIDDEN', 403, 'staff can only view their own branch');
    }
  }

  return {
    merchantId: member.merchantId,
    branchId: ownBranch,
    staffId: q.staffId,
    deviceId: q.deviceId,
    isStaff: true,
    memberStaffId: ownStaff,
  };
}
