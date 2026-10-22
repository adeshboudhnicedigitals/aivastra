import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import { handleTryon, type TryonDeps } from '../src/modules/messaging/engine/tryon-engine';
import type { TryonPose } from '../src/modules/messaging/engine/tryon-rules';
import type {
  EngineContext,
  EngineResult,
  Gender,
  InboundEvent,
  OutboundMessage,
  Session,
} from '../src/modules/messaging/engine/types';

const CTX: EngineContext = { userId: 'u1', accountId: 'a1', messageId: 'm1' };
const KEY = 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg';

const pose = (id: string, gender: Gender, shotType: TryonPose['shotType']): TryonPose => ({
  id,
  gender,
  shotType,
  r2Key: `${id}.jpg`,
  workflowTemplateId: 'wf',
  templateVersion: 1,
});
const POOL: TryonPose[] = [
  pose('mf1', 'men', 'full'),
  pose('mf2', 'men', 'full'),
  pose('mf3', 'men', 'full'),
  pose('mh1', 'men', 'half'),
  pose('mh2', 'men', 'half'),
  pose('wf1', 'women', 'full'),
];

function fakeDeps(over: Partial<TryonDeps> & { balance?: number } = {}) {
  const calls = {
    runs: [] as { garmentKey: string; poses: TryonPose[] }[],
    noPoses: [] as Gender[],
  };
  let n = 0;
  const { balance = 100, ...rest } = over;
  const deps: TryonDeps = {
    newNonce: () => `n${++n}`,
    getBalance: async () => balance,
    getTryonCost: async () => 5,
    shuffle: (ids) => ids,
    listPoolPoses: async (g) => POOL.filter((p) => p.gender === g),
    createTryonRun: async (_ctx, a) => {
      calls.runs.push(a);
      return { runId: 'run-1', requested: a.poses.length, created: a.poses.length };
    },
    reportNoPoses: (g) => calls.noPoses.push(g),
    links: { pricing: 'https://p', help: 'https://h', studio: 'https://s' },
    ...rest,
  };
  return { deps, calls };
}

const tapIn = (msgs: OutboundMessage[], action: string, value?: string): InboundEvent => {
  for (const m of msgs) {
    const ids =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((r) => r.id)
          : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d?.action === action && (value === undefined || d.value === value))
        return { type: 'reply', id };
    }
  }
  throw new Error(`${action} not offered: ${JSON.stringify(msgs)}`);
};
const photo: InboundEvent = { type: 'image', garmentKey: KEY };
const titles = (m: OutboundMessage | undefined) =>
  m?.kind === 'list'
    ? m.rows.map((r) => r.title)
    : m?.kind === 'buttons'
      ? m.buttons.map((b) => b.title)
      : [];
const texts = (msgs: OutboundMessage[]) => msgs.flatMap((m) => (m.kind === 'text' ? [m.text] : []));

async function step(r: EngineResult, e: InboundEvent, deps: TryonDeps) {
  return handleTryon(r.session, e, CTX, deps);
}
async function toGender(deps: TryonDeps) {
  return handleTryon(null, photo, CTX, deps);
}
async function toCount(deps: TryonDeps, g: Gender = 'men') {
  const asked = await toGender(deps);
  return step(asked, tapIn(asked.messages, 'gender', g), deps);
}

describe('try-on engine', () => {
  it('a first photo asks the gender: Men, Women, Boys, Girls', async () => {
    const { deps } = fakeDeps();
    const r = await toGender(deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', garmentKey: KEY });
    expect(titles(r.messages.at(-1))).toEqual(['Men', 'Women', 'Boys', 'Girls']);
  });

  it('a gender shows the count options with their credit cost', async () => {
    const { deps } = fakeDeps();
    const r = await toCount(deps);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      gender: 'men',
      perImage: 5,
      balance: 100,
    });
    expect(titles(r.messages.at(-1))).toEqual([
      '1 pose (5 credits)',
      '3 poses (15 credits)',
      '5 poses (25 credits)',
    ]);
  });

  it('offers only affordable counts', async () => {
    const { deps } = fakeDeps({ balance: 12 });
    const r = await toCount(deps);
    expect(titles(r.messages.at(-1))).toEqual(['1 pose (5 credits)']);
  });

  it('offers only counts the pool can fill', async () => {
    const { deps } = fakeDeps();
    const r = await toCount(deps, 'women');
    expect(titles(r.messages.at(-1))).toEqual(['1 pose (5 credits)']);
  });

  it('nothing affordable goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({ balance: 3 });
    const r = await toCount(deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(texts(r.messages).join(' ') + JSON.stringify(r.messages)).toContain('https://p');
  });

  it('a gender with no poses reports it and asks the gender again', async () => {
    const { deps, calls } = fakeDeps();
    const r = await toCount(deps, 'boys');
    expect(calls.noPoses).toEqual(['boys']);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(texts(r.messages)[0]).toContain("don't have poses ready");
  });

  it('a count draws the split for that gender and starts the run', async () => {
    const { deps, calls } = fakeDeps();
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    expect(calls.runs).toHaveLength(1);
    expect(calls.runs[0].garmentKey).toBe(KEY);
    expect(calls.runs[0].poses.map((p) => p.id)).toEqual(['mf1', 'mf2', 'mh1']);
    expect(r.session).toMatchObject({ state: 'GENERATING', count: 3 });
    expect(r.session.runs).toEqual([{ runId: 'run-1', images: 3 }]);
    expect(texts(r.messages).join('\n')).toContain('Generating your 3 poses');
  });

  it('re-checks the balance at the tap', async () => {
    const { deps, calls } = fakeDeps();
    const counts = await toCount(deps);
    const poor = fakeDeps({ balance: 4 }).deps;
    const r = await step(counts, tapIn(counts.messages, 'count', '1'), poor);
    expect(calls.runs).toHaveLength(0);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('INSUFFICIENT_CREDITS from job creation goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({
      createTryonRun: async () => {
        throw new AppError('INSUFFICIENT_CREDITS', 402, 'no');
      },
    });
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('reports a partly started run', async () => {
    const { deps } = fakeDeps({
      createTryonRun: async (_c, a) => ({
        runId: 'run-2',
        requested: a.poses.length,
        created: 1,
        reason: 'not enough credits',
      }),
    });
    const counts = await toCount(deps);
    const r = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    expect(texts(r.messages)[0]).toBe(
      "Started 1 of 3 images. The rest couldn't start: not enough credits",
    );
    expect(r.session.runs).toEqual([{ runId: 'run-2', images: 1 }]);
  });

  it('a stale tap re-sends the current step', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const stale = tapIn(counts.messages, 'count', '1');
    const moved = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const r = await handleTryon(moved.session, stale, CTX, deps);
    expect(texts(r.messages)[0]).toBe('That option is from an earlier step.');
  });

  it('the run finishing summarises, then offers Make more / New garment / Menu', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '3'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 3, failedPoseIds: [], failed: 1 },
      deps,
    );
    const t = texts(done.messages);
    expect(t[0]).toBe(
      'Here are your 2 generated poses!\nCategory: Men\nCredits used: 10 credits\nRemaining balance: 100 credits',
    );
    expect(t[1]).toBe('1 of 3 images failed. The credits for it were refunded.');
    expect(done.session.state).toBe('DELIVERED');
    expect(titles(done.messages.at(-1))).toEqual(['Make more', 'New garment', 'Menu']);
  });

  it('Make more returns to the count list with the same photo and gender', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      deps,
    );
    const again = await step(done, tapIn(done.messages, 'next', 'more'), deps);
    expect(again.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      garmentKey: KEY,
      gender: 'men',
    });
    expect(again.messages.at(-1)?.kind).toBe('list');
  });

  it('New garment asks for a photo and clears the old one', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const gen = await step(counts, tapIn(counts.messages, 'count', '1'), deps);
    const done = await step(
      gen,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      deps,
    );
    const r = await step(done, tapIn(done.messages, 'next', 'new'), deps);
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
    expect(r.session.garmentKey).toBeUndefined();
  });

  it('credits added resumes a NO_CREDITS session at the count list', async () => {
    const poor = fakeDeps({ balance: 3 }).deps;
    const stuck = await toCount(poor);
    expect(stuck.session.state).toBe('NO_CREDITS');
    const rich = fakeDeps().deps;
    const r = await handleTryon(stuck.session, { type: 'creditsAdded', credits: 50 }, CTX, rich);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(texts(r.messages)[0]).toBe('50 credits added.');
  });

  it('a session left by the other flow starts at the menu', async () => {
    const { deps } = fakeDeps();
    const legacy = {
      v: 1,
      state: 'PICK_LOOKS',
      nonce: 'x',
      page: 0,
      photos: {},
      picked: [],
    } as unknown as Session;
    const r = await handleTryon(legacy, { type: 'text', text: 'hi' }, CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('MENU resets to the menu from anywhere', async () => {
    const { deps } = fakeDeps();
    const counts = await toCount(deps);
    const r = await step(counts, { type: 'text', text: 'menu' }, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.session.garmentKey).toBeUndefined();
  });
});
