import { schema } from '@aivastra/db';
import { AIMessage } from '@langchain/core/messages';
import { FakeStreamingChatModel } from '@langchain/core/utils/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBotTurn } from '../src/agent/bot.js';
import { makeAccountTools } from '../src/agent/tools.js';
import { buildTestApp } from './helpers/app.js';
import { type Containers, startContainers } from './helpers/containers.js';

describe('bot agent', () => {
  let c: Containers;
  let t: Awaited<ReturnType<typeof buildTestApp>>;
  let userId: string;

  beforeAll(async () => {
    c = await startContainers();
    t = await buildTestApp(c);
    const [u] = await t.deps.db
      .insert(schema.users)
      .values({ email: 'bot@test.dev', passwordHash: 'x', emailVerified: true })
      .returning();
    userId = u.id;
    await t.deps.db.insert(schema.userCredits).values({ userId, balance: 42 });
  }, 60_000);

  afterAll(async () => {
    await t.stop();
    await c.stop();
  });

  it('getCredits is bound to the session user — no identity params', async () => {
    const tools = makeAccountTools(t.deps.db, userId);
    const credits = tools.find((x) => x.name === 'getCredits');
    if (!credits) throw new Error('getCredits tool not found');
    expect(JSON.stringify(credits.schema)).not.toContain('userId');
    const out = await credits.invoke({});
    expect(String(out)).toContain('42');
  });

  it('plain answer path', async () => {
    const model = new FakeStreamingChatModel({
      responses: [new AIMessage('You get 1 credit per try-on.')],
    });
    const r = await runBotTurn({
      deps: t.deps,
      model,
      userId,
      convId: crypto.randomUUID(),
      history: [],
      userMessage: 'how many credits per job?',
      signal: new AbortController().signal,
    });
    expect(r.kind).toBe('answer');
    expect(r.content).toContain('1 credit');
  });

  it('escalate sentinel routes to escalate', async () => {
    const model = new FakeStreamingChatModel({ responses: [new AIMessage('<escalate/>')] });
    const r = await runBotTurn({
      deps: t.deps,
      model,
      userId,
      convId: crypto.randomUUID(),
      history: [],
      userMessage: 'I demand a refund now',
      signal: new AbortController().signal,
    });
    expect(r.kind).toBe('escalate');
  });
});
