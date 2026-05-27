import type { FastifyInstance } from 'fastify';
import { schema } from '@aivastra/db';
import { eq, count } from 'drizzle-orm';
import { z } from 'zod';
import { CreateWorkflowBody, ParseWorkflowBody, UpdateWorkflowBody } from '@aivastra/types';
import { requireAdmin } from './guard.js';
import { AppError } from '../../lib/errors.js';

// ── Node extraction helpers ───────────────────────────────────────────────

type WorkflowNode = {
  class_type?: string;
  _meta?: { title?: string };
  inputs?: Record<string, unknown>;
};

type NodeCategory = 'image' | 'prompt' | 'other';

function classifyNode(classType: string): NodeCategory {
  if (classType === 'LoadImage') return 'image';
  if (classType.includes('TextEncode')) return 'prompt';
  return 'other';
}

function parseWorkflowNodes(json: Record<string, unknown>) {
  const nodes: { id: string; class_type: string; title: string; category: NodeCategory }[] = [];

  for (const [nodeId, raw] of Object.entries(json)) {
    const node = raw as WorkflowNode;
    const classType = node.class_type ?? '';
    const title = node._meta?.title ?? nodeId;
    const category = classifyNode(classType);
    nodes.push({ id: nodeId, class_type: classType, title, category });
  }

  // Sort: images first, then prompts, then other; alphabetical within each group
  const order: Record<NodeCategory, number> = { image: 0, prompt: 1, other: 2 };
  return nodes.sort((a, b) => {
    if (a.category !== b.category) return order[a.category] - order[b.category];
    return a.title.localeCompare(b.title);
  });
}

function extractDefaultPrompts(
  json: Record<string, unknown>,
  facePhaseNode: string,
  garmentPhaseNode: string,
): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const faceNode = json[facePhaseNode] as WorkflowNode | undefined;
  const garmentNode = json[garmentPhaseNode] as WorkflowNode | undefined;
  return {
    defaultFacePhasePrompt: (faceNode?.inputs?.['prompt'] as string | undefined) ?? '',
    defaultGarmentPhasePrompt: (garmentNode?.inputs?.['prompt'] as string | undefined) ?? '',
  };
}

// ── Validation helpers ────────────────────────────────────────────────────

function validateNodeExists(json: Record<string, unknown>, nodeId: string, role: string): void {
  if (!Object.prototype.hasOwnProperty.call(json, nodeId)) {
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
      'VALIDATION', 400,
      `Node "${nodeId}" (${role}) is type "${classType}" but expected ${expectedCategory === 'image' ? 'LoadImage' : 'TextEncode*'}`,
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

export async function adminWorkflowsRoutes(app: FastifyInstance) {
  const W = requireAdmin(['SUPER_ADMIN', 'MODERATOR']);
  const uuidParam = z.object({ id: z.string().uuid() });

  // GET /admin/workflows
  // Returns all workflows — serves both the list page and pose modals
  app.get('/admin/workflows', { preHandler: W }, async () => {
    const rows = await app.db.select().from(schema.workflowTemplates);

    // Get pose counts per workflow
    const poseCounts = await app.db
      .select({
        workflowTemplateId: schema.modelPoses.workflowTemplateId,
        cnt: count(),
      })
      .from(schema.modelPoses)
      .groupBy(schema.modelPoses.workflowTemplateId);

    const countMap = Object.fromEntries(poseCounts.map((r) => [r.workflowTemplateId, Number(r.cnt)]));

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      isActive: r.isActive,
      poseCount: countMap[r.id] ?? 0,
      defaultFacePhasePrompt: r.defaultFacePhasePrompt,
      defaultGarmentPhasePrompt: r.defaultGarmentPhasePrompt,
      createdAt: r.createdAt,
    }));
  });

  // POST /admin/workflows/parse
  // Extract node metadata from a workflow JSON without saving it
  app.post('/admin/workflows/parse', {
    preHandler: W,
    schema: { body: ParseWorkflowBody },
  }, async (req) => {
    const { jsonContent } = req.body as { jsonContent: Record<string, unknown> };

    if (typeof jsonContent !== 'object' || Array.isArray(jsonContent) || jsonContent === null) {
      throw new AppError('VALIDATION', 400, 'jsonContent must be a JSON object');
    }

    const nodes = parseWorkflowNodes(jsonContent);

    // Best-effort: find first prompt node and extract its default prompt text
    const promptNodes = nodes.filter((n) => n.category === 'prompt');
    const defaultPrompts: { facePhase?: string; garmentPhase?: string } = {};
    if (promptNodes[0]) {
      const n = jsonContent[promptNodes[0].id] as WorkflowNode;
      defaultPrompts.facePhase = (n?.inputs?.['prompt'] as string | undefined) ?? '';
    }
    if (promptNodes[1]) {
      const n = jsonContent[promptNodes[1].id] as WorkflowNode;
      defaultPrompts.garmentPhase = (n?.inputs?.['prompt'] as string | undefined) ?? '';
    }

    return { nodes, defaultPrompts };
  });

  // POST /admin/workflows
  // Create a new workflow template
  app.post('/admin/workflows', {
    preHandler: W,
    schema: { body: CreateWorkflowBody },
  }, async (req) => {
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
      facePhasePromptNode: string;
      garmentPhasePromptNode: string;
    };

    // Validate all referenced node IDs exist in the JSON
    validateNodeExists(body.jsonContent, body.faceNodeId, 'face image');
    validateNodeExists(body.jsonContent, body.poseNodeId, 'pose image');
    validateNodeExists(body.jsonContent, body.bgNodeId, 'background image');
    for (const uid of body.upperNodeIds) {
      validateNodeExists(body.jsonContent, uid, 'upper garment image');
    }
    if (body.lowerNodeId) {
      validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment image');
    }
    if (body.shoeNodeId) {
      validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoe image');
    }
    validateNodeExists(body.jsonContent, body.facePhasePromptNode, 'face phase prompt');
    validateNodeExists(body.jsonContent, body.garmentPhasePromptNode, 'garment phase prompt');

    // Validate node types
    validateNodeType(body.jsonContent, body.faceNodeId, 'image', 'face image');
    validateNodeType(body.jsonContent, body.poseNodeId, 'image', 'pose image');
    validateNodeType(body.jsonContent, body.bgNodeId, 'image', 'background image');
    for (const uid of body.upperNodeIds) {
      validateNodeType(body.jsonContent, uid, 'image', 'upper garment image');
    }
    if (body.lowerNodeId) {
      validateNodeType(body.jsonContent, body.lowerNodeId, 'image', 'lower garment image');
    }
    if (body.shoeNodeId) {
      validateNodeType(body.jsonContent, body.shoeNodeId, 'image', 'shoe image');
    }
    validateNodeType(body.jsonContent, body.facePhasePromptNode, 'prompt', 'face phase prompt');
    validateNodeType(body.jsonContent, body.garmentPhasePromptNode, 'prompt', 'garment phase prompt');

    // Extract default prompts from JSON
    const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
      body.jsonContent,
      body.facePhasePromptNode,
      body.garmentPhasePromptNode,
    );

    // Check slug uniqueness
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
        facePhasePromptNode: body.facePhasePromptNode,
        garmentPhasePromptNode: body.garmentPhasePromptNode,
        defaultFacePhasePrompt,
        defaultGarmentPhasePrompt,
      })
      .returning();

    return {
      id: row!.id,
      slug: row!.slug,
      label: row!.label,
      isActive: row!.isActive,
      poseCount: 0,
      defaultFacePhasePrompt: row!.defaultFacePhasePrompt,
      defaultGarmentPhasePrompt: row!.defaultGarmentPhasePrompt,
      createdAt: row!.createdAt,
    };
  });

  // GET /admin/workflows/:id
  // Get full workflow detail including JSON content
  app.get('/admin/workflows/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
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

    return {
      ...row,
      poseCount: Number(poseCountRow?.cnt ?? 0),
    };
  });

  // PATCH /admin/workflows/:id
  // Update metadata and/or node mappings (not the JSON content itself)
  app.patch('/admin/workflows/:id', {
    preHandler: W,
    schema: { params: uuidParam, body: UpdateWorkflowBody },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      label?: string;
      isActive?: boolean;
      faceNodeId?: string;
      poseNodeId?: string;
      bgNodeId?: string;
      upperNodeIds?: string[];
      lowerNodeId?: string | null;
      shoeNodeId?: string | null;
      facePhasePromptNode?: string;
      garmentPhasePromptNode?: string;
    };

    const [existing] = await app.db
      .select()
      .from(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));
    if (!existing) throw new AppError('NOT_FOUND', 404, 'workflow not found');

    // If prompt nodes are being updated, re-extract defaults from stored JSON
    let defaultFacePhasePrompt = existing.defaultFacePhasePrompt;
    let defaultGarmentPhasePrompt = existing.defaultGarmentPhasePrompt;

    const json = existing.jsonContent as Record<string, unknown>;
    const newFacePromptNode = body.facePhasePromptNode ?? existing.facePhasePromptNode;
    const newGarmentPromptNode = body.garmentPhasePromptNode ?? existing.garmentPhasePromptNode;

    if (body.facePhasePromptNode || body.garmentPhasePromptNode) {
      // Validate new prompt nodes exist
      if (body.facePhasePromptNode) validateNodeExists(json, body.facePhasePromptNode, 'face phase prompt');
      if (body.garmentPhasePromptNode) validateNodeExists(json, body.garmentPhasePromptNode, 'garment phase prompt');

      const extracted = extractDefaultPrompts(json, newFacePromptNode, newGarmentPromptNode);
      defaultFacePhasePrompt = extracted.defaultFacePhasePrompt;
      defaultGarmentPhasePrompt = extracted.defaultGarmentPhasePrompt;
    }

    // Validate any new node IDs exist in the stored JSON
    if (body.faceNodeId) validateNodeExists(json, body.faceNodeId, 'face image');
    if (body.poseNodeId) validateNodeExists(json, body.poseNodeId, 'pose image');
    if (body.bgNodeId) validateNodeExists(json, body.bgNodeId, 'background image');
    if (body.upperNodeIds) {
      for (const uid of body.upperNodeIds) validateNodeExists(json, uid, 'upper garment image');
    }
    if (body.lowerNodeId) validateNodeExists(json, body.lowerNodeId, 'lower garment image');
    if (body.shoeNodeId) validateNodeExists(json, body.shoeNodeId, 'shoe image');

    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
      defaultFacePhasePrompt,
      defaultGarmentPhasePrompt,
    };
    if (body.label !== undefined) updateValues['label'] = body.label;
    if (body.isActive !== undefined) updateValues['isActive'] = body.isActive;
    if (body.faceNodeId !== undefined) updateValues['faceNodeId'] = body.faceNodeId;
    if (body.poseNodeId !== undefined) updateValues['poseNodeId'] = body.poseNodeId;
    if (body.bgNodeId !== undefined) updateValues['bgNodeId'] = body.bgNodeId;
    if (body.upperNodeIds !== undefined) updateValues['upperNodeIds'] = body.upperNodeIds;
    if ('lowerNodeId' in body) updateValues['lowerNodeId'] = body.lowerNodeId ?? null;
    if ('shoeNodeId' in body) updateValues['shoeNodeId'] = body.shoeNodeId ?? null;
    if (body.facePhasePromptNode !== undefined) updateValues['facePhasePromptNode'] = body.facePhasePromptNode;
    if (body.garmentPhasePromptNode !== undefined) updateValues['garmentPhasePromptNode'] = body.garmentPhasePromptNode;

    await app.db
      .update(schema.workflowTemplates)
      .set(updateValues)
      .where(eq(schema.workflowTemplates.id, id));

    return { ok: true };
  });

  // DELETE /admin/workflows/:id
  // Hard delete — blocked if any poses currently use this workflow
  app.delete('/admin/workflows/:id', {
    preHandler: W,
    schema: { params: uuidParam },
  }, async (req) => {
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
        'CONFLICT', 409,
        `Cannot delete: ${poseCount} pose${poseCount === 1 ? '' : 's'} use this workflow. Delete those poses first.`,
      );
    }

    await app.db
      .delete(schema.workflowTemplates)
      .where(eq(schema.workflowTemplates.id, id));

    return { ok: true };
  });
}
