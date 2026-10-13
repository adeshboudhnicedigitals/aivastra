import { describe, expect, it } from 'vitest';
import { handle } from '../src/modules/messaging/engine/engine';
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import type {
  EngineDeps,
  EngineResult,
  InboundEvent,
  OutboundMessage,
} from '../src/modules/messaging/engine/types';
import { CTX, fakeDeps, GT_SHIRT, insufficient, look, TEMPLATE } from './helpers/engine-fakes';

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
    expect(texts(again.messages)).toEqual(['That option is from an earlier step.']);
    expect(again.session).toEqual(next.session);
  });
});

describe('engine: photo, gender and garment type', () => {
  it('New catalog asks for the photo; the photo leads to the four-gender list', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [(x) => tap(x, 'menu', 'new'), () => photo(1)]);
    expect(r.session).toMatchObject({
      state: 'ASK_GENDER',
      garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg',
    });
    const list = listOf(r);
    expect(list?.text).toBe('Create catalogue for:');
    expect(list?.rows.map((x) => x.title)).toEqual(['Women', 'Men', 'Boys', 'Girls']);
  });

  it('a photo sent from the main menu starts at the gender step', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [() => photo(2)]);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.garmentKey).toContain('000000000002');
  });

  it('recognised: the type is announced and the count step follows', async () => {
    const { deps } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toBe('Detected: Shirt.');
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
      recognized: true,
      faceId: 'face-1',
    });
  });

  it('recognition is asked with the photo and the tapped gender', async () => {
    const { deps, calls } = fakeDeps();
    await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'boys')]);
    expect(calls.recognize).toEqual([
      { garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg', gender: 'boys' },
    ]);
  });

  it('not recognised: the garment-type list, then a pick goes to the count step', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.text).toBe('Which garment is it?');
    const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', recognized: false });
    expect(texts(r.messages)).not.toContain('Detected: Shirt.');
  });

  it('a recognised type the bot cannot offer gets the web-studio message (D47)', async () => {
    const { deps } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-saree', label: 'Saree' }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toBe(
      "Saree catalogs aren't available on WhatsApp yet. You can create one in the web studio: https://app.test/studio",
    );
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('no template or no face for the type also gets the web-studio message', async () => {
    for (const over of [
      { getTemplate: async () => null },
      { getDefaultFaceId: async () => null },
    ]) {
      const { deps } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/^Shirt catalogs aren't available on WhatsApp yet/);
      expect(r.session.state).toBe('MAIN_MENU');
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

// A seller at the count step for GT_SHIRT, through the garment-type list.
async function atCount(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

async function picked(deps: EngineDeps, count: number, lookIds: string[]) {
  const at = await atCount(deps);
  const pick = await run(deps, [(x) => tap(x, 'count', String(count))], at);
  let r = pick;
  for (const id of lookIds) r = await handle(r.session, tap(pick, 'look', id), CTX, deps);
  return { pick, r };
}

describe('engine: pose count', () => {
  it('lists 1..eligible looks with the cost, the balance and a Change row', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atCount(deps);
    const list = listOf(r);
    expect(list?.text).toBe('How many poses do you want? Your balance: 50 credits.');
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): 3 looks, not 4.
    expect(list?.rows.map((x) => x.title)).toEqual([
      '1 pose · 5 credits',
      '2 poses · 10 credits',
      '3 poses · 15 credits',
      'Wrong garment? Change',
    ]);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('never offers more than 9', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 12 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplate: async () => big });
    expect(listOf(await atCount(deps))?.rows).toHaveLength(10);
  });

  it('Change after a recognised type counts a correction; after a list pick it does not', async () => {
    const recognised = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r1 = await run(recognised.deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'change'),
    ]);
    expect(r1.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    expect(r1.session.garmentKey).toContain('000000000001');
    expect(recognised.calls.corrected).toBe(1);

    const listed = fakeDeps();
    const at = await atCount(listed.deps);
    await handle(at.session, tap(at, 'change'), CTX, listed.deps);
    expect(listed.calls.corrected).toBe(0);
  });

  it('a count the balance cannot cover goes to NO_CREDITS; credits added returns to the count', async () => {
    const { deps } = fakeDeps({ getBalance: async () => 8 });
    const at = await atCount(deps);
    const r = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(r.session.state).toBe('NO_CREDITS');
    expect(texts(r.messages)[0]).toContain('https://app.test/pricing');
    const back = await handle(r.session, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(texts(back.messages)[0]).toBe('100 credits added.');
    expect(back.session.state).toBe('ASK_POSE_COUNT');
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
});

describe('engine: picking looks', () => {
  it('shows the eligible looks; each tap adds one; a repeat is not counted', async () => {
    const { deps } = fakeDeps();
    const { pick } = await picked(deps, 2, []);
    expect(pick.session.state).toBe('PICK_LOOKS');
    const cards = pick.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
    ]);
    const one = await handle(pick.session, tap(pick, 'look', 'a'), CTX, deps);
    expect(texts(one.messages)[0]).toBe('Added, 1 of 2.');
    const dup = await handle(one.session, tap(pick, 'look', 'a'), CTX, deps);
    expect(texts(dup.messages)).toEqual(['That pose is already added.']);
    expect(dup.session.picked).toEqual(['a']);
  });

  it('the last pick starts generation with exactly the picked looks', async () => {
    const { deps, calls } = fakeDeps();
    const { r } = await picked(deps, 2, ['c', 'a']);
    expect(r.session).toMatchObject({ state: 'GENERATING', runId: 'run-1', runImages: 2 });
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
    expect(texts(r.messages)[0]).toBe(
      "Working on 2 images, 10 credits. I'll send each one here as it's ready.",
    );
  });

  it('a look with a lower slot gets the type default lower', async () => {
    const { deps, calls } = fakeDeps();
    await picked(deps, 1, ['b']);
    expect(calls.createRun[0].inputs.lowerCatalogId).toBe('lower-default');
  });

  it('a type with a default shoe offers the shoe look and sends the shoe', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultShoeCatalogId: 'shoe-default' }],
    });
    await picked(deps, 1, ['d']);
    expect(calls.createRun[0].inputs.shoeCatalogId).toBe('shoe-default');
  });

  it('a lower-only template sends the photo as the lower garment', async () => {
    const lowerOnly = { ...TEMPLATE, looks: [look('j', { hasUpper: false, hasLower: true })] };
    const { deps, calls } = fakeDeps({ getTemplate: async () => lowerOnly });
    await picked(deps, 1, ['j']);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toBe(
      calls.createRun[0].inputs.upperGarmentKey,
    );
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });

  it('short of credits at create time goes to NO_CREDITS', async () => {
    const { deps } = fakeDeps({
      createRun: async () => {
        throw insufficient();
      },
    });
    const { r } = await picked(deps, 1, ['a']);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('a look that changed meanwhile returns to the count step', async () => {
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
    const { r } = await picked(deps, 1, ['a']);
    expect(texts(r.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', picked: [] });
  });
});

describe('engine: required extra photos', () => {
  it('asks for the third photo before the count and sends it', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresThirdUpload: true, thirdUploadLabel: 'dupatta' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(ask.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the dupatta.');
    const count = await handle(ask.session, photo(3), CTX, deps);
    expect(count.session.state).toBe('ASK_POSE_COUNT');
    const pick = await handle(count.session, tap(count, 'count', '1'), CTX, deps);
    await handle(pick.session, tap(pick, 'look', 'a'), CTX, deps);
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
    const count = await handle(ask.session, photo(4), CTX, deps);
    const pick = await handle(count.session, tap(count, 'count', '1'), CTX, deps);
    await handle(pick.session, tap(pick, 'look', 'b'), CTX, deps);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toContain('000000000004');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
  });
});

describe('engine: generating and delivery', () => {
  const generated = async (deps: EngineDeps) => (await picked(deps, 2, ['a', 'c'])).r;

  it('messages while generating report progress', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(gen.session, { type: 'text', text: 'done yet?' }, CTX, deps);
    expect(texts(r.messages)).toEqual(['Still generating: 1 of 2 done.']);
  });

  it('runFinished with no failures offers more poses and a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(r.session.state).toBe('DELIVERED');
    const btns = r.messages.at(-1);
    expect(btns && btns.kind === 'buttons' ? btns.buttons.map((b) => b.title) : []).toEqual([
      'More poses',
      'New catalog',
    ]);
  });

  it('a runFinished for an older run changes nothing', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(
      gen.session,
      { type: 'runFinished', runId: 'other', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(r).toEqual({ session: gen.session, messages: [] });
  });

  it('partial failure reports the refund; Retry regenerates only the failed looks', async () => {
    const { deps, calls } = fakeDeps();
    const gen = await generated(deps);
    const r = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: ['pose-c'] },
      CTX,
      deps,
    );
    expect(texts(r.messages)[0]).toBe('1 of 2 images failed. The credits for it were refunded.');
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    expect(calls.createRun.at(-1)?.inputs.looks).toEqual([
      { poseId: 'pose-c', backgroundId: 'bg-c' },
    ]);
  });

  it('More poses returns to the count with the garment, type and face kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const done = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      garmentType: { id: 'gt-shirt' },
      faceId: 'face-1',
      picked: [],
    });
    expect(r.session.garmentKey).toContain('000000000001');
  });

  it('a new photo after delivery starts a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps);
    const done = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    const r = await handle(done.session, photo(5), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_GENDER', picked: [] });
    expect(r.session.garmentType).toBeUndefined();
    expect(r.session.garmentKey).toContain('000000000005');
  });
});
