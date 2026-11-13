import type { AdminOverviewAccount, AdminOverviewResponse, AnalyticsPoint } from '@aivastra/types';
import { AdminOverviewQuery } from '@aivastra/types';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resolveWindow } from '../merchant/analytics/params.js';
import { iso, NOT_REFUNDED } from '../merchant/analytics/queries.js';
import { requirePermission } from './guard.js';

// Account console: totals across every account for the AiVastra team. The per-merchant queries
// in merchant/analytics/queries.ts always carry merchant_id, so this has its own SQL; the metric
// definitions are the same ones (sessions and items by the SESSION's started_at, sold excludes
// voided, credits are session-attributed and net of refunds), and the integration test asserts
// the totals equal the sum of the per-account summaries. Read only; gated by accounts.read.

const TOP = 10;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function adminAnalyticsOverviewRoutes(app: FastifyInstance) {
  app.get(
    '/admin/analytics/overview',
    { preHandler: requirePermission('accounts.read'), schema: { querystring: AdminOverviewQuery } },
    async (req): Promise<AdminOverviewResponse> => {
      const q = req.query as AdminOverviewQuery;
      const w = await resolveWindow(app.db, q, new Date());
      const start = iso(w.startUtc);
      const end = iso(w.endUtc);
      const day = sql`date_trunc('day', s.started_at at time zone ${w.tz})::date`;

      const [totalRows, dayRows, topRows] = await Promise.all([
        app.db.execute<Record<string, string>>(sql`
          select
            (select count(*) from instore_sessions s
              where s.started_at >= ${start} and s.started_at < ${end}) as sessions,
            (select count(distinct s.merchant_id) from instore_sessions s
              where s.started_at >= ${start} and s.started_at < ${end}) as active_accounts,
            (select count(*) from session_items i join instore_sessions s on s.id = i.session_id
              where i.action = 'tried'
                and s.started_at >= ${start} and s.started_at < ${end}) as tried,
            (select count(*) from session_items i join instore_sessions s on s.id = i.session_id
              where i.action = 'sold' and i.voided_at is null
                and s.started_at >= ${start} and s.started_at < ${end}) as sold,
            (select coalesce(sum(j.credits_charged), 0) from jobs j
              where j.session_id is not null
                and j.created_at >= ${start} and j.created_at < ${end}
                and ${NOT_REFUNDED}) as credits
        `),
        app.db.execute<Record<string, string>>(sql`
          with days as (
            select ${w.from}::date + g as day
            from generate_series(0, ${w.to}::date - ${w.from}::date) as g
          ),
          facts as (
            select ${day} as day, count(*) as sessions, 0::bigint as tried, 0::bigint as sold
            from instore_sessions s
            where s.started_at >= ${start} and s.started_at < ${end}
            group by 1
            union all
            select ${day} as day, 0::bigint as sessions,
              count(*) filter (where i.action = 'tried') as tried,
              count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold
            from session_items i
            join instore_sessions s on s.id = i.session_id
            where s.started_at >= ${start} and s.started_at < ${end}
              and i.action in ('tried', 'sold')
            group by 1
          ),
          per_day as (
            select day, sum(sessions) as sessions, sum(tried) as tried, sum(sold) as sold
            from facts group by day
          )
          select to_char(days.day, 'YYYY-MM-DD') as date,
            coalesce(per_day.sessions, 0) as sessions,
            coalesce(per_day.tried, 0) as tried,
            coalesce(per_day.sold, 0) as sold
          from days left join per_day on per_day.day = days.day
          order by days.day
        `),
        app.db.execute<Record<string, string>>(sql`
          with sess as (
            select s.merchant_id, count(*) as sessions
            from instore_sessions s
            where s.started_at >= ${start} and s.started_at < ${end}
            group by 1
          ),
          items as (
            select s.merchant_id,
              count(*) filter (where i.action = 'tried') as tried,
              count(*) filter (where i.action = 'sold' and i.voided_at is null) as sold
            from session_items i join instore_sessions s on s.id = i.session_id
            where s.started_at >= ${start} and s.started_at < ${end}
            group by 1
          ),
          cred as (
            select j.merchant_id, sum(j.credits_charged) as spent
            from jobs j
            where j.session_id is not null and j.merchant_id is not null
              and j.created_at >= ${start} and j.created_at < ${end}
              and ${NOT_REFUNDED}
            group by 1
          )
          select m.id as merchant_id, m.company_name,
            coalesce(sess.sessions, 0) as sessions,
            coalesce(items.tried, 0) as tried,
            coalesce(items.sold, 0) as sold,
            coalesce(cred.spent, 0) as spent
          from merchants m
          left join sess on sess.merchant_id = m.id
          left join items on items.merchant_id = m.id
          left join cred on cred.merchant_id = m.id
          where sess.sessions > 0 or cred.spent > 0
          order by coalesce(sess.sessions, 0) desc, coalesce(cred.spent, 0) desc, m.company_name
          limit ${TOP}
        `),
      ]);

      const t = totalRows[0] ?? {};
      const points: AnalyticsPoint[] = dayRows.map((r) => ({
        date: String(r.date),
        sessions: num(r.sessions),
        tried: num(r.tried),
        sold: num(r.sold),
      }));
      const top: AdminOverviewAccount[] = topRows.map((r) => ({
        merchantId: String(r.merchant_id),
        companyName: String(r.company_name),
        sessions: num(r.sessions),
        tried: num(r.tried),
        sold: num(r.sold),
        creditsSpent: num(r.spent),
      }));
      return {
        window: { from: w.from, to: w.to, tz: w.tz },
        totals: {
          activeAccounts: num(t.active_accounts),
          sessions: num(t.sessions),
          tried: num(t.tried),
          sold: num(t.sold),
          creditsSpent: num(t.credits),
        },
        points,
        top,
      };
    },
  );
}
