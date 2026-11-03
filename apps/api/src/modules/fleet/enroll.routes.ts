import { schema } from '@aivastra/db';
import {
  FLEET_ENROLL_TOKEN_RE,
  type FleetEnrollRequest,
  fleetEnrollRequestSchema,
  fleetEnrollResponseSchema,
  fleetEnrollTokenCreatedSchema,
  fleetEnrollTokenViewSchema,
} from '@aivastra/types';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../admin/audit.js';
import { requirePermission } from '../admin/guard.js';
import {
  extractBearer,
  generateAgentKey,
  generateEnrollToken,
  hashAgentKey,
} from './agent-keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    fleetEnrollToken?: { id: string; createdBy: string };
  }
}

const tokenParams = z.object({ id: z.string().uuid() });
const createTokenBody = z.object({ label: z.string().trim().max(60).optional() }).nullish();
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// Bucket by token, not IP (the operator's laptop may share an office NAT); random strings that do
// not look like a token fall back to the IP so they cannot mint buckets.
function keyGenerator(req: { headers: Record<string, unknown>; ip: string }) {
  const token = extractBearer(
    typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
  );
  return token && FLEET_ENROLL_TOKEN_RE.test(token) ? `enroll:${hashAgentKey(token)}` : req.ip;
}

/**
 * Box enrolment (vps-sync fleet-converge.sh --agent). One call registers the box in the inventory,
 * links it to its dispatcher worker, and returns the box's agent key, which the caller pipes to the
 * box over ssh. Earlier keys of the box are revoked in the same transaction, so a reinstalled box
 * just works and a box never accumulates keys.
 */
export async function fleetEnrollRoutes(app: FastifyInstance) {
  async function authenticateEnroll(req: FastifyRequest): Promise<void> {
    const token = extractBearer(req.headers.authorization);
    if (!token || !FLEET_ENROLL_TOKEN_RE.test(token)) {
      throw new AppError('UNAUTHORIZED', 401, 'invalid enrolment token');
    }
    const [row] = await app.db
      .select({ id: schema.fleetEnrollTokens.id, createdBy: schema.fleetEnrollTokens.createdBy })
      .from(schema.fleetEnrollTokens)
      .where(
        and(
          eq(schema.fleetEnrollTokens.tokenHash, hashAgentKey(token)),
          isNull(schema.fleetEnrollTokens.revokedAt),
        ),
      );
    // Unknown and revoked look identical.
    if (!row) throw new AppError('UNAUTHORIZED', 401, 'invalid enrolment token');
    req.fleetEnrollToken = row;
  }

  app.post(
    '/v1/fleet/enroll',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator } },
      // Before body validation: an unauthenticated caller learns nothing about the payload.
      preValidation: authenticateEnroll,
      schema: { body: fleetEnrollRequestSchema },
    },
    async (req, reply) => {
      const tok = req.fleetEnrollToken;
      if (!tok) throw new AppError('UNAUTHORIZED', 401, 'invalid enrolment token');
      const { boxId, workerId } = req.body as FleetEnrollRequest;
      const generated = generateAgentKey();
      const now = new Date();

      const out = await app.db.transaction(async (tx) => {
        let linked = false;
        if (workerId) {
          const [w] = await tx
            .select({ id: schema.workers.id })
            .from(schema.workers)
            .where(eq(schema.workers.id, workerId));
          linked = Boolean(w);
        }
        // The box row: created on first enrolment, and its worker link follows boxes/fleet.txt.
        // An unknown worker id is not an error: the box is monitored either way, just unlinked.
        await tx
          .insert(schema.fleetHosts)
          .values({ id: boxId, label: boxId, workerId: linked ? workerId : null })
          .onConflictDoUpdate({
            target: schema.fleetHosts.id,
            set: { workerId: linked ? workerId : null, updatedAt: now },
          });
        const revoked = await tx
          .update(schema.fleetAgents)
          .set({ revokedAt: now, revokedBy: tok.createdBy })
          .where(and(eq(schema.fleetAgents.workerId, boxId), isNull(schema.fleetAgents.revokedAt)))
          .returning({ id: schema.fleetAgents.id });
        const [row] = await tx
          .insert(schema.fleetAgents)
          .values({
            workerId: boxId,
            label: 'enrolled',
            keyHash: generated.keyHash,
            keyPrefix: generated.keyPrefix,
            createdBy: tok.createdBy,
          })
          .returning({ id: schema.fleetAgents.id });
        if (!row) throw new AppError('INSERT_FAILED', 500, 'Failed to create key');
        await tx
          .update(schema.fleetEnrollTokens)
          .set({ lastUsedAt: now })
          .where(eq(schema.fleetEnrollTokens.id, tok.id));
        // Never the key or its hash. The actor is the admin who created the token.
        await recordAudit(tx, {
          actor: { userId: tok.createdBy, role: 'enrolment-token' },
          action: 'fleet.box.enroll',
          resourceType: 'fleet_host',
          resourceId: boxId,
          after: {
            keyId: row.id,
            keyPrefix: generated.keyPrefix,
            workerId: linked ? workerId : null,
            revokedPrevious: revoked.length,
            enrollTokenId: tok.id,
          },
          request: req,
        });
        return { revokedPrevious: revoked.length, workerLinked: linked };
      });

      reply.header('cache-control', 'no-store');
      return reply.code(201).send(
        fleetEnrollResponseSchema.parse({
          boxId,
          key: generated.key,
          keyPrefix: generated.keyPrefix,
          revokedPrevious: out.revokedPrevious,
          workerLinked: out.workerLinked,
        }),
      );
    },
  );

  // ---- admin: enrolment tokens (SUPER_ADMIN via fleet.operate) --------------------------------

  app.get(
    '/admin/fleet/enroll-tokens',
    { preHandler: requirePermission('fleet.view') },
    async () => {
      const rows = await app.db
        .select()
        .from(schema.fleetEnrollTokens)
        .orderBy(desc(schema.fleetEnrollTokens.createdAt));
      return {
        tokens: rows.map((r) =>
          fleetEnrollTokenViewSchema.parse({
            id: r.id,
            label: r.label,
            tokenPrefix: r.tokenPrefix,
            createdAt: r.createdAt.toISOString(),
            revokedAt: iso(r.revokedAt),
            lastUsedAt: iso(r.lastUsedAt),
          }),
        ),
      };
    },
  );

  app.post(
    '/admin/fleet/enroll-tokens',
    { preHandler: requirePermission('fleet.operate'), schema: { body: createTokenBody } },
    async (req, reply) => {
      const label = (req.body as z.infer<typeof createTokenBody>)?.label ?? '';
      const generated = generateEnrollToken();
      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.fleetEnrollTokens)
          .values({
            label,
            tokenHash: generated.tokenHash,
            tokenPrefix: generated.tokenPrefix,
            createdBy: req.userId,
          })
          .returning();
        if (!created) throw new AppError('INSERT_FAILED', 500, 'Failed to create token');
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.enroll_token.create',
          resourceType: 'fleet_enroll_token',
          resourceId: created.id,
          after: { tokenPrefix: created.tokenPrefix, label },
          request: req,
        });
        return created;
      });
      // The only response that will ever contain the plaintext token.
      reply.header('cache-control', 'no-store');
      return reply.code(201).send(
        fleetEnrollTokenCreatedSchema.parse({
          id: row.id,
          label: row.label,
          tokenPrefix: row.tokenPrefix,
          createdAt: row.createdAt.toISOString(),
          revokedAt: null,
          lastUsedAt: null,
          token: generated.token,
        }),
      );
    },
  );

  app.delete(
    '/admin/fleet/enroll-tokens/:id',
    { preHandler: requirePermission('fleet.operate'), schema: { params: tokenParams } },
    async (req) => {
      const { id } = req.params as z.infer<typeof tokenParams>;
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fleetEnrollTokens)
          .where(eq(schema.fleetEnrollTokens.id, id))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'Token not found');
        if (row.revokedAt) return { ok: true, changed: false };
        await tx
          .update(schema.fleetEnrollTokens)
          .set({ revokedAt: new Date(), revokedBy: req.userId })
          .where(eq(schema.fleetEnrollTokens.id, id));
        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole as string },
          action: 'fleet.enroll_token.revoke',
          resourceType: 'fleet_enroll_token',
          resourceId: id,
          before: { tokenPrefix: row.tokenPrefix, label: row.label },
          request: req,
        });
        return { ok: true, changed: true };
      });
    },
  );
}
