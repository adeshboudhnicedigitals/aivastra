import { schema } from '@aivastra/db';
import {
  type AgentIngestResponse,
  type AgentTelemetry,
  agentTelemetrySchema,
  FLEET_AGENT_HEARTBEAT_TTL_SEC,
  FLEET_AGENT_KEY_RE,
  FLEET_AGENT_LATEST_TTL_SEC,
  FLEET_AGENT_MAX_BODY_BYTES,
  FLEET_AGENT_MAX_FUTURE_MS,
  FLEET_AGENT_MAX_PAST_MS,
  fleetAgentHeartbeatKey,
  fleetAgentLatestKey,
  fleetAgentRejectsKey,
} from '@aivastra/types';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { extractBearer, hashAgentKey } from './agent-keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    fleetAgent?: { id: string; workerId: string };
  }
}

// The live heartbeat is in Redis; the key list only needs "about when", so the row is written at
// most once a minute rather than on every 15 s sample.
const LAST_SEEN_WRITE_INTERVAL_SEC = 60;
const REJECT_COUNTER_TTL_SEC = 60 * 60;

/**
 * Bucket by key, not IP: boxes behind one provider NAT must not share a limit. The limiter runs
 * at onRequest, before auth, so the bucket comes from the bearer itself, and only when it has the
 * shape of a real key. Anything else falls back to the IP, so random strings cannot mint buckets.
 */
function keyGenerator(req: { headers: Record<string, unknown>; ip: string }) {
  const token = extractBearer(
    typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
  );
  return token && FLEET_AGENT_KEY_RE.test(token) ? hashAgentKey(token) : req.ip;
}

// Latest-wins by observation time. A flush of spooled samples after an outage arrives oldest
// first, so a plain SET would walk the live view backwards. Compare-and-set in Lua keeps it
// monotonic even when two requests race.
const SET_LATEST_IF_NEWER_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, val = pcall(cjson.decode, cur)
  if ok and val.observedAt and tonumber(val.observedAt) >= tonumber(ARGV[1]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;

async function countReject(app: FastifyInstance, workerId: string): Promise<void> {
  try {
    const key = fleetAgentRejectsKey(workerId);
    const n = await app.redis.incr(key);
    if (n === 1) await app.redis.expire(key, REJECT_COUNTER_TTL_SEC);
  } catch {
    // A counter that cannot be written must not change the response.
  }
}

export async function fleetIngestRoutes(app: FastifyInstance) {
  // Runs before body validation on purpose: an unauthenticated caller must learn nothing about
  // the payload schema and must not be able to make the server validate arbitrary bodies.
  async function authenticateAgent(req: FastifyRequest): Promise<void> {
    const token = extractBearer(req.headers.authorization);
    // The shape check is free and rejects probes without a database round trip.
    if (!token || !FLEET_AGENT_KEY_RE.test(token)) {
      throw new AppError('UNAUTHORIZED', 401, 'invalid agent key');
    }
    const [row] = await app.db
      .select({ id: schema.fleetAgents.id, workerId: schema.fleetAgents.workerId })
      .from(schema.fleetAgents)
      .where(
        and(
          eq(schema.fleetAgents.keyHash, hashAgentKey(token)),
          isNull(schema.fleetAgents.revokedAt),
        ),
      );
    // Unknown and revoked look identical so a response cannot confirm a key ever existed.
    if (!row) throw new AppError('UNAUTHORIZED', 401, 'invalid agent key');
    req.fleetAgent = row;
  }

  app.post(
    '/v1/fleet/agent/ingest',
    {
      bodyLimit: FLEET_AGENT_MAX_BODY_BYTES,
      // 30/min per key: a 15 s cadence is 4/min, and the rest leaves room for an agent to flush
      // up to five minutes of spooled samples after an outage.
      config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator } },
      preValidation: authenticateAgent,
      schema: { body: agentTelemetrySchema },
      // Validation failures are counted per worker, so the handler must run to see them.
      attachValidation: true,
    },
    async (req): Promise<AgentIngestResponse> => {
      const agent = req.fleetAgent;
      if (!agent) throw new AppError('UNAUTHORIZED', 401, 'invalid agent key');

      if (req.validationError) {
        await countReject(app, agent.workerId);
        throw new AppError('VALIDATION', 400, req.validationError.message);
      }
      const body = req.body as AgentTelemetry;

      // A key speaks for exactly one worker. Anything else is a misconfigured or stolen agent.
      if (body.workerId !== agent.workerId) {
        await countReject(app, agent.workerId);
        throw new AppError('WORKER_MISMATCH', 403, 'this key is not bound to that worker');
      }

      const now = Date.now();
      const skewMs = now - body.observedAt;
      if (skewMs > FLEET_AGENT_MAX_PAST_MS || skewMs < -FLEET_AGENT_MAX_FUTURE_MS) {
        await countReject(app, agent.workerId);
        // serverTime lets the agent log how far off its own clock is.
        throw new AppError('CLOCK_SKEW', 422, 'sample time is too far from server time', {
          serverTime: now,
        });
      }

      const received = JSON.stringify({
        observedAt: body.observedAt,
        receivedAt: now,
        agentVersion: body.agentVersion,
        bootId: body.bootId,
        seq: body.seq,
      });
      // Redis first: if Postgres is degraded the live view and the heartbeat keep working, and
      // the agent still retries the sample from its spool because we answer 503 below.
      await app.redis.set(
        fleetAgentHeartbeatKey(agent.workerId),
        received,
        'EX',
        FLEET_AGENT_HEARTBEAT_TTL_SEC,
      );
      await app.redis.eval(
        SET_LATEST_IF_NEWER_LUA,
        1,
        fleetAgentLatestKey(agent.workerId),
        String(body.observedAt),
        JSON.stringify({ ...body, receivedAt: now, clockSkewMs: skewMs }),
        String(FLEET_AGENT_LATEST_TTL_SEC),
      );

      let duplicate = false;
      try {
        duplicate = await app.db.transaction(async (tx) => {
          const host = body.host;
          const [inserted] = await tx
            .insert(schema.fleetHostSamples)
            .values({
              workerId: agent.workerId,
              observedAt: new Date(body.observedAt),
              bootId: body.bootId,
              seq: body.seq,
              agentVersion: body.agentVersion,
              clockSkewMs: skewMs,
              cpuCount: host.cpuCount,
              load1: host.load1,
              load5: host.load5,
              load15: host.load15,
              ramTotalMib: host.ramTotalMib,
              ramAvailMib: host.ramAvailMib,
              swapTotalMib: host.swapTotalMib,
              swapUsedMib: host.swapUsedMib,
              memPsiSome10: host.memPsiSome10,
              uptimeSec: host.uptimeSec,
              ntpSynced: host.ntpSynced,
              disks: host.disks,
              services: body.services,
              comfy: body.comfy,
              computeApps: body.computeApps,
            })
            .onConflictDoNothing()
            .returning({ id: schema.fleetHostSamples.id });
          // The host row is the idempotency anchor: if it already exists this is a replay, and
          // its GPU rows exist too (they were written in the same transaction).
          if (!inserted) return true;
          if (body.gpus.length > 0) {
            await tx.insert(schema.fleetGpuSamples).values(
              body.gpus.map((g) => ({
                workerId: agent.workerId,
                observedAt: new Date(body.observedAt),
                gpuIndex: g.index,
                name: g.name,
                tempC: g.tempC,
                memTempC: g.memTempC,
                fanPct: g.fanPct,
                pstate: g.pstate,
                smClockMhz: g.smClockMhz,
                smClockMaxMhz: g.smClockMaxMhz,
                memClockMhz: g.memClockMhz,
                powerW: g.powerW,
                powerLimitW: g.powerLimitW,
                utilGpuPct: g.utilGpuPct,
                utilMemPct: g.utilMemPct,
                vramUsedMib: g.vramUsedMib,
                vramTotalMib: g.vramTotalMib,
                throttleReasons: g.throttleReasons,
                eccUncorrected: g.eccUncorrected,
                hwThermalSlowdownUs: g.hwThermalSlowdownUs ?? null,
                swThermalSlowdownUs: g.swThermalSlowdownUs ?? null,
                swPowerCapUs: g.swPowerCapUs ?? null,
              })),
            );
          }
          return false;
        });
      } catch (err) {
        req.log.error({ err, workerId: agent.workerId }, 'fleet ingest: history write failed');
        // 503, not 500: the agent keeps the sample in its spool and retries.
        throw new AppError('INGEST_UNAVAILABLE', 503, 'could not store the sample, retry');
      }

      // Advisory bookkeeping for the key list; never allowed to fail an accepted sample.
      try {
        await app.db
          .update(schema.fleetAgents)
          .set({
            lastSeenAt: new Date(now),
            agentVersion: body.agentVersion,
            bootId: body.bootId,
            clockSkewMs: skewMs,
          })
          .where(
            and(
              eq(schema.fleetAgents.id, agent.id),
              or(
                isNull(schema.fleetAgents.lastSeenAt),
                lt(
                  schema.fleetAgents.lastSeenAt,
                  sql`now() - make_interval(secs => ${LAST_SEEN_WRITE_INTERVAL_SEC})`,
                ),
              ),
            ),
          );
      } catch (err) {
        req.log.warn({ err }, 'fleet ingest: last_seen update failed');
      }

      return { ok: true, duplicate, serverTime: now, commandsPending: 0 };
    },
  );
}
