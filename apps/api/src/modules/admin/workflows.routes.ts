import { schema } from '@aivastra/db';
import {
  CreateWorkflowBody,
  ParseWorkflowBody,
  ReassignWorkflowBody,
  UpdateWorkflowBody,
} from '@aivastra/types';
import { and, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { requireAdmin } from './guard.js';
import { classifyNode, detectMappings, type NodeCategory } from './workflow-detect.js';

type WorkflowNode = {
  class_type?: string;
  _meta?: { title?: string };
  inputs?: Record<string, unknown>;
};

// ── Validation helpers ────────────────────────────────────────────────────

function validateNodeExists(json: Record<string, unknown>, nodeId: string, role: string): void {
  if (!Object.hasOwn(json, nodeId)) {
    throw new AppError('VALIDATION', 400, `Node "${nodeId}" (${role}) not found in workflow JSON`);
  }
}

function validateNodeType(
  json: Record<string, unknown>,
  nodeId: string,
  expectedCategory: NodeCategory,
  role: string,
): void {
  const node = json[nodeId] as WorkflowNode | undefined;
  const classType = node?.class_type ?? '';
  const actual = classifyNode(classType);
  if (actual !== expectedCategory) {
    throw new AppError(
      'VALIDATION',
      400,
      `Node "${nodeId}" (${role}) is type "${classType}" but expected ${
        expectedCategory === 'image'
          ? 'LoadImage'
          : expectedCategory === 'prompt'
            ? 'TextEncode*'
            : 'EmptyLatentImage'
      }`,
    );
  }
}

function extractDefaultPrompts(
  json: Record<string, unknown>,
  negativePromptNode: string,
  positivePromptNode: string,
): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const negNode = json[negativePromptNode] as WorkflowNode | undefined;
  const posNode = json[positivePromptNode] as WorkflowNode | undefined;
  return {
    defaultFacePhasePrompt: (negNode?.inputs?.prompt as string | undefined) ?? '',
    defaultGarmentPhasePrompt: (posNode?.inputs?.prompt as string | undefined) ?? '',
  };
}

// ── Routes ────────────────────────────────────────────────────────────────

export async function adminWorkflowsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // GET /admin/workflows
  app.get('/admin/workflows', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.workflowTemplates);

    const poseCounts = await app.db
      .select({
        workflowTemplateId: schema.modelPoses.workflowTemplateId,
        cnt: count(),
      })
      .from(schema.modelPoses)
      .groupBy(schema.modelPoses.workflowTemplateId);

    const countMap = Object.fromEntries(
      poseCounts.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      isActive: r.isActive,
      poseCount: countMap[r.id] ?? 0,
      defaultFacePhasePrompt: r.defaultFacePhasePrompt,
      defaultGarmentPhasePrompt: r.defaultGarmentPhasePrompt,
      lowerNodeId: r.lowerNodeId,
      shoeNodeId: r.shoeNodeId,
      sizeNodeIds: r.sizeNodeIds,
      createdAt: r.createdAt,
    }));
  });

  // POST /admin/workflows/parse
  // Auto-detect node mappings from the workflow JSON using the naming convention.
  // Returns detected mappings + full lists of image/prompt nodes for manual override.
  app.post(
    '/admin/workflows/parse',
    {
      preHandler: W,
      schema: { body: ParseWorkflowBody },
    },
    async (req) => {
      const { jsonContent } = req.body as { jsonContent: Record<string, unknown> };

      if (typeof jsonContent !== 'object' || Array.isArray(jsonContent) || jsonContent === null) {
        throw new AppError('VALIDATION', 400, 'jsonContent must be a JSON object');
      }

      const { detected, allImageNodes, allPromptNodes, allLatentNodes } =
        detectMappings(jsonContent);

      return { detected, allImageNodes, allPromptNodes, allLatentNodes };
    },
  );

  // POST /admin/workflows
  app.post(
    '/admin/workflows',
    {
      preHandler: W,
      schema: { body: CreateWorkflowBody },
    },
    async (req) => {
      const body = req.body as {
        slug: string;
        label: string;
        jsonContent: Record<string, unknown>;
        faceNodeId: string;
        poseNodeId: string;
        bgNodeId: string;
        upperNodeIds: string[];
        lowerNodeId?: string;
        shoeNodeId?: string;
        sizeNodeIds?: string[];
        facePhasePromptNode: string;
        garmentPhasePromptNode: string;
      };

      validateNodeExists(body.jsonContent, body.faceNodeId, 'face');
      validateNodeExists(body.jsonContent, body.poseNodeId, 'pose');
      validateNodeExists(body.jsonContent, body.bgNodeId, 'background');
      for (const uid of body.upperNodeIds) {
        validateNodeExists(body.jsonContent, uid, 'upper garment');
      }
      if (body.lowerNodeId) validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment');
      if (body.shoeNodeId) validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoes');
      for (const uid of body.sizeNodeIds ?? []) {
        validateNodeExists(body.jsonContent, uid, 'size');
      }
      validateNodeExists(body.jsonContent, body.facePhasePromptNode, 'negative prompt');
      validateNodeExists(body.jsonContent, body.garmentPhasePromptNode, 'positive prompt');

      validateNodeType(body.jsonContent, body.faceNodeId, 'image', 'face');
      validateNodeType(body.jsonContent, body.poseNodeId, 'image', 'pose');
      validateNodeType(body.jsonContent, body.bgNodeId, 'image', 'background');
      for (const uid of body.upperNodeIds) {
        validateNodeType(body.jsonContent, uid, 'image', 'upper garment');
      }
      if (body.lowerNodeId)
        validateNodeType(body.jsonContent, body.lowerNodeId, 'image', 'lower garment');
      if (body.shoeNodeId) validateNodeType(body.jsonContent, body.shoeNodeId, 'image', 'shoes');
      validateNodeType(body.jsonContent, body.facePhasePromptNode, 'prompt', 'negative prompt');
      validateNodeType(body.jsonContent, body.garmentPhasePromptNode, 'prompt', 'positive prompt');

      const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
        body.jsonContent,
        body.facePhasePromptNode,
        body.garmentPhasePromptNode,
      );

      const [existing] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.slug, body.slug));
      if (existing) {
        throw new AppError('CONFLICT', 409, `Workflow with slug "${body.slug}" already exists`);
      }

      const [row] = await app.db
        .insert(schema.workflowTemplates)
        .values({
          slug: body.slug,
          label: body.label,
          jsonContent: body.jsonContent,
          faceNodeId: body.faceNodeId,
          poseNodeId: body.poseNodeId,
          bgNodeId: body.bgNodeId,
          upperNodeIds: body.upperNodeIds,
          lowerNodeId: body.lowerNodeId ?? null,
          shoeNodeId: body.shoeNodeId ?? null,
          sizeNodeIds: body.sizeNodeIds ?? [],
          facePhasePromptNode: body.facePhasePromptNode,
          garmentPhasePromptNode: body.garmentPhasePromptNode,
          defaultFacePhasePrompt,
          defaultGarmentPhasePrompt,
        })
        .returning();

      return {
        id: row?.id,
        slug: row?.slug,
        label: row?.label,
        isActive: row?.isActive,
        poseCount: 0,
        defaultFacePhasePrompt: row?.defaultFacePhasePrompt,
        defaultGarmentPhasePrompt: row?.defaultGarmentPhasePrompt,
        createdAt: row?.createdAt,
      };
    },
  );

  // GET /admin/workflows/:id
  app.get(
    '/admin/workflows/:id',
    {
      preHandler: W,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const [row] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'workflow not found');

      const [poseCountRow] = await app.db
        .select({ cnt: count() })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.workflowTemplateId, id));

      return { ...row, poseCount: Number(poseCountRow?.cnt ?? 0) };
    },
  );

  // PATCH /admin/workflows/:id
  app.patch(
    '/admin/workflows/:id',
    {
      preHandler: W,
      schema: { params: uuidParam, body: UpdateWorkflowBody },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        label?: string;
        slug?: string;
        isActive?: boolean;
        faceNodeId?: string;
        poseNodeId?: string;
        bgNodeId?: string;
        upperNodeIds?: string[];
        lowerNodeId?: string | null;
        shoeNodeId?: string | null;
        sizeNodeIds?: string[];
        facePhasePromptNode?: string;
        garmentPhasePromptNode?: string;
      };

      const [existing] = await app.db
        .select()
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, id));
      if (!existing) throw new AppError('NOT_FOUND', 404, 'workflow not found');

      const json = existing.jsonContent as Record<string, unknown>;

      if (body.faceNodeId) {
        validateNodeExists(json, body.faceNodeId, 'face');
        validateNodeType(json, body.faceNodeId, 'image', 'face');
      }
      if (body.poseNodeId) {
        validateNodeExists(json, body.poseNodeId, 'pose');
        validateNodeType(json, body.poseNodeId, 'image', 'pose');
      }
      if (body.bgNodeId) {
        validateNodeExists(json, body.bgNodeId, 'background');
        validateNodeType(json, body.bgNodeId, 'image', 'background');
      }
      if (body.upperNodeIds) {
        for (const uid of body.upperNodeIds) {
          validateNodeExists(json, uid, 'upper garment');
          validateNodeType(json, uid, 'image', 'upper garment');
        }
      }
      if (body.lowerNodeId) {
        validateNodeExists(json, body.lowerNodeId, 'lower garment');
        validateNodeType(json, body.lowerNodeId, 'image', 'lower garment');
      }
      if (body.shoeNodeId) {
        validateNodeExists(json, body.shoeNodeId, 'shoes');
        validateNodeType(json, body.shoeNodeId, 'image', 'shoes');
      }
      if (body.facePhasePromptNode) {
        validateNodeExists(json, body.facePhasePromptNode, 'negative prompt');
        validateNodeType(json, body.facePhasePromptNode, 'prompt', 'negative prompt');
      }
      if (body.garmentPhasePromptNode) {
        validateNodeExists(json, body.garmentPhasePromptNode, 'positive prompt');
        validateNodeType(json, body.garmentPhasePromptNode, 'prompt', 'positive prompt');
      }

      const newNegNode = body.facePhasePromptNode ?? existing.facePhasePromptNode;
      const newPosNode = body.garmentPhasePromptNode ?? existing.garmentPhasePromptNode;

      let defaultFacePhasePrompt = existing.defaultFacePhasePrompt;
      let defaultGarmentPhasePrompt = existing.defaultGarmentPhasePrompt;
      if (body.facePhasePromptNode || body.garmentPhasePromptNode) {
        const extracted = extractDefaultPrompts(json, newNegNode, newPosNode);
        defaultFacePhasePrompt = extracted.defaultFacePhasePrompt;
        defaultGarmentPhasePrompt = extracted.defaultGarmentPhasePrompt;
      }

      const updateValues: Record<string, unknown> = {
        updatedAt: new Date(),
        defaultFacePhasePrompt,
        defaultGarmentPhasePrompt,
      };
      if (body.label !== undefined) updateValues.label = body.label;
      if (body.slug !== undefined) {
        const [conflict] = await app.db
          .select({ id: schema.workflowTemplates.id })
          .from(schema.workflowTemplates)
          .where(
            and(eq(schema.workflowTemplates.slug, body.slug), ne(schema.workflowTemplates.id, id)),
          );
        if (conflict) throw new AppError('CONFLICT', 409, `Slug "${body.slug}" already taken`);
        updateValues.slug = body.slug;
      }
      if (body.isActive !== undefined) updateValues.isActive = body.isActive;
      if (body.faceNodeId !== undefined) updateValues.faceNodeId = body.faceNodeId;
      if (body.poseNodeId !== undefined) updateValues.poseNodeId = body.poseNodeId;
      if (body.bgNodeId !== undefined) updateValues.bgNodeId = body.bgNodeId;
      if (body.upperNodeIds !== undefined) updateValues.upperNodeIds = body.upperNodeIds;
      if ('lowerNodeId' in body) updateValues.lowerNodeId = body.lowerNodeId ?? null;
      if ('shoeNodeId' in body) updateValues.shoeNodeId = body.shoeNodeId ?? null;
      if ('sizeNodeIds' in body) updateValues.sizeNodeIds = body.sizeNodeIds ?? [];
      if (body.facePhasePromptNode !== undefined)
        updateValues.facePhasePromptNode = body.facePhasePromptNode;
      if (body.garmentPhasePromptNode !== undefined)
        updateValues.garmentPhasePromptNode = body.garmentPhasePromptNode;

      await app.db
        .update(schema.workflowTemplates)
        .set(updateValues)
        .where(eq(schema.workflowTemplates.id, id));

      return { ok: true };
    },
  );

  // POST /admin/workflows/:id/reassign
  app.post(
    '/admin/workflows/:id/reassign',
    {
      preHandler: W,
      schema: { params: uuidParam, body: ReassignWorkflowBody },
    },
    async (req) => {
      const { id: sourceId } = req.params as { id: string };
      const { targetWorkflowId } = req.body as { targetWorkflowId: string };

      if (sourceId === targetWorkflowId) {
        throw new AppError('CONFLICT', 409, 'source and target workflow are the same');
      }

      const [source] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, sourceId));
      if (!source) throw new AppError('NOT_FOUND', 404, 'source workflow not found');

      const [target] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, targetWorkflowId));
      if (!target) throw new AppError('NOT_FOUND', 404, 'target workflow not found');

      const result = await app.db
        .update(schema.modelPoses)
        .set({ workflowTemplateId: targetWorkflowId })
        .where(eq(schema.modelPoses.workflowTemplateId, sourceId))
        .returning({ id: schema.modelPoses.id });

      return { ok: true, updated: result.length };
    },
  );

  // DELETE /admin/workflows/:id
  app.delete(
    '/admin/workflows/:id',
    {
      preHandler: W,
      schema: { params: uuidParam },
    },
    async (req) => {
      const { id } = req.params as { id: string };

      const [row] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.id, id));
      if (!row) throw new AppError('NOT_FOUND', 404, 'workflow not found');

      const [poseCountRow] = await app.db
        .select({ cnt: count() })
        .from(schema.modelPoses)
        .where(eq(schema.modelPoses.workflowTemplateId, id));
      const poseCount = Number(poseCountRow?.cnt ?? 0);
      if (poseCount > 0) {
        throw new AppError(
          'CONFLICT',
          409,
          `Cannot delete: ${poseCount} pose${poseCount === 1 ? '' : 's'} use this workflow. Reassign those poses first.`,
        );
      }

      await app.db.delete(schema.workflowTemplates).where(eq(schema.workflowTemplates.id, id));

      return { ok: true };
    },
  );
}
