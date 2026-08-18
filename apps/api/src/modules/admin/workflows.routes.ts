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
import { recordAudit } from './audit.js';
import { requirePermission } from './guard.js';
import { detectTryonMappings } from './tryon-detect.js';
import { detectTryonTwoInputMappings } from './tryon-two-input-detect.js';
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

// Different ComfyUI node types store their text under different input keys —
// standard CLIPTextEncode uses "text", custom nodes (e.g. TextEncodeQwenImageEditPlusPro)
// use "prompt". Try both rather than assuming one.
function extractPromptText(node: WorkflowNode | undefined): string {
  const inputs = node?.inputs;
  return (inputs?.prompt as string | undefined) ?? (inputs?.text as string | undefined) ?? '';
}

function extractDefaultPrompts(
  json: Record<string, unknown>,
  negativePromptNode: string | null,
  positivePromptNode: string,
): { defaultFacePhasePrompt: string; defaultGarmentPhasePrompt: string } {
  const negNode = negativePromptNode
    ? (json[negativePromptNode] as WorkflowNode | undefined)
    : undefined;
  const posNode = json[positivePromptNode] as WorkflowNode | undefined;
  return {
    defaultFacePhasePrompt: extractPromptText(negNode),
    defaultGarmentPhasePrompt: extractPromptText(posNode),
  };
}

// Writes into whichever key the node already uses (standard CLIPTextEncode = "text",
// custom nodes like TextEncodeQwenImageEditPlusPro = "prompt") — mirrors extractPromptText's
// read priority so a write always lands in the field ComfyUI actually reads for that node.
// Defaults to "text" (the standard CLIPTextEncode key) when the node has neither key yet.
function writePromptText(json: Record<string, unknown>, nodeId: string, text: string): void {
  const node = json[nodeId] as WorkflowNode | undefined;
  if (!node) return;
  node.inputs ??= {};
  const key = 'prompt' in node.inputs ? 'prompt' : 'text';
  node.inputs[key] = text;
}

// Every real workflow has exactly one KSampler node (verified against production
// workflow exports) — found by class_type, not a stored node-id column, since
// nothing else needs to identify it and a scan is O(nodes) on an already-small JSON.
function findKSamplerNode(
  json: Record<string, unknown>,
): { nodeId: string; node: WorkflowNode } | null {
  for (const [nodeId, value] of Object.entries(json)) {
    const node = value as WorkflowNode;
    if (node?.class_type === 'KSampler') return { nodeId, node };
  }
  return null;
}

function extractKSamplerValues(json: Record<string, unknown>): {
  ksamplerSteps: number | null;
  ksamplerCfg: number | null;
  ksamplerDenoise: number | null;
} {
  const inputs = findKSamplerNode(json)?.node.inputs;
  return {
    ksamplerSteps: typeof inputs?.steps === 'number' ? inputs.steps : null,
    ksamplerCfg: typeof inputs?.cfg === 'number' ? inputs.cfg : null,
    ksamplerDenoise: typeof inputs?.denoise === 'number' ? inputs.denoise : null,
  };
}

// Returns false (no write performed) when the workflow has no KSampler node —
// caller turns that into a 400, mirroring the facePhasePrompt-with-no-node case.
function writeKSamplerValues(
  json: Record<string, unknown>,
  values: { steps?: number; cfg?: number; denoise?: number },
): boolean {
  const found = findKSamplerNode(json);
  if (!found) return false;
  found.node.inputs ??= {};
  if (values.steps !== undefined) found.node.inputs.steps = values.steps;
  if (values.cfg !== undefined) found.node.inputs.cfg = values.cfg;
  if (values.denoise !== undefined) found.node.inputs.denoise = values.denoise;
  return true;
}

// ── Routes ────────────────────────────────────────────────────────────────

export async function adminWorkflowsRoutes(app: FastifyInstance) {
  const W = requirePermission('workflows.write');
  const R = requirePermission('workflows.read');
  const uuidParam = z.object({ id: z.string().uuid() });

  // GET /admin/workflows
  app.get('/admin/workflows', { preHandler: R }, async () => {
    const rows = await app.db.select().from(schema.workflowTemplates);

    const poseCounts = await app.db
      .select({
        workflowTemplateId: schema.modelPoseAssets.workflowTemplateId,
        cnt: count(),
      })
      .from(schema.modelPoseAssets)
      .groupBy(schema.modelPoseAssets.workflowTemplateId);

    const countMap = Object.fromEntries(
      poseCounts.map((r) => [r.workflowTemplateId, Number(r.cnt)]),
    );

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label: r.label,
      workflowType: r.workflowType,
      isActive: r.isActive,
      poseCount: countMap[r.id] ?? 0,
      defaultFacePhasePrompt: r.defaultFacePhasePrompt,
      defaultGarmentPhasePrompt: r.defaultGarmentPhasePrompt,
      facePhasePromptNode: r.facePhasePromptNode,
      ...extractKSamplerValues(r.jsonContent as Record<string, unknown>),
      lowerNodeId: r.lowerNodeId,
      shoeNodeId: r.shoeNodeId,
      thirdNodeId: r.thirdNodeId,
      sizeNodeIds: r.sizeNodeIds,
      latentSizeNodeIds: r.latentSizeNodeIds,
      latentMaxPx: r.latentMaxPx,
      outputSizeNodeIds: r.outputSizeNodeIds,
      outputMaxPx: r.outputMaxPx,
      resultNodeId: r.resultNodeId,
      tryonPersonNodeId: r.tryonPersonNodeId,
      tryonGarmentNodeId: r.tryonGarmentNodeId,
      tryonGarmentNodeId2: r.tryonGarmentNodeId2,
      tryonOutputNodeId: r.tryonOutputNodeId,
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

      const parseWorkflowType = (req.body as { workflowType?: string }).workflowType;
      if (parseWorkflowType === 'tryon' || parseWorkflowType === 'saree_step1') {
        const { detected, allImageNodes, allPromptNodes } = detectTryonMappings(jsonContent);
        return { detected, allImageNodes, allPromptNodes };
      }
      if (parseWorkflowType === 'saree_step1_two_input') {
        const { detected, allImageNodes, allPromptNodes } =
          detectTryonTwoInputMappings(jsonContent);
        return { detected, allImageNodes, allPromptNodes };
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
        workflowType?: string;
        faceNodeId?: string;
        poseNodeId?: string;
        bgNodeId?: string;
        upperNodeIds?: string[];
        lowerNodeId?: string;
        shoeNodeId?: string;
        thirdNodeId?: string;
        sizeNodeIds?: string[];
        latentSizeNodeIds?: string[];
        latentMaxPx?: number;
        outputSizeNodeIds?: string[];
        outputMaxPx?: number;
        resultNodeId?: string;
        facePhasePromptNode?: string;
        garmentPhasePromptNode?: string;
        tryonPersonNodeId?: string;
        tryonGarmentNodeId?: string;
        tryonGarmentNodeId2?: string;
        tryonOutputNodeId?: string;
      };

      const [existing] = await app.db
        .select({ id: schema.workflowTemplates.id })
        .from(schema.workflowTemplates)
        .where(eq(schema.workflowTemplates.slug, body.slug));
      if (existing) {
        throw new AppError('CONFLICT', 409, `Workflow with slug "${body.slug}" already exists`);
      }

      const workflowType = body.workflowType ?? 'regular';

      if (workflowType === 'saree_step1_two_input') {
        const { detected: autoDetected } = detectTryonTwoInputMappings(body.jsonContent);
        const personNodeId = body.tryonPersonNodeId ?? autoDetected.personNodeId ?? '';
        const bodyNodeId = body.tryonGarmentNodeId ?? autoDetected.bodyNodeId ?? '';
        const palluNodeId = body.tryonGarmentNodeId2 ?? autoDetected.palluNodeId ?? '';
        const outputNodeId = body.tryonOutputNodeId ?? autoDetected.outputNodeId ?? '';
        // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
        const negNode = body.facePhasePromptNode!;
        // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
        const posNode = body.garmentPhasePromptNode!;
        if (!bodyNodeId)
          throw new AppError(
            'VALIDATION',
            400,
            'Could not detect body node — set tryonGarmentNodeId manually',
          );
        if (!palluNodeId)
          throw new AppError(
            'VALIDATION',
            400,
            'Could not detect pallu node — set tryonGarmentNodeId2 manually',
          );
        if (!outputNodeId)
          throw new AppError(
            'VALIDATION',
            400,
            'Could not detect output node — set tryonOutputNodeId manually',
          );
        if (personNodeId) {
          validateNodeExists(body.jsonContent, personNodeId, 'person');
          validateNodeType(body.jsonContent, personNodeId, 'image', 'person');
        }
        validateNodeExists(body.jsonContent, bodyNodeId, 'body');
        validateNodeExists(body.jsonContent, palluNodeId, 'pallu');
        validateNodeExists(body.jsonContent, outputNodeId, 'output');
        validateNodeExists(body.jsonContent, negNode, 'negative prompt');
        validateNodeExists(body.jsonContent, posNode, 'positive prompt');
        validateNodeType(body.jsonContent, bodyNodeId, 'image', 'body');
        validateNodeType(body.jsonContent, palluNodeId, 'image', 'pallu');
        validateNodeType(body.jsonContent, negNode, 'prompt', 'negative prompt');
        validateNodeType(body.jsonContent, posNode, 'prompt', 'positive prompt');
        const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
          body.jsonContent,
          negNode,
          posNode,
        );
        const row = await app.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(schema.workflowTemplates)
            .values({
              slug: body.slug,
              label: body.label,
              jsonContent: body.jsonContent,
              workflowType,
              faceNodeId: '',
              poseNodeId: '',
              bgNodeId: '',
              upperNodeIds: [],
              facePhasePromptNode: negNode,
              garmentPhasePromptNode: posNode,
              defaultFacePhasePrompt,
              defaultGarmentPhasePrompt,
              tryonPersonNodeId: personNodeId || null,
              tryonGarmentNodeId: bodyNodeId,
              tryonGarmentNodeId2: palluNodeId,
              tryonOutputNodeId: outputNodeId,
            })
            .returning();
          if (!inserted)
            throw new AppError('INSERT_FAILED', 500, 'failed to insert workflow template');

          await recordAudit(tx, {
            actor: { userId: req.userId, role: req.adminRole! },
            action: 'workflow.create',
            resourceType: 'workflow',
            resourceId: inserted.id,
            after: {
              id: inserted.id,
              slug: inserted.slug,
              label: inserted.label,
              workflowType: inserted.workflowType,
            },
            request: req,
          });

          return inserted;
        });
        return {
          id: row?.id,
          slug: row?.slug,
          label: row?.label,
          workflowType: row?.workflowType,
          isActive: row?.isActive,
          poseCount: 0,
          defaultFacePhasePrompt: row?.defaultFacePhasePrompt,
          defaultGarmentPhasePrompt: row?.defaultGarmentPhasePrompt,
          tryonPersonNodeId: row?.tryonPersonNodeId,
          tryonGarmentNodeId: row?.tryonGarmentNodeId,
          tryonGarmentNodeId2: row?.tryonGarmentNodeId2,
          tryonOutputNodeId: row?.tryonOutputNodeId,
          createdAt: row?.createdAt,
        };
      }

      if (workflowType === 'tryon' || workflowType === 'saree_step1') {
        // Auto-detect node IDs from JSON when not explicitly provided
        const { detected: autoDetected } = detectTryonMappings(body.jsonContent);
        const personNodeId = body.tryonPersonNodeId ?? autoDetected.personNodeId ?? '';
        const garmentNodeId = body.tryonGarmentNodeId ?? autoDetected.garmentNodeId ?? '';
        const outputNodeId = body.tryonOutputNodeId ?? autoDetected.outputNodeId ?? '';
        // CreateWorkflowBody.superRefine() requires these fields for workflowType 'tryon',
        // but the zod type itself keeps them optional — safe to assert here.
        // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
        const negNode = body.facePhasePromptNode!;
        // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
        const posNode = body.garmentPhasePromptNode!;

        // personNodeId is optional — some tryon/saree_step1 workflows bake the
        // face in directly (e.g. a fixed-URL node) instead of a patchable LoadImage.
        if (!garmentNodeId)
          throw new AppError(
            'VALIDATION',
            400,
            'Could not detect garment node — set tryonGarmentNodeId manually',
          );
        if (!outputNodeId)
          throw new AppError(
            'VALIDATION',
            400,
            'Could not detect output node — set tryonOutputNodeId manually',
          );

        if (personNodeId) {
          validateNodeExists(body.jsonContent, personNodeId, 'person');
          validateNodeType(body.jsonContent, personNodeId, 'image', 'person');
        }
        validateNodeExists(body.jsonContent, garmentNodeId, 'garment');
        validateNodeExists(body.jsonContent, outputNodeId, 'output');
        validateNodeExists(body.jsonContent, negNode, 'negative prompt');
        validateNodeExists(body.jsonContent, posNode, 'positive prompt');
        validateNodeType(body.jsonContent, garmentNodeId, 'image', 'garment');
        validateNodeType(body.jsonContent, negNode, 'prompt', 'negative prompt');
        validateNodeType(body.jsonContent, posNode, 'prompt', 'positive prompt');

        const { defaultFacePhasePrompt, defaultGarmentPhasePrompt } = extractDefaultPrompts(
          body.jsonContent,
          negNode,
          posNode,
        );

        const row = await app.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(schema.workflowTemplates)
            .values({
              slug: body.slug,
              label: body.label,
              jsonContent: body.jsonContent,
              workflowType,
              faceNodeId: '',
              poseNodeId: '',
              bgNodeId: '',
              upperNodeIds: [],
              facePhasePromptNode: negNode,
              garmentPhasePromptNode: posNode,
              defaultFacePhasePrompt,
              defaultGarmentPhasePrompt,
              tryonPersonNodeId: personNodeId || null,
              tryonGarmentNodeId: garmentNodeId,
              tryonOutputNodeId: outputNodeId,
            })
            .returning();
          if (!inserted)
            throw new AppError('INSERT_FAILED', 500, 'failed to insert workflow template');

          await recordAudit(tx, {
            actor: { userId: req.userId, role: req.adminRole! },
            action: 'workflow.create',
            resourceType: 'workflow',
            resourceId: inserted.id,
            after: {
              id: inserted.id,
              slug: inserted.slug,
              label: inserted.label,
              workflowType: inserted.workflowType,
            },
            request: req,
          });

          return inserted;
        });

        return {
          id: row?.id,
          slug: row?.slug,
          label: row?.label,
          workflowType: row?.workflowType,
          isActive: row?.isActive,
          poseCount: 0,
          defaultFacePhasePrompt: row?.defaultFacePhasePrompt,
          defaultGarmentPhasePrompt: row?.defaultGarmentPhasePrompt,
          tryonPersonNodeId: row?.tryonPersonNodeId,
          tryonGarmentNodeId: row?.tryonGarmentNodeId,
          tryonOutputNodeId: row?.tryonOutputNodeId,
          createdAt: row?.createdAt,
        };
      }

      // Regular workflow — full node validation.
      // CreateWorkflowBody.superRefine() requires these fields for workflowType 'regular',
      // but the zod type itself keeps them optional — safe to assert here.
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const poseNodeId = body.poseNodeId!;
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by CreateWorkflowBody's superRefine
      const garmentPhasePromptNode = body.garmentPhasePromptNode!;
      const upperNodeIds = body.upperNodeIds ?? [];

      validateNodeExists(body.jsonContent, poseNodeId, 'pose');
      validateNodeType(body.jsonContent, poseNodeId, 'image', 'pose');
      if (body.faceNodeId) {
        validateNodeExists(body.jsonContent, body.faceNodeId, 'face');
        validateNodeType(body.jsonContent, body.faceNodeId, 'image', 'face');
      }
      if (body.bgNodeId) {
        validateNodeExists(body.jsonContent, body.bgNodeId, 'background');
        validateNodeType(body.jsonContent, body.bgNodeId, 'image', 'background');
      }
      for (const uid of upperNodeIds) {
        validateNodeExists(body.jsonContent, uid, 'upper garment');
      }
      if (body.lowerNodeId) validateNodeExists(body.jsonContent, body.lowerNodeId, 'lower garment');
      if (body.shoeNodeId) validateNodeExists(body.jsonContent, body.shoeNodeId, 'shoes');
      if (body.thirdNodeId) validateNodeExists(body.jsonContent, body.thirdNodeId, 'third garment');
      for (const uid of body.sizeNodeIds ?? []) {
        validateNodeExists(body.jsonContent, uid, 'size');
      }
      validateNodeExists(body.jsonContent, garmentPhasePromptNode, 'positive prompt');

      for (const uid of upperNodeIds) {
        validateNodeType(body.jsonContent, uid, 'image', 'upper garment');
      }
      if (body.lowerNodeId)
        validateNodeType(body.jsonContent, body.lowerNodeId, 'image', 'lower garment');
      if (body.shoeNodeId) validateNodeType(body.jsonContent, body.shoeNodeId, 'image', 'shoes');
      if (body.thirdNodeId)
        validateNodeType(body.jsonContent, body.thirdNodeId, 'image', 'third garment');
      validateNodeType(body.jsonContent, garmentPhasePromptNode, 'prompt', 'positive prompt');
      if (body.facePhasePromptNode) {
        validateNodeExists(body.jsonContent, body.facePhasePromptNode, 'negative prompt');
        validateNodeType(body.jsonContent, body.facePhasePromptNode, 'prompt', 'negative prompt');
      }

      const defaultGarmentPhasePrompt = extractPromptText(
        body.jsonContent[garmentPhasePromptNode] as WorkflowNode | undefined,
      );
      const defaultFacePhasePrompt = body.facePhasePromptNode
        ? extractPromptText(body.jsonContent[body.facePhasePromptNode] as WorkflowNode | undefined)
        : '';

      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(schema.workflowTemplates)
          .values({
            slug: body.slug,
            label: body.label,
            jsonContent: body.jsonContent,
            workflowType: 'regular',
            faceNodeId: body.faceNodeId ?? null,
            poseNodeId,
            bgNodeId: body.bgNodeId ?? null,
            upperNodeIds,
            lowerNodeId: body.lowerNodeId ?? null,
            shoeNodeId: body.shoeNodeId ?? null,
            thirdNodeId: body.thirdNodeId ?? null,
            sizeNodeIds: body.sizeNodeIds ?? [],
            latentSizeNodeIds: body.latentSizeNodeIds ?? [],
            ...(body.latentMaxPx !== undefined ? { latentMaxPx: body.latentMaxPx } : {}),
            outputSizeNodeIds: body.outputSizeNodeIds ?? [],
            ...(body.outputMaxPx !== undefined ? { outputMaxPx: body.outputMaxPx } : {}),
            resultNodeId: body.resultNodeId ?? null,
            facePhasePromptNode: body.facePhasePromptNode ?? null,
            garmentPhasePromptNode,
            defaultFacePhasePrompt,
            defaultGarmentPhasePrompt,
          })
          .returning();
        if (!inserted)
          throw new AppError('INSERT_FAILED', 500, 'failed to insert workflow template');

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.create',
          resourceType: 'workflow',
          resourceId: inserted.id,
          after: {
            id: inserted.id,
            slug: inserted.slug,
            label: inserted.label,
            workflowType: inserted.workflowType,
          },
          request: req,
        });

        return inserted;
      });

      return {
        id: row?.id,
        slug: row?.slug,
        label: row?.label,
        workflowType: row?.workflowType,
        isActive: row?.isActive,
        poseCount: 0,
        defaultFacePhasePrompt: row?.defaultFacePhasePrompt,
        defaultGarmentPhasePrompt: row?.defaultGarmentPhasePrompt,
        upperNodeIds: row?.upperNodeIds,
        lowerNodeId: row?.lowerNodeId,
        shoeNodeId: row?.shoeNodeId,
        thirdNodeId: row?.thirdNodeId,
        sizeNodeIds: row?.sizeNodeIds,
        latentSizeNodeIds: row?.latentSizeNodeIds,
        outputSizeNodeIds: row?.outputSizeNodeIds,
        resultNodeId: row?.resultNodeId,
        createdAt: row?.createdAt,
      };
    },
  );

  // GET /admin/workflows/:id
  app.get(
    '/admin/workflows/:id',
    {
      preHandler: R,
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
        .from(schema.modelPoseAssets)
        .where(eq(schema.modelPoseAssets.workflowTemplateId, id));

      return {
        ...row,
        poseCount: Number(poseCountRow?.cnt ?? 0),
        ...extractKSamplerValues(row.jsonContent as Record<string, unknown>),
      };
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
        thirdNodeId?: string | null;
        sizeNodeIds?: string[];
        latentSizeNodeIds?: string[];
        latentMaxPx?: number;
        outputSizeNodeIds?: string[];
        outputMaxPx?: number;
        resultNodeId?: string | null;
        facePhasePromptNode?: string;
        garmentPhasePromptNode?: string;
        garmentPhasePrompt?: string;
        facePhasePrompt?: string;
        ksamplerSteps?: number;
        ksamplerCfg?: number;
        ksamplerDenoise?: number;
        tryonPersonNodeId?: string | null;
        tryonGarmentNodeId?: string | null;
        tryonGarmentNodeId2?: string | null;
        tryonOutputNodeId?: string | null;
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
      if (body.thirdNodeId) {
        validateNodeExists(json, body.thirdNodeId, 'third garment');
        validateNodeType(json, body.thirdNodeId, 'image', 'third garment');
      }
      if (body.facePhasePromptNode) {
        validateNodeExists(json, body.facePhasePromptNode, 'negative prompt');
        validateNodeType(json, body.facePhasePromptNode, 'prompt', 'negative prompt');
      }
      if (body.garmentPhasePromptNode) {
        validateNodeExists(json, body.garmentPhasePromptNode, 'positive prompt');
        validateNodeType(json, body.garmentPhasePromptNode, 'prompt', 'positive prompt');
      }

      const mergedUpperNodeIds = body.upperNodeIds ?? existing.upperNodeIds;
      const mergedLowerNodeId =
        body.lowerNodeId !== undefined ? body.lowerNodeId : existing.lowerNodeId;
      const mergedFaceNodeId =
        body.faceNodeId !== undefined ? body.faceNodeId : existing.faceNodeId;
      const mergedFacePhasePromptNode =
        body.facePhasePromptNode !== undefined
          ? body.facePhasePromptNode
          : existing.facePhasePromptNode;

      if (existing.workflowType === 'regular') {
        const hasUpper = mergedUpperNodeIds.length > 0;
        const hasLower = !!mergedLowerNodeId;
        if (!hasUpper && !hasLower) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot clear the last garment role - at least one of upperNodeIds/lowerNodeId must remain set',
          );
        }
        if (mergedFaceNodeId && !mergedFacePhasePromptNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot leave faceNodeId set without facePhasePromptNode',
          );
        }
      }

      const newNegNode = body.facePhasePromptNode ?? existing.facePhasePromptNode;
      const newPosNode = body.garmentPhasePromptNode ?? existing.garmentPhasePromptNode;

      if (body.garmentPhasePrompt !== undefined) {
        if (!body.garmentPhasePrompt.trim()) {
          throw new AppError(
            'VALIDATION',
            400,
            'garmentPhasePrompt cannot be empty — an empty positive prompt causes ComfyUI to reject the job',
          );
        }
        writePromptText(json, newPosNode, body.garmentPhasePrompt);
      }
      if (body.facePhasePrompt !== undefined) {
        if (!newNegNode) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot set facePhasePrompt: this workflow has no face-phase prompt node',
          );
        }
        writePromptText(json, newNegNode, body.facePhasePrompt);
      }
      if (
        body.ksamplerSteps !== undefined ||
        body.ksamplerCfg !== undefined ||
        body.ksamplerDenoise !== undefined
      ) {
        const wrote = writeKSamplerValues(json, {
          steps: body.ksamplerSteps,
          cfg: body.ksamplerCfg,
          denoise: body.ksamplerDenoise,
        });
        if (!wrote) {
          throw new AppError(
            'VALIDATION',
            400,
            'cannot set ksampler values: this workflow has no KSampler node',
          );
        }
      }

      let defaultFacePhasePrompt = existing.defaultFacePhasePrompt;
      let defaultGarmentPhasePrompt = existing.defaultGarmentPhasePrompt;
      if (
        body.facePhasePromptNode ||
        body.garmentPhasePromptNode ||
        body.facePhasePrompt !== undefined ||
        body.garmentPhasePrompt !== undefined
      ) {
        const extracted = extractDefaultPrompts(json, newNegNode, newPosNode);
        defaultFacePhasePrompt = extracted.defaultFacePhasePrompt;
        defaultGarmentPhasePrompt = extracted.defaultGarmentPhasePrompt;
      }

      const updateValues: Record<string, unknown> = {
        updatedAt: new Date(),
        defaultFacePhasePrompt,
        defaultGarmentPhasePrompt,
      };
      if (
        body.garmentPhasePrompt !== undefined ||
        body.facePhasePrompt !== undefined ||
        body.ksamplerSteps !== undefined ||
        body.ksamplerCfg !== undefined ||
        body.ksamplerDenoise !== undefined
      ) {
        updateValues.jsonContent = json;
      }
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
      if ('thirdNodeId' in body) updateValues.thirdNodeId = body.thirdNodeId ?? null;
      if ('sizeNodeIds' in body) updateValues.sizeNodeIds = body.sizeNodeIds ?? [];
      if ('latentSizeNodeIds' in body)
        updateValues.latentSizeNodeIds = body.latentSizeNodeIds ?? [];
      if (body.latentMaxPx !== undefined) updateValues.latentMaxPx = body.latentMaxPx;
      if ('outputSizeNodeIds' in body)
        updateValues.outputSizeNodeIds = body.outputSizeNodeIds ?? [];
      if (body.outputMaxPx !== undefined) updateValues.outputMaxPx = body.outputMaxPx;
      if ('resultNodeId' in body) updateValues.resultNodeId = body.resultNodeId ?? null;
      if (body.facePhasePromptNode !== undefined)
        updateValues.facePhasePromptNode = body.facePhasePromptNode;
      if (body.garmentPhasePromptNode !== undefined)
        updateValues.garmentPhasePromptNode = body.garmentPhasePromptNode;
      if ('tryonPersonNodeId' in body)
        updateValues.tryonPersonNodeId = body.tryonPersonNodeId ?? null;
      if ('tryonGarmentNodeId' in body)
        updateValues.tryonGarmentNodeId = body.tryonGarmentNodeId ?? null;
      if ('tryonGarmentNodeId2' in body)
        updateValues.tryonGarmentNodeId2 = body.tryonGarmentNodeId2 ?? null;
      if ('tryonOutputNodeId' in body)
        updateValues.tryonOutputNodeId = body.tryonOutputNodeId ?? null;

      await app.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, id))
          .for('update');
        if (!locked) throw new AppError('NOT_FOUND', 404, 'workflow not found');

        await tx
          .update(schema.workflowTemplates)
          .set(updateValues)
          .where(eq(schema.workflowTemplates.id, id));

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.update',
          resourceType: 'workflow',
          resourceId: id,
          before: locked,
          after: { ...locked, ...updateValues },
          request: req,
        });
      });

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

      const result = await app.db.transaction(async (tx) => {
        const [source] = await tx
          .select({ id: schema.workflowTemplates.id })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, sourceId));
        if (!source) throw new AppError('NOT_FOUND', 404, 'source workflow not found');

        const [target] = await tx
          .select({
            id: schema.workflowTemplates.id,
            defaultGarmentPhasePrompt: schema.workflowTemplates.defaultGarmentPhasePrompt,
          })
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, targetWorkflowId));
        if (!target) throw new AppError('NOT_FOUND', 404, 'target workflow not found');

        const updatedRows = await tx
          .update(schema.modelPoseAssets)
          .set({
            workflowTemplateId: targetWorkflowId,
            promptGarmentPhase: target.defaultGarmentPhasePrompt ?? null,
          })
          .where(eq(schema.modelPoseAssets.workflowTemplateId, sourceId))
          .returning({ id: schema.modelPoseAssets.id });

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.reassign',
          resourceType: 'workflow',
          resourceId: sourceId,
          after: { targetWorkflowId, updatedPoses: updatedRows.length },
          request: req,
        });

        return updatedRows;
      });

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

      await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.workflowTemplates)
          .where(eq(schema.workflowTemplates.id, id))
          .for('update');
        if (!row) throw new AppError('NOT_FOUND', 404, 'workflow not found');

        const [poseCountRow] = await tx
          .select({ cnt: count() })
          .from(schema.modelPoseAssets)
          .where(eq(schema.modelPoseAssets.workflowTemplateId, id));
        const poseCount = Number(poseCountRow?.cnt ?? 0);
        if (poseCount > 0) {
          throw new AppError(
            'CONFLICT',
            409,
            `Cannot delete: ${poseCount} pose asset${poseCount === 1 ? '' : 's'} use this workflow. Reassign those poses first.`,
          );
        }

        const [funnelCountRow] = await tx
          .select({ cnt: count() })
          .from(schema.shopifyFunnelTemplates)
          .where(eq(schema.shopifyFunnelTemplates.workflowTemplateId, id));
        const funnelCount = Number(funnelCountRow?.cnt ?? 0);
        if (funnelCount > 0) {
          throw new AppError(
            'CONFLICT',
            409,
            `Cannot delete: ${funnelCount} Shopify funnel template${funnelCount === 1 ? '' : 's'} use this workflow. Reassign those funnel templates first.`,
          );
        }

        await tx.delete(schema.workflowTemplates).where(eq(schema.workflowTemplates.id, id));

        await recordAudit(tx, {
          actor: { userId: req.userId, role: req.adminRole! },
          action: 'workflow.delete',
          resourceType: 'workflow',
          resourceId: id,
          // Omit jsonContent — the full ComfyUI workflow blob doesn't belong in an
          // audit-log payload.
          before: { id: row.id, slug: row.slug, label: row.label, workflowType: row.workflowType },
          request: req,
        });
      });

      return { ok: true };
    },
  );
}
