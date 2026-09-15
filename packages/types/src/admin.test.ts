// packages/types/src/admin.test.ts
import { describe, expect, it } from 'vitest';
import { CreateWorkflowBody, ReplaceWorkflowBody, UpdateWorkflowBody } from './admin.js';

describe('ReplaceWorkflowBody', () => {
  const base = {
    slug: 'my_workflow',
    label: 'My Workflow',
    jsonContent: {},
    workflowType: 'regular' as const,
    poseNodeId: 'p1',
    garmentPhasePromptNode: 'g1',
    upperNodeIds: ['u1'],
  };

  it('rejects a missing password', () => {
    const result = ReplaceWorkflowBody.safeParse(base);
    expect(result.success).toBe(false);
  });

  it('accepts a valid body with a password', () => {
    const result = ReplaceWorkflowBody.safeParse({
      ...base,
      password: 'correct horse battery staple',
    });
    expect(result.success).toBe(true);
  });

  it('still enforces the underlying workflowType-specific requirements', () => {
    const result = ReplaceWorkflowBody.safeParse({
      slug: 'ts',
      label: 'Two stage',
      jsonContent: {},
      workflowType: 'two_stage',
      poseNodeId: 'p1',
      password: 'x',
      // missing stage1PositivePromptNode/stage1NegativePromptNode/etc.
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateWorkflowBody — samSegmentationPromptNode', () => {
  const base = {
    slug: 'test_workflow',
    label: 'Test workflow',
    jsonContent: {},
    workflowType: 'regular' as const,
    poseNodeId: 'pose_node',
    upperNodeIds: ['upper_node'],
    garmentPhasePromptNode: 'positive_node',
  };

  it('accepts an optional samSegmentationPromptNode', () => {
    const result = CreateWorkflowBody.safeParse({
      ...base,
      samSegmentationPromptNode: 'sam_node',
    });
    expect(result.success).toBe(true);
  });

  it('parses fine when samSegmentationPromptNode is omitted', () => {
    const result = CreateWorkflowBody.safeParse(base);
    expect(result.success).toBe(true);
  });
});

describe('UpdateWorkflowBody — samSegmentationPromptNode / samSegmentationPrompt', () => {
  it('accepts both fields together', () => {
    const result = UpdateWorkflowBody.safeParse({
      samSegmentationPromptNode: 'sam_node',
      samSegmentationPrompt: 'person',
    });
    expect(result.success).toBe(true);
  });

  it('accepts samSegmentationPrompt alone (route handler enforces the node-id-exists rule, not Zod)', () => {
    const result = UpdateWorkflowBody.safeParse({ samSegmentationPrompt: 'person' });
    expect(result.success).toBe(true);
  });
});
