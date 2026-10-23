import { describe, expect, it } from 'vitest';
import { handle } from '../src/modules/messaging/engine/engine';
import { decodeReplyId, encodeReplyId } from '../src/modules/messaging/engine/reply-id';
import type {
  EngineDeps,
  EngineResult,
  InboundEvent,
  OutboundMessage,
  Session,
} from '../src/modules/messaging/engine/types';
import {
  CTX,
  fakeDeps,
  GT_SHIRT,
  insufficient,
  look,
  TEMPLATE,
  TEMPLATE_2,
} from './helpers/engine-fakes';

// Finds the reply id the engine offered for `action` (and `value`, if given) in
// the last messages — what a seller's tap would send back.
function tap(r: EngineResult, action: string, value?: string): InboundEvent {
  for (const m of r.messages) {
    const ids: string[] =
      m.kind === 'buttons'
        ? m.buttons.map((b) => b.id)
        : m.kind === 'list'
          ? m.rows.map((x) => x.id)
          : m.kind === 'cards'
            ? m.cards.map((c) => c.id)
            : [];
    for (const id of ids) {
      const d = decodeReplyId(id);
      if (d && d.action === action && (value === undefined || d.value === value)) {
        return { type: 'reply', id };
      }
    }
  }
  throw new Error(
    `no ${action}${value ? `:${value}` : ''} offered in ${JSON.stringify(r.messages)}`,
  );
}

const texts = (msgs: OutboundMessage[]) => msgs.map((m) => ('text' in m ? m.text : ''));
const listOf = (r: EngineResult) => {
  const m = r.messages.find((x) => x.kind === 'list');
  return m && m.kind === 'list' ? m : null;
};
const photo = (n: number): InboundEvent => ({
  type: 'image',
  garmentKey: `inputs/00000000-0000-4000-8000-00000000000${n}/garment.jpg`,
});

// Starts a fresh chat ('hi'), or continues from an earlier result so the next
// tap can find the ids that result offered.
async function run(
  deps: EngineDeps,
  steps: ((r: EngineResult) => InboundEvent)[],
  from?: EngineResult,
) {
  let r = from ?? (await handle(null, { type: 'text', text: 'hi' }, CTX, deps));
  for (const step of steps) r = await handle(r.session, step(r), CTX, deps);
  return r;
}

describe('engine: menu and global commands', () => {
  it('a first message gets the main menu', async () => {
    const { deps } = fakeDeps();
    const r = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.messages.at(-1)).toMatchObject({ kind: 'buttons' });
  });

  it('a tap with no session says the session expired, then shows the menu', async () => {
    const { deps } = fakeDeps();
    const r = await handle(null, { type: 'reply', id: 'old|look|x' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/session expired/);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('menu and restart always return to the main menu', async () => {
    const { deps } = fakeDeps();
    const deep = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    expect(deep.session.state).toBe('ASK_GARMENT_PHOTO');
    for (const word of ['menu', ' Restart ']) {
      const r = await handle(deep.session, { type: 'text', text: word }, CTX, deps);
      expect(r.session.state).toBe('MAIN_MENU');
    }
  });

  it('help answers with the contact link and keeps the current step', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    const r = await handle(at.session, { type: 'text', text: 'help' }, CTX, deps);
    expect(texts(r.messages)[0]).toContain('https://app.test/contact-us');
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
  });

  it('credits shows the balance and the pricing link', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [(x) => tap(x, 'menu', 'credits')]);
    expect(texts(r.messages)[0]).toBe(
      'You have 50 credits. Buy more on the website: https://app.test/pricing',
    );
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('a tap from an earlier step is ignored', async () => {
    const { deps } = fakeDeps();
    const menu = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    const staleTap = tap(menu, 'menu', 'new');
    const next = await handle(menu.session, staleTap, CTX, deps);
    const again = await handle(next.session, staleTap, CTX, deps);
    // The step is shown again with live buttons, so the seller is never left at a dead end.
    expect(texts(again.messages)[0]).toBe('That option is from an earlier step.');
    expect(texts(again.messages)[1]).toMatch(/Send a photo of your garment/);
    expect(again.session).toEqual(next.session);
    expect(buttonTitles(again.messages[1])).toEqual(['Menu']);
  });

  it.each([
    'cancel',
    'exit',
    'QUIT',
    'back',
    'hi',
    'Hello',
  ])('the exit word %s returns to the main menu from mid-flow', async (word) => {
    const { deps } = fakeDeps();
    const deep = await run(deps, [(r) => tap(r, 'menu', 'new'), () => photo(1)]);
    expect(deep.session.state).toBe('ASK_GENDER');
    const r = await handle(deep.session, { type: 'text', text: word }, CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.session.garmentKey).toBeUndefined();
  });

  it('stop is not an exit word: the engine treats it as stray text', async () => {
    const { deps } = fakeDeps();
    const deep = await run(deps, [(r) => tap(r, 'menu', 'new'), () => photo(1)]);
    const r = await handle(deep.session, { type: 'text', text: 'stop' }, CTX, deps);
    expect(r.session.state).toBe('ASK_GENDER');
  });

  it('a Menu button on each photo request and on the confirm step leaves the flow', async () => {
    const { deps } = fakeDeps();
    const ask = await run(deps, [(r) => tap(r, 'menu', 'new')]);
    expect(buttonTitles(ask.messages.at(-1))).toEqual(['Menu']);
    const out = await handle(ask.session, tap(ask, 'menu', 'menu'), CTX, deps);
    expect(out.session.state).toBe('MAIN_MENU');
  });

  it('stray text on an idle step shows that step again instead of a reprompt', async () => {
    const { deps } = fakeDeps({ getBalance: async () => 8 });
    // Eight credits cannot cover two poses.
    const at = await atCount(deps);
    const no = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(no.session.state).toBe('NO_CREDITS');
    const again = await handle(no.session, { type: 'text', text: 'ok' }, CTX, deps);
    expect(again.session.state).toBe('NO_CREDITS');
    expect(buttonTitles(again.messages.at(-1))).toEqual(['Menu']);
    expect(texts(again.messages)).not.toContain('Please use the options above, or type MENU.');
  });
});

// A recognised Shirt, and the gender's own row for it.
const KIND = {
  recognizeKind: async () => ({ label: 'Shirt' }),
  typeForKind: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
};

describe('engine: photo, gender and garment type', () => {
  it('New catalog asks for the photo; the photo leads to the four-gender list', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [(x) => tap(x, 'menu', 'new'), () => photo(1)]);
    expect(r.session).toMatchObject({
      state: 'ASK_GENDER',
      garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    });
    const list = listOf(r);
    expect(list?.text).toBe('Create this catalogue for:');
    expect(list?.rows.map((x) => x.title)).toEqual(['Women', 'Men', 'Boys', 'Girls']);
  });

  it('a photo sent from the main menu starts at the gender step', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [() => photo(2)]);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.garmentKey).toContain('000000000002');
  });

  it('recognition runs right after the upload and asks the seller to confirm the kind', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const r = await run(deps, [() => photo(1)]);
    expect(calls.recognize).toEqual([
      { garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg' },
    ]);
    expect(r.session).toMatchObject({ state: 'CONFIRM_KIND', kind: 'Shirt' });
    expect(r.messages[0]).toMatchObject({
      kind: 'buttons',
      text: "I've analysed the image and it looks like a shirt.\nIs this correct?",
    });
    expect(buttonTitles(r.messages[0])).toEqual(['Yes, continue', 'No, different item']);
  });

  it('Yes asks the gender, then goes on with that gender’s own type', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const ask = await run(deps, [() => photo(1), (x) => tap(x, 'confirm')]);
    expect(ask.session.state).toBe('ASK_GENDER');
    expect(listOf(ask)?.text).toBe('Great! 👍\nCreate this catalogue for:');
    const r = await handle(ask.session, tap(ask, 'gender', 'women'), CTX, deps);
    expect(calls.mapped).toEqual([{ label: 'Shirt', gender: 'women' }]);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
      faceId: 'face-1',
    });
    expect(r.session.kind).toBeUndefined();
  });

  it('No asks the gender, then shows that gender’s list and counts a correction', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const ask = await run(deps, [() => photo(1), (x) => tap(x, 'change')]);
    expect(ask.session.state).toBe('ASK_GENDER');
    expect(ask.session.kind).toBeUndefined();
    expect(listOf(ask)?.text).toBe('Create this catalogue for:');
    expect(calls.corrected).toBe(1);
    const r = await handle(ask.session, tap(ask, 'gender', 'women'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(calls.mapped).toEqual([]);
  });

  it('a kind the tapped gender does not have goes to that gender’s list', async () => {
    const { deps } = fakeDeps({ ...KIND, typeForKind: async () => null });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'boys'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'boys' });
    expect(r.session.kind).toBeUndefined();
  });

  it('a recognised type the bot cannot offer hands off to the studio, keeps the session and reports why', async () => {
    const { deps, calls } = fakeDeps({
      ...KIND,
      typeForKind: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'women'),
    ]);
    expect(texts(r.messages)[0]).toMatch(
      /^Saree catalogs can't be made on WhatsApp yet\. You can create one in the web studio: https:\/\/app\.test\/studio\?draft=/,
    );
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(r.session.garmentKey).toBeDefined();
    expect(calls.unavailable).toEqual([
      expect.objectContaining({
        gender: 'women',
        garmentTypeId: 'gt-saree',
        reason: 'mannequin_flow',
      }),
    ]);
  });

  it('a hand-off with no type list to offer ends at the menu without "choose another type"', async () => {
    const { deps } = fakeDeps({
      ...KIND,
      typeForKind: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
      listGarmentTypes: async () => [],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'confirm'),
      (x) => tap(x, 'gender', 'women'),
    ]);
    const sent = texts(r.messages);
    expect(sent[0]).toMatch(/^Saree catalogs can't be made .*https:\/\/app\.test\/studio\?draft=/);
    expect(sent.join('\n')).not.toContain('Or choose another type.');
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('not recognised: the garment-type list, then a pick goes to the pose count question', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.text).toBe('Which garment is it?');
    const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });

  it('no template, no face, or no eligible look hands off and the reason is reported', async () => {
    // The seller only sees the hand-off; the reason goes to the log and counter,
    // so an admin-data gap (no face, no template, every look needing a missing
    // default lower/shoe under D49) is found without stepping through the engine.
    const shoeOnly = { ...TEMPLATE, looks: [look('s', { hasShoes: true })] };
    for (const [over, reason] of [
      [{ getTemplates: async () => [] }, 'no_template'],
      [{ getDefaultFaceId: async () => null }, 'no_face'],
      [{ getTemplates: async () => [shoeOnly] }, 'no_eligible_looks'],
    ] as const) {
      const { deps, calls } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/^Shirt catalogs can't be made on WhatsApp yet/);
      expect(r.session.state).toBe('ASK_GARMENT_TYPE');
      expect(r.session.gender).toBe('women');
      expect(calls.unavailable).toEqual([
        expect.objectContaining({ gender: 'women', garmentTypeId: 'gt-shirt', reason }),
      ]);
    }
  });

  it('text where a tap is expected gets a re-prompt and keeps the step', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [() => photo(1)]);
    const r = await handle(at.session, { type: 'text', text: 'its a shirt' }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('ASK_GENDER');
  });

  it('a video at the photo step explains what is accepted', async () => {
    const { deps } = fakeDeps();
    const at = await run(deps, [(x) => tap(x, 'menu', 'new')]);
    const r = await handle(at.session, { type: 'unsupportedMedia' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/JPG or PNG/);
    expect(r.session.state).toBe('ASK_GARMENT_PHOTO');
  });

  it('garment types are paged at 9 rows plus More', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...GT_SHIRT,
      id: `gt-${i}`,
      label: `Type ${i}`,
    }));
    const { deps } = fakeDeps({ listGarmentTypes: async () => many });
    const first = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(listOf(first)?.rows).toHaveLength(10);
    const second = await handle(first.session, tap(first, 'more'), CTX, deps);
    expect(listOf(second)?.rows.map((r) => r.title)).toEqual(['Type 9', 'Type 10', 'Type 11']);
  });
});

// A seller at the pose-count question for GT_SHIRT, through the garment-type list.
async function atCount(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

// ...and after tapping a count: the summary with Generate / Different number.
// A shuffle that puts `want` first, in that order: the draw is random in
// production, so tests choose which looks it returns.
const prefer = (want: string[]) => (ids: string[]) => [
  ...want.filter((w) => ids.includes(w)),
  ...ids.filter((i) => !want.includes(i)),
];

// Count = lookIds.length, drawn as exactly lookIds; the count tap generates.
async function generated(deps: EngineDeps, lookIds: string[]) {
  deps.shuffle = prefer(lookIds);
  const at = await atCount(deps);
  return handle(at.session, tap(at, 'count', String(lookIds.length)), CTX, deps);
}

const buttonTitles = (m: OutboundMessage | undefined) =>
  m && m.kind === 'buttons' ? m.buttons.map((b) => b.title) : [];

describe('engine: pose count', () => {
  it('summarises the choice and offers 1, 2 and 3 poses with their credit cost', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atCount(deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', perImage: 5, balance: 50 });
    const list = listOf(r);
    expect(list?.text).toBe(
      "Great! Let's create your catalogue. ✨\nCategory: Women\nGarment: Shirt\n\nCredits per pose: 5 credits\nAvailable balance: 50 credits\n\nHow many poses would you like to generate for your catalogue?\nYou can choose one option below. Each pose will use 5 credits.",
    );
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): a pool of 3, so no "5 poses".
    expect(list?.rows.map((x) => x.title)).toEqual([
      '1 pose (5 credits)',
      '2 poses (10 credits)',
      '3 poses (15 credits)',
    ]);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('offers only counts the balance can pay for', async () => {
    const { deps } = fakeDeps({
      getBalance: async () => 10,
      quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 10 }),
    });
    const r = await atCount(deps);
    expect(listOf(r)?.rows.map((x) => x.title)).toEqual([
      '1 pose (5 credits)',
      '2 poses (10 credits)',
    ]);
  });

  it('goes to NO_CREDITS when not even one pose is affordable', async () => {
    const { deps } = fakeDeps({
      quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 3 }),
    });
    const r = await atCount(deps);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('pools the looks of every template for the pool size', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await atCount(deps);
    // 5 distinct looks (a, b, c, e, f): the 5-pose option appears.
    expect(listOf(r)?.rows.map((x) => x.title)).toContain('5 poses (25 credits)');
  });

  it('a quote error is shown before any credits are taken', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      quote: async () => {
        throw new AppError('VALIDATION', 400, 'face not found or inactive');
      },
    });
    const r = await atCount(deps);
    expect(texts(r.messages)).toContain('face not found or inactive');
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('a count that was not offered is re-prompted', async () => {
    const { deps } = fakeDeps();
    const at = await atCount(deps);
    const r = await handle(
      at.session,
      { type: 'reply', id: encodeReplyId(at.session.nonce, 'count', '4') },
      CTX,
      deps,
    );
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });
});

describe('engine: tapping the count', () => {
  it('the tap is the agreement to spend: it starts the run with no confirm step', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atCount(deps);
    const r = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'GENERATING', count: 2 });
    expect(calls.createRun).toHaveLength(1);
  });

  it('re-checks the balance: a balance that dropped goes to NO_CREDITS before any run', async () => {
    let balance = 50;
    const { deps, calls } = fakeDeps({ getBalance: async () => balance });
    const at = await atCount(deps);
    balance = 10;
    const r = await handle(at.session, tap(at, 'count', '3'), CTX, deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(calls.createRun).toHaveLength(0);
  });

  it('credits added after NO_CREDITS return to the count question', async () => {
    const { deps } = fakeDeps();
    const at = await atCount(deps);
    const broke = { ...at.session, state: 'NO_CREDITS' as const };
    const r = await handle(broke, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });
});

describe('engine: random draw', () => {
  it('draws N distinct looks from the pool at Generate', async () => {
    const { deps, calls } = fakeDeps();
    const r = await generated(deps, ['b', 'c']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      picked: ['b', 'c'],
      seenLooks: ['b', 'c'],
    });
    expect(calls.createRun[0].inputs).toMatchObject({
      looks: [
        { poseId: 'pose-b', backgroundId: 'bg-b' },
        { poseId: 'pose-c', backgroundId: 'bg-c' },
      ],
    });
  });

  it('a look removed between the count and Generate is simply not drawn', async () => {
    let current = TEMPLATE;
    const { deps, calls } = fakeDeps({ getTemplates: async () => [current] });
    const at = await atCount(deps);
    current = { ...TEMPLATE, looks: TEMPLATE.looks.filter((l) => l.id !== 'a') };
    const r = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(r.session.picked).toEqual(['b', 'c']);
    expect(calls.createRun).toHaveLength(1);
  });

  it('More poses draws looks the seller has not had, then starts over when the pool runs out', async () => {
    const { deps } = fakeDeps();
    const first = await generated(deps, ['a', 'b']);
    const done = await handle(
      first.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    deps.shuffle = (ids) => ids;
    const again = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    const second = await handle(again.session, tap(again, 'count', '2'), CTX, deps);
    // 'a' and 'b' were had: only 'c' is new, so one reused look tops it up.
    expect(second.session.picked).toEqual(['c', 'a']);
    expect(second.session.seenLooks).toEqual(['c', 'a']);
  });
});

describe('engine: generating', () => {
  it('one template: one run with exactly the drawn looks', async () => {
    const { deps, calls } = fakeDeps();
    const r = await generated(deps, ['c', 'a']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      runs: [{ runId: 'run-1', images: 2 }],
    });
    expect(calls.createRun).toHaveLength(1);
    expect(calls.createRun[0].inputs).toMatchObject({
      looks: [
        { poseId: 'pose-c', backgroundId: 'bg-c' },
        { poseId: 'pose-a', backgroundId: 'bg-a' },
      ],
      catalogueTemplateMappingId: 'map-1',
      faceId: 'face-1',
    });
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
    expect(calls.createRunKeys).toEqual(['wamid.1:0']);
    expect(texts(r.messages)[0]).toBe(
      "Generating your 2 poses...\nWe're creating your catalogue images.\nThis may take a few seconds.",
    );
  });

  it('picks from two templates start one run per template, each with its own key', async () => {
    const { deps, calls } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await generated(deps, ['e', 'a']);
    expect(calls.createRun.map((b) => b.inputs.catalogueTemplateMappingId)).toEqual([
      'map-1',
      'map-2',
    ]);
    expect(calls.createRun.map((b) => b.inputs.looks)).toEqual([
      [{ poseId: 'pose-a', backgroundId: 'bg-a' }],
      [{ poseId: 'pose-e', backgroundId: 'bg-e' }],
    ]);
    expect(calls.createRunKeys).toEqual(['wamid.1:0', 'wamid.1:1']);
    expect(r.session.runs?.map((x) => x.runId)).toEqual(['run-1', 'run-2']);
    expect(texts(r.messages)[0]).toBe(
      "Generating your 2 poses...\nWe're creating your catalogue images.\nThis may take a few seconds.",
    );
  });

  it('quotes every group before creating any run', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps, calls } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      quote: async (_u, body) => {
        if (body.inputs.catalogueTemplateMappingId === 'map-2')
          throw new AppError('BAD_CATALOG', 400, 'not configured');
        return { images: 1, perImage: 5, total: 5, balance: 50 };
      },
    });
    const r = await generated(deps, ['a', 'e']);
    expect(calls.createRun).toHaveLength(0);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', picked: [] });
  });

  it('a later group that fails leaves its looks unstarted and says so', async () => {
    let n = 0;
    const { deps } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      createRun: async (_ctx, body) => {
        n++;
        if (n === 2) throw insufficient();
        return { runId: `run-${n}`, images: body.inputs.looks?.length ?? 0 };
      },
    });
    const r = await generated(deps, ['a', 'e']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      runs: [{ runId: 'run-1', images: 1 }],
      unstarted: ['e'],
      picked: ['a', 'e'],
    });
    expect(texts(r.messages)).toEqual([
      "Generating your 1 pose...\nWe're creating your catalogue images.\nThis may take a few seconds.",
      "Started 1 of 2 images. The rest couldn't start: insufficient credits",
    ]);
  });

  it('a first group that fails to create is handled like a single failure', async () => {
    const { deps } = fakeDeps({
      createRun: async () => {
        throw insufficient();
      },
    });
    const r = await generated(deps, ['a']);
    expect(r.session).toMatchObject({ state: 'NO_CREDITS', picked: ['a'] });
  });

  it('a look that changed at create time returns to the count question with the selection cleared', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      createRun: async () => {
        throw new AppError(
          'BAD_CATALOG',
          400,
          'one or more looks are not configured for this template mapping',
        );
      },
    });
    const r = await generated(deps, ['a']);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', picked: [] });
  });

  it('a session saved with an older shape still generates at the bot shape', async () => {
    // Sessions live 24 h and every message extends them, so one created before the
    // switch to 3:4 / 2K must not keep its 1:1 / HD.
    const { deps, calls } = fakeDeps({
      getUserDefaults: async () => ({ aspectRatio: '3:4', resolution: '2K' }),
    });
    const at = await atCount(deps);
    const stale = { ...at.session, aspectRatio: '1:1' as const, resolution: 'HD' as const };
    const out = await handle(stale, tap(at, 'count', '1'), CTX, deps);
    expect(out.session.state).toBe('GENERATING');
    expect(calls.createRun[0]).toMatchObject({ aspectRatio: '3:4', resolution: '2K' });
    expect(out.session).toMatchObject({ aspectRatio: '3:4', resolution: '2K' });
  });

  it('a look with a lower slot gets the type default lower', async () => {
    const { deps, calls } = fakeDeps();
    await generated(deps, ['b']);
    expect(calls.createRun[0].inputs.lowerCatalogId).toBe('lower-default');
  });

  it('a type with a default shoe offers the shoe look and sends the shoe', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultShoeCatalogId: 'shoe-default' }],
    });
    await generated(deps, ['d']);
    expect(calls.createRun[0].inputs.shoeCatalogId).toBe('shoe-default');
  });

  it('a lower-only template sends the photo as the lower garment', async () => {
    const lowerOnly = { ...TEMPLATE, looks: [look('j', { hasUpper: false, hasLower: true })] };
    const { deps, calls } = fakeDeps({ getTemplates: async () => [lowerOnly] });
    await generated(deps, ['j']);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toBe(
      calls.createRun[0].inputs.upperGarmentKey,
    );
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: required extra photos', () => {
  it('asks for the third photo before the pose count and sends it', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresThirdUpload: true, thirdUploadLabel: 'dupatta' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(ask.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the dupatta.');
    deps.shuffle = prefer(['a']);
    const at = await handle(ask.session, photo(3), CTX, deps);
    expect(at.session.state).toBe('ASK_POSE_COUNT');
    await handle(at.session, tap(at, 'count', '1'), CTX, deps);
    expect(calls.createRun[0].inputs.thirdGarmentKey).toContain('000000000003');
  });

  it('a lower-photo type sends that photo instead of a lower item', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresLowerUpload: true, lowerUploadLabel: 'pyjama' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'men')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the pyjama.');
    deps.shuffle = prefer(['b']);
    const at = await handle(ask.session, photo(4), CTX, deps);
    expect(at.session.state).toBe('ASK_POSE_COUNT');
    await handle(at.session, tap(at, 'count', '1'), CTX, deps);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toContain('000000000004');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: extra photo wording', () => {
  const SET = {
    ...GT_SHIRT,
    requiresLowerUpload: true,
    requiresThirdUpload: true,
    upperUploadLabel: 'Upload Shirt',
    lowerUploadLabel: 'Upload Trouser',
    thirdUploadLabel: 'Scarf',
  };

  it('drops the studio "Upload" prefix and names the first photo once', async () => {
    const { deps } = fakeDeps({ listGarmentTypes: async () => [SET] });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'men')]);
    const first = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(texts(first.messages)[0]).toBe(
      "I'll use the photo you sent as the shirt. Now send a photo of the trouser.",
    );
    const second = await handle(first.session, photo(2), CTX, deps);
    expect(second.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(second.messages)[0]).toBe('Now send a photo of the scarf.');
  });

  it('says nothing about the first photo when the type has no upper label', async () => {
    const { deps } = fakeDeps({
      listGarmentTypes: async () => [
        { ...SET, upperUploadLabel: null, requiresThirdUpload: false },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'men')]);
    const first = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(texts(first.messages)[0]).toBe('Now send a photo of the trouser.');
  });
});

describe('engine: progress and delivery', () => {
  const finished = (runId: string, images: number, failedPoseIds: string[] = []): InboundEvent => ({
    type: 'runFinished',
    runId,
    images,
    failedPoseIds,
  });

  it('messages while generating report progress summed over the runs', async () => {
    const { deps } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      runProgress: async (id) =>
        id === 'run-1' ? { finished: 1, total: 1 } : { finished: 0, total: 1 },
    });
    const gen = await generated(deps, ['a', 'e']);
    const r = await handle(gen.session, { type: 'text', text: 'done yet?' }, CTX, deps);
    expect(texts(r.messages)).toEqual(['Still generating: 1 of 2 done.']);
  });

  it('one run finishing summarises the credits used and offers the next steps', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2), CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    expect(texts(r.messages)).toContain(
      'Here are your 2 generated poses!\nCategory: Women | Garment: Shirt\nCredits used: 10 credits\nRemaining balance: 50 credits',
    );
    expect(r.messages.at(-1)).toMatchObject({ text: 'What would you like to do next?' });
    expect(buttonTitles(r.messages.at(-1))).toEqual([
      'More poses',
      'Change garment',
      'New catalog',
    ]);
  });

  it('Change garment after delivery returns to the garment-type list, keeping photo and gender', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a']);
    const done = await handle(gen.session, finished('run-1', 1), CTX, deps);
    const r = await handle(done.session, tap(done, 'change'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women', picked: [] });
    expect(r.session.garmentKey).toContain('000000000001');
    expect(r.session.seenLooks).toBeUndefined();
  });

  it('with several runs the closing message waits for the last one', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const gen = await generated(deps, ['a', 'e']);
    const first = await handle(gen.session, finished('run-1', 1), CTX, deps);
    expect(first.messages).toEqual([]);
    expect(first.session.state).toBe('GENERATING');
    const repeat = await handle(first.session, finished('run-1', 1), CTX, deps);
    expect(repeat.messages).toEqual([]);
    const last = await handle(first.session, finished('run-2', 1), CTX, deps);
    expect(last.session.state).toBe('DELIVERED');
    expect(buttonTitles(last.messages.at(-1))).toEqual([
      'More poses',
      'Change garment',
      'New catalog',
    ]);
  });

  it('a runFinished for an older run changes nothing', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('other', 2), CTX, deps);
    expect(r).toEqual({ session: gen.session, messages: [] });
  });

  it('partial failure reports the refund; Retry regenerates only the failed looks', async () => {
    const { deps, calls } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2, ['pose-c']), CTX, deps);
    expect(texts(r.messages)[0]).toBe('1 of 2 images failed. The credits for it were refunded.');
    expect(texts(r.messages)).toContain(
      'Here are your 1 generated pose!\nCategory: Women | Garment: Shirt\nCredits used: 5 credits\nRemaining balance: 50 credits',
    );
    expect(buttonTitles(r.messages.at(-1))).toEqual(['Retry failed', 'More poses', 'Menu']);
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs.looks).toEqual([
      { poseId: 'pose-c', backgroundId: 'bg-c' },
    ]);
  });

  it('Retry also starts the looks whose run never started', async () => {
    let n = 0;
    const { deps, calls } = fakeDeps({
      getTemplates: async () => [TEMPLATE, TEMPLATE_2],
      createRun: async (_ctx, body) => {
        n++;
        if (n === 2) throw insufficient();
        calls.createRun.push(body);
        return { runId: `run-${n}`, images: body.inputs.looks?.length ?? 0 };
      },
    });
    const gen = await generated(deps, ['a', 'e']);
    const done = await handle(gen.session, finished('run-1', 1), CTX, deps);
    expect(done.session.state).toBe('DELIVERED');
    expect(buttonTitles(done.messages.at(-1))).toEqual(['Retry failed', 'More poses', 'Menu']);
    const retry = await handle(done.session, tap(done, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs).toMatchObject({
      catalogueTemplateMappingId: 'map-2',
      looks: [{ poseId: 'pose-e', backgroundId: 'bg-e' }],
    });
  });

  it('More poses returns to the count question with the garment, type, face and seen looks kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      garmentType: { id: 'gt-shirt' },
      faceId: 'face-1',
      picked: [],
      seenLooks: ['a', 'c'],
    });
    expect(r.session.garmentKey).toContain('000000000001');
  });

  it('a new photo after delivery starts a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, photo(5), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', picked: [] });
    expect(r.session.garmentType).toBeUndefined();
    expect(r.session.garmentKey).toContain('000000000005');
  });
});

describe('engine: sessions saved by the single-template engine', () => {
  const legacy = {
    v: 1,
    state: 'GENERATING',
    nonce: 'n1',
    page: 0,
    aspectRatio: '3:4',
    resolution: 'HD',
    photos: {},
    picked: ['a'],
    template: { id: 'tpl-1', mappingId: 'map-1', lowerOnly: false, looks: [] },
    count: 1,
    runId: 'run-1',
    runImages: 1,
  } as unknown as Session;

  it('a generating session is read as a one-run list and still gets its closing message', async () => {
    const { deps } = fakeDeps();
    const r = await handle(
      legacy,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(r.session.state).toBe('DELIVERED');
    expect(r.session).not.toHaveProperty('runId');
    expect(r.session).not.toHaveProperty('template');
  });

  it('a session that was still picking starts over like an expired one', async () => {
    const { deps } = fakeDeps();
    const picking = { ...legacy, state: 'PICK_LOOKS', runId: undefined } as unknown as Session;
    const r = await handle(picking, { type: 'reply', id: 'n1|look|a' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/session expired/);
    expect(r.session.state).toBe('MAIN_MENU');
  });
});

describe('engine: review fixes', () => {
  it('a session mapped from the old flow answers an old tap with the stale text and the count list', async () => {
    const { deps } = fakeDeps();
    const base = await atCount(deps);
    const mapped = { ...base.session, nonce: 'migrated' } as Session;
    const r = await handle(mapped, { type: 'reply', id: 'n1|look|a' }, CTX, deps);
    expect(texts(r.messages)[0]).toBe('That option is from an earlier step.');
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(r.messages.length).toBeGreaterThan(1);
  });

  it('a first photo with no session is recognised and the kind confirmed', async () => {
    const { deps, calls } = fakeDeps(KIND);
    const r = await handle(null, photo(1), CTX, deps);
    expect(calls.recognize).toHaveLength(1);
    expect(r.session).toMatchObject({ state: 'CONFIRM_KIND', kind: 'Shirt' });
  });

  it('a first photo with no session and no recognition goes to the gender question', async () => {
    const { deps } = fakeDeps({ recognizeKind: async () => null });
    const r = await handle(null, photo(1), CTX, deps);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.kind).toBeUndefined();
  });

  it('an invalid reply at CONFIRM_KIND reprompts and keeps the state', async () => {
    const { deps } = fakeDeps(KIND);
    const at = await run(deps, [() => photo(1)]);
    const r = await handle(
      at.session,
      { type: 'reply', id: encodeReplyId(at.session.nonce, 'bogus', '') },
      CTX,
      deps,
    );
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
    expect(r.session.state).toBe('CONFIRM_KIND');
  });

  it('a new photo clears the looks already seen', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a']);
    const done = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 1, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(done.session.seenLooks).toEqual(['a']);
    const r = await handle(done.session, photo(2), CTX, deps);
    expect(r.session.seenLooks).toBeUndefined();
  });
});
