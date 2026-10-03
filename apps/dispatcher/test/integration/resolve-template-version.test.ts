import { randomUUID } from 'node:crypto';
import { schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { performanceKey } from '../../src/perf/performance-key.js';
import { selectWorker } from '../../src/worker/selector.js';
import { patchWorkflow } from '../../src/workflow/patcher.js';
import { resolveWorkflowTemplateVersion } from '../../src/workflow/resolve-template-version.js';
import { setupTestEnv, type TestEnv } from '../helpers/containers.js';

describe('resolveWorkflowTemplateVersion', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupTestEnv();
  }, 60_000);

  afterAll(async () => {
    await env.cleanup();
  });

  async function seedTemplate(
    overrides: Partial<typeof schema.workflowTemplates.$inferInsert> = {},
  ) {
    const [row] = await env.db
      .insert(schema.workflowTemplates)
      .values({
        slug: `resolver-test-${randomUUID()}`,
        label: 'Resolver test template',
        jsonContent: { live: true },
        poseNodeId: 'live-pose',
        upperNodeIds: ['live-upper'],
        garmentPhasePromptNode: 'live-prompt',
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('failed to seed template');
    return row;
  }

  it('returns the live row when snapshotVersion is null', async () => {
    const template = await seedTemplate();
    const resolved = await resolveWorkflowTemplateVersion(env.db, template.id, null);
    expect(resolved?.jsonContent).toEqual({ live: true });
    expect(resolved?.version).toBe(1);
  });

  it('returns the live row when snapshotVersion matches the current version', async () => {
    const template = await seedTemplate();
    const resolved = await resolveWorkflowTemplateVersion(env.db, template.id, 1);
    expect(resolved?.jsonContent).toEqual({ live: true });
  });

  it('returns the archived row when snapshotVersion is older than the live version', async () => {
    const template = await seedTemplate();
    await env.db.insert(schema.workflowTemplateArchives).values({
      workflowTemplateId: template.id,
      version: 1,
      jsonContent: { archived: true },
      poseNodeId: 'archived-pose',
      upperNodeIds: ['archived-upper'],
      garmentPhasePromptNode: 'archived-prompt',
    });
    await env.db
      .update(schema.workflowTemplates)
      .set({ jsonContent: { live: 'new' }, version: 2, poseNodeId: 'new-pose' })
      .where(eq(schema.workflowTemplates.id, template.id));

    const resolved = await resolveWorkflowTemplateVersion(env.db, template.id, 1);
    expect(resolved?.jsonContent).toEqual({ archived: true });
    expect(resolved?.poseNodeId).toBe('archived-pose');
    // Fields the archive doesn't own (id, isActive, slug) still come from the live row.
    expect(resolved?.id).toBe(template.id);
    if (!resolved) throw new Error('missing archive');
    expect(performanceKey(resolved)).toBe(`${template.id}:v1:archived`);
  });

  it('throws a clear error when the referenced archive no longer exists', async () => {
    const template = await seedTemplate();
    await env.db
      .update(schema.workflowTemplates)
      .set({ version: 2 })
      .where(eq(schema.workflowTemplates.id, template.id));

    await expect(resolveWorkflowTemplateVersion(env.db, template.id, 1)).rejects.toThrow(
      /version 1 was archived but no longer exists/,
    );
  });

  it('returns undefined when the template does not exist at all', async () => {
    const resolved = await resolveWorkflowTemplateVersion(env.db, randomUUID(), null);
    expect(resolved).toBeUndefined();
  });
  it('catalogue key and dispatched graph share the row resolved before a template edit', async () => {
    const template = await seedTemplate({
      jsonContent: {
        pose: { class_type: 'LoadImage', inputs: { image: 'old' } },
        output: { class_type: 'SaveImage', inputs: { images: ['pose', 0] } },
      },
      poseNodeId: 'pose',
      upperNodeIds: [],
      garmentPhasePromptNode: 'pose',
      resultNodeId: 'output',
    });
    const selected = await resolveWorkflowTemplateVersion(env.db, template.id, null);
    if (!selected) throw new Error('missing template');
    const key = performanceKey(selected);
    const namespace = `snapshot-key-${randomUUID()}:`;
    const routingRedis = new Redis(env.redisUrl, { keyPrefix: namespace });
    await routingRedis.hset(
      'worker:registry',
      'snapshot-worker',
      JSON.stringify({
        status: 'IDLE',
        url: 'http://127.0.0.1:1',
        apiKey: 'test',
        allowedJobTypes: ['catalogue'],
      }),
    );
    await routingRedis.set('worker:health:snapshot-worker', '1');
    try {
      expect((await selectWorker(routingRedis, 'catalogue', key))?.id).toBe('snapshot-worker');
      await env.db
        .update(schema.workflowTemplates)
        .set({
          updatedAt: new Date(selected.updatedAt.getTime() + 1000),
          jsonContent: {
            pose: { class_type: 'LoadImage', inputs: { image: 'edited' } },
            newNode: { class_type: 'CustomNode', inputs: {} },
          },
        })
        .where(eq(schema.workflowTemplates.id, template.id));
      const patched = await patchWorkflow(
        { workflowTemplateId: template.id, poseFile: 'uploaded.png' },
        env.db,
        undefined,
        null,
        selected,
      );
      expect(key).toBe(`${template.id}:${selected.updatedAt.getTime()}`);
      expect(patched.prompt).toHaveProperty('output');
      expect(patched.prompt).not.toHaveProperty('newNode');
      expect(selected.jsonContent).toEqual(template.jsonContent);
      const next = await resolveWorkflowTemplateVersion(env.db, template.id, null);
      if (!next) throw new Error('missing edited template');
      expect(performanceKey(next)).not.toBe(key);
      const reloaded = await patchWorkflow(
        { workflowTemplateId: template.id, poseFile: 'uploaded.png' },
        env.db,
      );
      expect(reloaded.prompt).toHaveProperty('newNode');
    } finally {
      await routingRedis.del(
        'worker:registry',
        'worker:health:snapshot-worker',
        'worker:rr_cursor',
      );
      routingRedis.disconnect();
    }
  });
});
