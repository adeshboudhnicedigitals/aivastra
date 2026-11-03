import { schema } from '@aivastra/db';
import {
  FLEET_METRICS_WINDOWS,
  fleetMetricsQuerySchema,
  fleetMetricsSchema,
} from '@aivastra/types';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requirePermission } from '../admin/guard.js';

const workerParams = z.object({ id: z.string().min(1).max(100) });

type GpuRow = {
  gpu_index: number;
  t: Date | string;
  n: number;
  temp_avg: number | null;
  temp_max: number | null;
  sm_clock_avg: number | null;
  sm_clock_min: number | null;
  power_avg: number | null;
  power_max: number | null;
  util_avg: number | null;
  vram_used_max: number | null;
  vram_total_max: number | null;
  hw_thermal_us_max: number | string | null;
  sw_thermal_us_max: number | string | null;
  power_cap_us_max: number | string | null;
};
type HostRow = {
  t: Date | string;
  n: number;
  load1_max: number | null;
  ram_avail_min: number | null;
  swap_used_max: number | null;
  mem_psi_max: number | null;
};

const iso = (v: Date | string) => new Date(v).toISOString();
// Postgres returns aggregates as numbers or numeric strings depending on the type; null stays null.
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/**
 * Metrics history for the charts, served from the 1-minute rollups (raw rows only live 48 h).
 * A bucket with no data is absent, never zero-filled, so a gap in an agent's reporting is visible
 * as a gap. Averages are weighted by sample count when minutes are merged into a coarser step.
 */
export async function fleetMetricsRoutes(app: FastifyInstance) {
  app.get(
    '/admin/fleet/workers/:id/metrics',
    {
      preHandler: requirePermission('fleet.view'),
      schema: { params: workerParams, querystring: fleetMetricsQuerySchema },
    },
    async (req) => {
      const { id } = req.params as z.infer<typeof workerParams>;
      const { window } = req.query as z.infer<typeof fleetMetricsQuerySchema>;
      // `id` is a box id (fleet_hosts): rollups are keyed by the box the agent reports from.
      const [box] = await app.db
        .select({ id: schema.fleetHosts.id })
        .from(schema.fleetHosts)
        .where(eq(schema.fleetHosts.id, id));
      if (!box) throw new AppError('NOT_FOUND', 404, 'Box not found');

      const { ms, stepSeconds } = FLEET_METRICS_WINDOWS[window];
      const now = Date.now();
      const from = new Date(now - ms).toISOString();
      const step = sql`make_interval(secs => ${stepSeconds})`;
      const origin = sql`'2000-01-01 00:00:00+00'::timestamptz`;

      const [gpuRows, hostRows, earliest] = await Promise.all([
        app.db.execute<GpuRow>(sql`
          SELECT gpu_index, date_bin(${step}, bucket, ${origin}) AS t, sum(n)::int AS n,
            sum(temp_avg * n) FILTER (WHERE temp_avg IS NOT NULL)
              / nullif(sum(n) FILTER (WHERE temp_avg IS NOT NULL), 0) AS temp_avg,
            max(temp_max) AS temp_max,
            sum(sm_clock_avg * n) FILTER (WHERE sm_clock_avg IS NOT NULL)
              / nullif(sum(n) FILTER (WHERE sm_clock_avg IS NOT NULL), 0) AS sm_clock_avg,
            min(sm_clock_min) AS sm_clock_min,
            sum(power_avg * n) FILTER (WHERE power_avg IS NOT NULL)
              / nullif(sum(n) FILTER (WHERE power_avg IS NOT NULL), 0) AS power_avg,
            max(power_max) AS power_max,
            sum(util_avg * n) FILTER (WHERE util_avg IS NOT NULL)
              / nullif(sum(n) FILTER (WHERE util_avg IS NOT NULL), 0) AS util_avg,
            max(vram_used_max) AS vram_used_max, max(vram_total_max) AS vram_total_max,
            max(hw_thermal_slowdown_us_max) AS hw_thermal_us_max,
            max(sw_thermal_slowdown_us_max) AS sw_thermal_us_max,
            max(sw_power_cap_us_max) AS power_cap_us_max
          FROM fleet_gpu_rollups
          WHERE worker_id = ${id} AND bucket >= ${from}::timestamptz
          GROUP BY gpu_index, 2
          ORDER BY gpu_index, 2
        `),
        app.db.execute<HostRow>(sql`
          SELECT date_bin(${step}, bucket, ${origin}) AS t, sum(n)::int AS n,
            max(load1_max) AS load1_max, min(ram_avail_min) AS ram_avail_min,
            max(swap_used_max) AS swap_used_max, max(mem_psi_max) AS mem_psi_max
          FROM fleet_host_rollups
          WHERE worker_id = ${id} AND bucket >= ${from}::timestamptz
          GROUP BY 1
          ORDER BY 1
        `),
        app.db.execute<{ t: Date | string | null }>(sql`
          SELECT least(
            (SELECT min(bucket) FROM fleet_gpu_rollups WHERE worker_id = ${id}),
            (SELECT min(bucket) FROM fleet_host_rollups WHERE worker_id = ${id})
          ) AS t
        `),
      ]);

      const byGpu = new Map<number, ReturnType<typeof gpuPoint>[]>();
      for (const r of gpuRows) {
        const list = byGpu.get(r.gpu_index) ?? [];
        list.push(gpuPoint(r));
        byGpu.set(r.gpu_index, list);
      }
      const earliestRaw = earliest[0]?.t ?? null;
      return fleetMetricsSchema.parse({
        workerId: id,
        generatedAt: new Date(now).toISOString(),
        window,
        stepSeconds,
        earliest: earliestRaw ? iso(earliestRaw) : null,
        gpus: [...byGpu.entries()].map(([index, points]) => ({ index, points })),
        host: hostRows.map((r) => ({
          t: iso(r.t),
          n: Number(r.n),
          load1Max: r2(num(r.load1_max)),
          ramAvailMin: num(r.ram_avail_min),
          swapUsedMax: num(r.swap_used_max),
          memPsiMax: r2(num(r.mem_psi_max)),
        })),
      });
    },
  );
}

function gpuPoint(r: GpuRow) {
  return {
    t: iso(r.t),
    n: Number(r.n),
    tempAvg: r2(num(r.temp_avg)),
    tempMax: r2(num(r.temp_max)),
    smClockAvg: r2(num(r.sm_clock_avg)),
    smClockMin: num(r.sm_clock_min),
    powerAvg: r2(num(r.power_avg)),
    powerMax: r2(num(r.power_max)),
    utilAvg: r2(num(r.util_avg)),
    vramUsedMax: num(r.vram_used_max),
    vramTotalMax: num(r.vram_total_max),
    hwThermalSlowdownUsMax: num(r.hw_thermal_us_max),
    swThermalSlowdownUsMax: num(r.sw_thermal_us_max),
    swPowerCapUsMax: num(r.power_cap_us_max),
  };
}
