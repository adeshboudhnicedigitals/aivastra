import { createDb, schema } from '@aivastra/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startContainers } from '../helpers/containers.js';

describe('workflow comparison schema', () => {
  let ctx: Awaited<ReturnType<typeof startContainers>>;
  let dbHandle: ReturnType<typeof createDb>;
  let sourceJobId: string;
  let templateId: string;

  beforeAll(async () => {
    ctx = await startContainers();
    dbHandle = createDb(ctx.pgUrl);
    const [job] = await dbHandle.db
      .insert(schema.jobs)
      .values({ status: 'COMPLETED', source: 'tryon' })
      .returning();
    sourceJobId = job.id;
    const [template] = await dbHandle.db
      .insert(schema.workflowTemplates)
      .values({
        slug: 'comparison-schema-general',
        label: 'General',
        jsonContent: {},
        poseNodeId: '2',
        upperNodeIds: ['4'],
        garmentPhasePromptNode: '6',
        workflowType: 'tryon',
      })
      .returning();
    templateId = template.id;
  });

  afterAll(async () => {
    await dbHandle?.close();
    await ctx?.stop();
  });

  // Removing the tuple's unique index would allow duplicate collection/replay.
  it('rejects the same source/template/version twice but accepts a different version', async () => {
    const comparison = { sourceJobId, templateId, templateVersion: 1, status: 'COLLECTED' };
    const [first] = await dbHandle.db
      .insert(schema.workflowComparisons)
      .values(comparison)
      .returning();
    expect(first.sourceJobId).toBe(sourceJobId);

    await expect(dbHandle.db.insert(schema.workflowComparisons).values(comparison)).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    );

    const [nextVersion] = await dbHandle.db
      .insert(schema.workflowComparisons)
      .values({ ...comparison, templateVersion: 2 })
      .returning();
    expect(nextVersion.id).not.toBe(first.id);
    expect(nextVersion.templateVersion).toBe(2);
  });

  it.each([
    {
      templateVersion: 0,
      status: 'COLLECTED',
      constraint: 'workflow_comparisons_version_positive',
    },
    { templateVersion: 3, status: 'UNKNOWN', constraint: 'workflow_comparisons_status_valid' },
  ])('rejects invalid comparison state: $constraint', async ({ constraint, ...values }) => {
    await expect(
      dbHandle.db.insert(schema.workflowComparisons).values({ sourceJobId, templateId, ...values }),
    ).rejects.toMatchObject({ code: '23514', constraint_name: constraint });
  });

  it('keeps the collected input mapping and permits unsupported rows without one', async () => {
    const [supported] = await dbHandle.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId,
        templateId,
        templateVersion: 3,
        status: 'COLLECTED',
        personKey: 'inputs/person.jpg',
        garmentKey: 'inputs/garment.jpg',
      })
      .returning();
    expect(supported.personKey).toBe('inputs/person.jpg');
    expect(supported.garmentKey).toBe('inputs/garment.jpg');

    const [unsupported] = await dbHandle.db
      .insert(schema.workflowComparisons)
      .values({ sourceJobId, templateId, templateVersion: 4, status: 'UNSUPPORTED' })
      .returning();
    expect(unsupported.personKey).toBeNull();
    expect(unsupported.garmentKey).toBeNull();
  });

  it('retains comparison history after replay deletion and erases it with its source', async () => {
    const [source] = await dbHandle.db.insert(schema.jobs).values({}).returning();
    const [replay] = await dbHandle.db
      .insert(schema.jobs)
      .values({ source: 'comparison' })
      .returning();
    const [comparison] = await dbHandle.db
      .insert(schema.workflowComparisons)
      .values({
        sourceJobId: source.id,
        generalJobId: replay.id,
        templateId,
        templateVersion: 1,
        status: 'QUEUED',
      })
      .returning();

    await dbHandle.db.delete(schema.jobs).where(eq(schema.jobs.id, replay.id));
    const [retained] = await dbHandle.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, comparison.id));
    expect(retained.generalJobId).toBeNull();

    await dbHandle.db.delete(schema.jobs).where(eq(schema.jobs.id, source.id));
    const erased = await dbHandle.db
      .select()
      .from(schema.workflowComparisons)
      .where(eq(schema.workflowComparisons.id, comparison.id));
    expect(erased).toEqual([]);
  });
});
