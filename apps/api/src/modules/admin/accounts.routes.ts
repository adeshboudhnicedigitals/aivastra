import { AccountListQuery, type AccountListResponse, type AccountRow } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requirePermission } from './guard.js';

// Account console (spec §5): one row per merchant with the health columns a sales or support
// person scans. Every number is computed in one query so a chain's 100+ devices cost one pass,
// not one request per row. Read-only, so no audit row; the guard is accounts.read.

type Raw = {
  merchant_id: string;
  company_name: string;
  owner_email: string;
  is_active: boolean;
  created_at: Date | string;
  balance: number | null;
  burn: number;
  branches: number;
  devices: number;
  devices_offline: number;
  last_activity: Date | string | null;
  shopify: boolean;
  api_key: boolean;
  total: number;
};

const ORDER = {
  company: sql`lower(m.company_name) asc, m.id`,
  balance: sql`coalesce(uc.balance, 0) asc, m.id`,
  burn: sql`burn desc, m.id`,
  activity: sql`last_activity desc nulls last, m.id`,
} as const;

export async function adminAccountsRoutes(app: FastifyInstance) {
  app.get(
    '/admin/accounts',
    { preHandler: requirePermission('accounts.read'), schema: { querystring: AccountListQuery } },
    async (req): Promise<AccountListResponse> => {
      const q = req.query as AccountListQuery;
      const where = [sql`true`];
      if (q.search) {
        const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push(sql`(m.company_name ilike ${like} or u.email ilike ${like})`);
      }
      if (q.active) where.push(sql`m.is_active = ${q.active === 'true'}`);

      const rows = await app.db.execute<Raw>(sql`
        select m.id as merchant_id, m.company_name, u.email as owner_email, m.is_active, m.created_at,
          uc.balance,
          coalesce(j.burn, 0)::int as burn,
          coalesce(b.branches, 0)::int as branches,
          coalesce(d.devices, 0)::int as devices,
          coalesce(d.offline, 0)::int as devices_offline,
          greatest(j.last_job, d.last_seen) as last_activity,
          exists (select 1 from shopify_stores s where s.owner_user_id = m.user_id and s.uninstalled_at is null) as shopify,
          exists (select 1 from api_keys k where k.merchant_id = m.id and k.revoked_at is null) as api_key,
          count(*) over ()::int as total
        from merchants m
        join users u on u.id = m.user_id
        left join user_credits uc on uc.user_id = m.user_id
        left join lateral (
          select coalesce(sum(credits_charged) filter (where status = 'COMPLETED' and created_at > now() - interval '30 days'), 0) as burn,
                 max(created_at) as last_job
          from jobs where merchant_id = m.id
        ) j on true
        left join lateral (
          select count(*) filter (where is_active and device_token_hash is not null) as devices,
                 count(*) filter (where is_active and device_token_hash is not null
                   and (last_seen_at is null or last_seen_at < now() - interval '7 days')) as offline,
                 max(last_seen_at) as last_seen
          from merchant_devices where merchant_id = m.id
        ) d on true
        left join lateral (
          select count(*) as branches from merchant_branches where merchant_id = m.id and is_active
        ) b on true
        where ${sql.join(where, sql` and `)}
        order by ${ORDER[q.sort]}
        limit ${q.limit} offset ${(q.page - 1) * q.limit}
      `);

      const items: AccountRow[] = rows.map((r) => ({
        merchantId: r.merchant_id,
        companyName: r.company_name,
        ownerEmail: r.owner_email,
        isActive: r.is_active,
        createdAt: new Date(r.created_at).toISOString(),
        creditBalance: r.balance ?? 0,
        burn30d: r.burn,
        branches: r.branches,
        devices: r.devices,
        devicesOffline: r.devices_offline,
        lastActivityAt: r.last_activity ? new Date(r.last_activity).toISOString() : null,
        channels: { inStore: r.devices > 0, shopify: r.shopify, apiKey: r.api_key },
      }));
      return { items, total: rows[0]?.total ?? 0, page: q.page, limit: q.limit };
    },
  );
}
