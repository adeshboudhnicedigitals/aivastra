import { schema } from '@aivastra/db';
import {
  CustomerFilters,
  CustomerListQuery,
  type CustomerListResponse,
  type CustomerProfile,
  type CustomerRow,
  SegmentBody,
} from '@aivastra/types';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { decryptPhone, normalisePhone, phoneHash } from './crypto.js';
import { type PhotoJobRow, purgeJobPhotos, wipeShoppers } from './retention.js';

const MERCHANT_ADMIN_ACTOR_ROLE = 'MERCHANT_ADMIN';
const EXPORT_MAX_ROWS = 20_000;

// CRM phase 4 (plan 2026-11-12-crm-phase4-customer-screens.md). Merchant admin only (K1): branch
// staff never see the customer list. Phones are masked in lists, full on a profile and in an
// export, and both of those are audited (K2, K4).

/** +91 98•••••210: enough to tell two customers apart, not enough to call. */
export function maskPhone(digits: string): string {
  if (digits.length < 8) return '•'.repeat(digits.length);
  return `+${digits.slice(0, 2)} ${digits.slice(2, 4)}${'•'.repeat(digits.length - 7)}${digits.slice(-3)}`;
}

/** A spreadsheet runs a cell starting with = + - @ as a formula; a customer's name is free text. */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

type ListRaw = {
  id: string;
  display_name: string | null;
  phone_enc: string | null;
  first_seen_at: Date | string;
  last_seen_raw: string;
  last_seen_at: Date | string;
  visits: number;
  try_ons: number;
  purchases: number;
  branch_ids: string[] | null;
  looks: boolean | null;
  marketing: boolean | null;
};

const iso = (d: Date | string) => new Date(d).toISOString();

/**
 * One query for the list, a saved segment and the export (K3). Newest visit first, keyset-paged on
 * (last_seen_at, id) using the raw text timestamp so microseconds survive the cursor.
 */
function customerQuery(
  app: FastifyInstance,
  merchantId: string,
  f: CustomerFilters,
  opts: { limit: number; cursor?: string | undefined; id?: string },
) {
  const where = [
    sql`s.merchant_id = ${merchantId}::uuid`,
    sql`s.deleted_at is null`,
    sql`s.phone_enc is not null`,
  ];
  if (opts.id) where.push(sql`s.id = ${opts.id}::uuid`);
  if (f.q) {
    const digits = normalisePhone(f.q);
    if (digits.length >= 7 && digits.length === f.q.replace(/[\s+()-]/g, '').length) {
      // A phone number: exact match through the keyed hash, never a scan of decrypted numbers.
      where.push(sql`s.phone_hash = ${phoneHash(app.env.CRM_DATA_KEY, digits)}`);
    } else {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(sql`s.display_name ilike ${like}`);
    }
  }
  if (f.branchId) {
    where.push(
      sql`exists (select 1 from instore_sessions i where i.shopper_id = s.id and i.branch_id = ${f.branchId}::uuid)`,
    );
  }
  if (f.lastVisitFrom) where.push(sql`s.last_seen_at >= ${f.lastVisitFrom}::date`);
  if (f.lastVisitTo) where.push(sql`s.last_seen_at < (${f.lastVisitTo}::date + 1)`);
  if (f.marketing === 'yes') where.push(sql`m.granted is true`);
  if (f.marketing === 'no') where.push(sql`m.granted is not true`);
  if (f.minVisits) where.push(sql`v.visits >= ${f.minVisits}`);
  if (opts.cursor) {
    const [ts, id] = Buffer.from(opts.cursor, 'base64url').toString().split('|');
    if (!ts || !id || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(Date.parse(ts))) {
      throw new AppError('BAD_CURSOR', 400, 'invalid cursor');
    }
    where.push(sql`(s.last_seen_at, s.id) < (${ts}::timestamptz, ${id}::uuid)`);
  }

  return sql`
    select s.id, s.display_name, s.phone_enc, s.first_seen_at, s.last_seen_at,
      s.last_seen_at::text as last_seen_raw,
      v.visits, v.try_ons, v.purchases, v.branch_ids,
      l.granted as looks, m.granted as marketing
    from shoppers s
    left join lateral (
      select count(*)::int as visits,
        coalesce(sum((select count(*) from session_items si
          where si.session_id = i.id and si.action = 'tried' and si.voided_at is null)), 0)::int as try_ons,
        coalesce(sum((select count(*) from session_items si
          where si.session_id = i.id and si.action = 'sold' and si.voided_at is null)), 0)::int as purchases,
        array_agg(distinct i.branch_id) as branch_ids
      from instore_sessions i where i.shopper_id = s.id
    ) v on true
    left join lateral (
      select granted from shopper_consents c
      where c.shopper_id = s.id and c.kind = 'looks' order by c.created_at desc, c.id desc limit 1
    ) l on true
    left join lateral (
      select granted from shopper_consents c
      where c.shopper_id = s.id and c.kind = 'marketing' order by c.created_at desc, c.id desc limit 1
    ) m on true
    where ${sql.join(where, sql` and `)}
    order by s.last_seen_at desc, s.id desc
    limit ${opts.limit}
  `;
}

function toRow(app: FastifyInstance, r: ListRaw, full: boolean): CustomerRow {
  const digits = r.phone_enc ? decryptPhone(app.env.CRM_DATA_KEY, r.phone_enc) : '';
  return {
    id: r.id,
    name: r.display_name,
    phone: full ? digits : maskPhone(digits),
    firstSeenAt: iso(r.first_seen_at),
    lastSeenAt: iso(r.last_seen_at),
    visits: r.visits ?? 0,
    tryOns: r.try_ons ?? 0,
    purchases: r.purchases ?? 0,
    branchIds: r.branch_ids ?? [],
    consents: { looks: r.looks, marketing: r.marketing },
  };
}

export async function customerRoutes(app: FastifyInstance) {
  const needKey = () => {
    if (!app.env.CRM_DATA_KEY) {
      throw new AppError('CRM_NOT_CONFIGURED', 503, 'customer data encryption is not configured');
    }
  };

  app.get(
    '/v1/merchant/customers',
    { preHandler: app.requireMerchantAdmin, schema: { querystring: CustomerListQuery } },
    async (req): Promise<CustomerListResponse> => {
      needKey();
      const q = req.query as CustomerListQuery;
      const rows = await app.db.execute<ListRaw>(
        customerQuery(app, req.merchantMember!.merchantId, q, {
          limit: q.limit + 1,
          cursor: q.cursor,
        }),
      );
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => toRow(app, r, false)),
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(`${last.last_seen_raw}|${last.id}`).toString('base64url')
            : null,
      };
    },
  );

  app.get(
    '/v1/merchant/customers/export.csv',
    {
      preHandler: app.requireMerchantAdmin,
      schema: { querystring: CustomerFilters },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      needKey();
      const m = req.merchantMember!;
      const f = req.query as CustomerFilters;
      const rows = (
        await app.db.execute<ListRaw>(
          customerQuery(app, m.merchantId, f, { limit: EXPORT_MAX_ROWS }),
        )
      ).map((r) => toRow(app, r, true));

      await app.db.transaction(async (tx) => {
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'customer.export',
          resourceType: 'customer_export',
          resourceId: m.merchantId,
          after: { filters: f, rows: rows.length },
          request: req,
        });
      });

      const yn = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
      const lines = [
        [
          'name',
          'phone (with country code)',
          'first seen',
          'last seen',
          'visits',
          'try-ons',
          'purchases',
          'looks consent',
          'marketing consent',
        ].join(','),
        ...rows.map((r) =>
          [
            csvCell(r.name),
            csvCell(r.phone),
            csvCell(r.firstSeenAt),
            csvCell(r.lastSeenAt),
            r.visits,
            r.tryOns,
            r.purchases,
            yn(r.consents.looks),
            yn(r.consents.marketing),
          ].join(','),
        ),
      ];
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="customers.csv"')
        .header('cache-control', 'no-store')
        .send(`${lines.join('\r\n')}\r\n`);
    },
  );

  const IdParams = z.object({ id: z.string().uuid() });

  app.get(
    '/v1/merchant/customers/:id',
    { preHandler: app.requireMerchantAdmin, schema: { params: IdParams } },
    async (req): Promise<CustomerProfile> => {
      needKey();
      const m = req.merchantMember!;
      const { id } = req.params as z.infer<typeof IdParams>;
      return profile(app, m.merchantId, m.userId, id, req);
    },
  );

  async function profile(
    app: FastifyInstance,
    merchantId: string,
    userId: string,
    id: string,
    req: Parameters<typeof recordAudit>[1]['request'],
  ): Promise<CustomerProfile> {
    const [base] = await app.db.execute<ListRaw>(sql`
      ${customerQuery(app, merchantId, CustomerFilters.parse({}), { limit: 1, id })}
    `);
    if (!base) throw new AppError('NOT_FOUND', 404, 'customer not found');
    const visits = await app.db.execute<{
      session_id: string;
      started_at: Date | string;
      branch_id: string;
      branch_name: string;
      mode: string;
      tried: number;
      sold: number;
    }>(sql`
      select i.id as session_id, i.started_at, i.branch_id, b.name as branch_name, i.mode,
        (select count(*)::int from session_items si where si.session_id = i.id and si.action = 'tried' and si.voided_at is null) as tried,
        (select count(*)::int from session_items si where si.session_id = i.id and si.action = 'sold' and si.voided_at is null) as sold
      from instore_sessions i join merchant_branches b on b.id = i.branch_id
      where i.shopper_id = ${id}::uuid and i.merchant_id = ${merchantId}::uuid
      order by i.started_at desc limit 200
    `);
    const consents = await app.db
      .select()
      .from(schema.shopperConsents)
      .where(
        and(
          eq(schema.shopperConsents.shopperId, id),
          eq(schema.shopperConsents.merchantId, merchantId),
        ),
      )
      .orderBy(asc(schema.shopperConsents.createdAt));

    await app.db.transaction(async (tx) => {
      await recordAudit(tx, {
        actor: { userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
        action: 'customer.view',
        resourceType: 'shopper',
        resourceId: id,
        request: req,
      });
    });

    return {
      ...toRow(app, base, true),
      visitsList: visits.map((v) => ({
        sessionId: v.session_id,
        startedAt: iso(v.started_at),
        branchId: v.branch_id,
        branchName: v.branch_name,
        mode: v.mode,
        tried: v.tried,
        sold: v.sold,
      })),
      consentHistory: consents.map((c) => ({
        kind: c.kind,
        granted: c.granted,
        version: c.version,
        source: c.source,
        at: c.createdAt.toISOString(),
      })),
    };
  }

  app.delete(
    '/v1/merchant/customers/:id',
    {
      preHandler: app.requireMerchantAdmin,
      schema: { params: IdParams },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const m = req.merchantMember!;
      const { id } = req.params as z.infer<typeof IdParams>;
      const [s] = await app.db
        .select({ id: schema.shoppers.id })
        .from(schema.shoppers)
        .where(and(eq(schema.shoppers.id, id), eq(schema.shoppers.merchantId, m.merchantId)))
        .limit(1);
      if (!s) throw new AppError('NOT_FOUND', 404, 'customer not found');

      // Photos first: the wipe unlinks their sessions, after which the jobs could not be found.
      // Object deletes are idempotent, so a failure here is safe to retry (K5).
      const photos = await app.db.execute<PhotoJobRow>(sql`
        select j.id, j.customer_photo_key, o.result_key, o.thumbnail_key
        from jobs j
        join instore_sessions i on i.id = j.session_id
        left join job_outputs o on o.job_id = j.id
        where i.shopper_id = ${id}::uuid and i.merchant_id = ${m.merchantId}::uuid
          and (j.customer_photo_key is not null or o.result_key is not null or o.thumbnail_key is not null)
      `);
      const objects = await purgeJobPhotos(app, photos);

      await app.db.transaction(async (tx) => {
        await wipeShoppers(tx, [id]);
        await recordAudit(tx, {
          actor: { userId: m.userId, role: MERCHANT_ADMIN_ACTOR_ROLE },
          action: 'customer.delete',
          resourceType: 'shopper',
          resourceId: id,
          after: { photoObjects: objects },
          request: req,
        });
      });
      return reply.code(204).send();
    },
  );

  // Segments: named, saved filters (K3).
  app.get(
    '/v1/merchant/customer-segments',
    { preHandler: app.requireMerchantAdmin },
    async (req) => {
      const rows = await app.db
        .select()
        .from(schema.merchantCustomerSegments)
        .where(eq(schema.merchantCustomerSegments.merchantId, req.merchantMember!.merchantId))
        .orderBy(asc(schema.merchantCustomerSegments.name));
      return {
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          filters: CustomerFilters.parse(r.filters),
        })),
      };
    },
  );

  app.post(
    '/v1/merchant/customer-segments',
    { preHandler: app.requireMerchantAdmin, schema: { body: SegmentBody } },
    async (req, reply) => {
      const m = req.merchantMember!;
      const body = req.body as SegmentBody;
      const [row] = await app.db
        .insert(schema.merchantCustomerSegments)
        .values({
          merchantId: m.merchantId,
          name: body.name,
          filters: body.filters,
          createdBy: m.userId,
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new AppError('SEGMENT_EXISTS', 409, 'a segment with this name already exists');
      return reply.code(201).send({ id: row.id, name: row.name, filters: body.filters });
    },
  );

  app.delete(
    '/v1/merchant/customer-segments/:id',
    { preHandler: app.requireMerchantAdmin, schema: { params: IdParams } },
    async (req, reply) => {
      const { id } = req.params as z.infer<typeof IdParams>;
      const res = await app.db
        .delete(schema.merchantCustomerSegments)
        .where(
          and(
            eq(schema.merchantCustomerSegments.id, id),
            eq(schema.merchantCustomerSegments.merchantId, req.merchantMember!.merchantId),
          ),
        )
        .returning({ id: schema.merchantCustomerSegments.id });
      if (res.length === 0) throw new AppError('NOT_FOUND', 404, 'segment not found');
      return reply.code(204).send();
    },
  );
}
