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

  it('recognised: the type is announced and pose picking follows', async () => {
    const { deps } = fakeDeps({
      recognizeGarment: async () => ({ garmentTypeId: 'gt-shirt', label: 'Shirt' }),
    });
    const r = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(texts(r.messages)[0]).toBe('Detected: Shirt.');
    expect(r.session).toMatchObject({
      state: 'PICK_LOOKS',
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

  it('not recognised: the garment-type list, then a pick goes to pose picking', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.text).toBe('Which garment is it?');
    const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'PICK_LOOKS', recognized: false });
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

  it('no template, no face, or no eligible look gets the web-studio message, and the reason is reported', async () => {
    // The seller only sees "not available"; the reason goes to the log, so an
    // admin-data gap (no face, no template, every look needing a missing default
    // lower/shoe under D49) is found without stepping through the engine.
    const shoeOnly = { ...TEMPLATE, looks: [look('s', { hasShoes: true })] };
    for (const [over, reason] of [
      [{ getTemplates: async () => [] }, 'no_template'],
      [{ getDefaultFaceId: async () => null }, 'no_face'],
      [{ getTemplates: async () => [shoeOnly] }, 'no_eligible_looks'],
    ] as const) {
      const { deps, calls } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/^Shirt catalogs aren't available on WhatsApp yet/);
      expect(r.session.state).toBe('MAIN_MENU');
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

// A seller at the pose cards for GT_SHIRT, through the garment-type list.
async function atPick(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'gt', 'gt-shirt')], list);
}

// Taps each look on the cards `at` offered, in order. Returns the cards result
// and the result of the last tap (whose buttons hold Generate).
async function pickLooks(deps: EngineDeps, lookIds: string[]) {
  const at = await atPick(deps);
  let r = at;
  for (const id of lookIds) r = await handle(r.session, tap(at, 'look', id), CTX, deps);
  return { at, r };
}

async function generated(deps: EngineDeps, lookIds: string[]) {
  const { r } = await pickLooks(deps, lookIds);
  return handle(r.session, tap(r, 'generate'), CTX, deps);
}

const buttonTitles = (m: OutboundMessage | undefined) =>
  m && m.kind === 'buttons' ? m.buttons.map((b) => b.title) : [];

describe('engine: pose cards', () => {
  it('prompts with the cost and balance, offers Change, and lists the eligible looks', async () => {
    const { deps, calls } = fakeDeps();
    const r = await atPick(deps);
    const [prompt, cards, footer] = r.messages;
    expect('text' in prompt && prompt.text).toBe(
      'Pick the poses you want. Each one is 5 credits. Your balance: 50 credits.',
    );
    expect(buttonTitles(prompt)).toEqual(['Change garment']);
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): 3 looks, not 4.
    expect(cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
    ]);
    expect('text' in footer && footer.text).toBe('Select poses above, then tap Generate.');
    expect(buttonTitles(footer)).toEqual(['Generate', 'Clear']);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'pose-a', backgroundId: 'bg-a' }]);
  });

  it('pools the looks of every template, showing a repeated pose + background once', async () => {
    const { deps } = fakeDeps({ getTemplates: async () => [TEMPLATE, TEMPLATE_2] });
    const r = await atPick(deps);
    const cards = r.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards.map((c) => c.title) : []).toEqual([
      'Pose a',
      'Pose b',
      'Pose c',
      'Pose e',
      'Pose f',
    ]);
  });

  it('pages at 10 cards with More; a pick from page 1 still works after More', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 12 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplates: async () => [big] });
    const at = await atPick(deps);
    const cards = at.messages.find((m) => m.kind === 'cards');
    expect(cards && cards.kind === 'cards' ? cards.cards : []).toHaveLength(10);
    expect(buttonTitles(at.messages.at(-1))).toEqual(['More', 'Generate', 'Clear']);
    const second = await handle(at.session, tap(at, 'more'), CTX, deps);
    const rest = second.messages.find((m) => m.kind === 'cards');
    expect(rest && rest.kind === 'cards' ? rest.cards.map((c) => c.title) : []).toEqual([
      'Pose l10',
      'Pose l11',
    ]);
    // Page 2 does not repeat the price prompt, and the nonce is unchanged.
    expect(second.messages[0].kind).toBe('cards');
    const pickOne = await handle(second.session, tap(at, 'look', 'l0'), CTX, deps);
    expect(pickOne.session.picked).toEqual(['l0']);
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
    const at = await atPick(listed.deps);
    await handle(at.session, tap(at, 'change'), CTX, listed.deps);
    expect(listed.calls.corrected).toBe(0);
  });

  it('a quote error is shown before any credits are taken', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps } = fakeDeps({
      quote: async () => {
        throw new AppError('VALIDATION', 400, 'face not found or inactive');
      },
    });
    const r = await atPick(deps);
    expect(texts(r.messages)).toContain('face not found or inactive');
    expect(r.session.state).toBe('MAIN_MENU');
  });
});

describe('engine: selecting poses', () => {
  it('a tap selects and reports the count and cost; tapping again removes it', async () => {
    const { deps } = fakeDeps();
    const { at, r: one } = await pickLooks(deps, ['a']);
    expect(texts(one.messages)).toEqual(['1 selected · 5 credits']);
    expect(buttonTitles(one.messages[0])).toEqual(['Generate', 'Clear']);
    expect(one.session.picked).toEqual(['a']);
    const off = await handle(one.session, tap(at, 'look', 'a'), CTX, deps);
    expect(texts(off.messages)).toEqual(['0 selected · 0 credits']);
    expect(off.session.picked).toEqual([]);
  });

  it('Clear empties the selection', async () => {
    const { deps } = fakeDeps();
    const { r } = await pickLooks(deps, ['a', 'c']);
    const cleared = await handle(r.session, tap(r, 'clear'), CTX, deps);
    expect(cleared.session.picked).toEqual([]);
    expect(texts(cleared.messages)).toEqual(['0 selected · 0 credits']);
  });

  it('declines a 21st pose', async () => {
    const big = { ...TEMPLATE, looks: Array.from({ length: 22 }, (_, i) => look(`l${i}`)) };
    const { deps } = fakeDeps({ getTemplates: async () => [big] });
    const at = await atPick(deps);
    let s = at.session;
    for (let i = 0; i < 20; i++) {
      const r = await handle(
        s,
        { type: 'reply', id: encodeReplyId(s.nonce, 'look', `l${i}`) },
        CTX,
        deps,
      );
      s = r.session;
    }
    expect(s.picked).toHaveLength(20);
    const over = await handle(
      s,
      { type: 'reply', id: encodeReplyId(s.nonce, 'look', 'l20') },
      CTX,
      deps,
    );
    expect(texts(over.messages)).toEqual(['You can generate up to 20 poses at a time.']);
    expect(over.session.picked).toHaveLength(20);
  });

  it('a look that is not on the cards is re-prompted', async () => {
    const { deps } = fakeDeps();
    const at = await atPick(deps);
    const r = await handle(
      at.session,
      { type: 'reply', id: encodeReplyId(at.session.nonce, 'look', 'nope') },
      CTX,
      deps,
    );
    expect(texts(r.messages)[0]).toBe('Please use the options above, or type MENU.');
  });

  it('Generate with nothing selected asks for a pose and stays on the cards', async () => {
    const { deps, calls } = fakeDeps();
    const at = await atPick(deps);
    const r = await handle(at.session, tap(at, 'generate'), CTX, deps);
    expect(texts(r.messages)).toEqual(['Tap at least one pose first.']);
    expect(r.session.state).toBe('PICK_LOOKS');
    expect(calls.createRun).toHaveLength(0);
  });

  it('a selection the balance cannot cover goes to NO_CREDITS before any run; credits added return to the cards with the selection kept', async () => {
    const { deps, calls } = fakeDeps({ getBalance: async () => 8 });
    const { r } = await pickLooks(deps, ['a', 'b']);
    const no = await handle(r.session, tap(r, 'generate'), CTX, deps);
    expect(no.session.state).toBe('NO_CREDITS');
    expect(texts(no.messages)[0]).toContain('https://app.test/pricing');
    expect(calls.createRun).toHaveLength(0);
    const back = await handle(no.session, { type: 'creditsAdded', credits: 100 }, CTX, deps);
    expect(texts(back.messages)[0]).toBe('100 credits added.');
    expect(back.session).toMatchObject({ state: 'PICK_LOOKS', picked: ['a', 'b'] });
  });
});

describe('engine: generating', () => {
  it('one template: one run with exactly the picked looks, in tap order', async () => {
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
      "Working on 2 images, 10 credits. I'll send each one here as it's ready.",
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
      "Working on 2 images, 10 credits. I'll send each one here as it's ready.",
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
    expect(r.session).toMatchObject({ state: 'PICK_LOOKS', picked: [] });
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
      "Working on 1 image, 5 credits. I'll send each one here as it's ready.",
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

  it('a look that changed at create time returns to the cards with the selection cleared', async () => {
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
    expect(r.session).toMatchObject({ state: 'PICK_LOOKS', picked: [] });
  });

  it('a look removed since the cards were shown is dropped, nothing is charged', async () => {
    let current = TEMPLATE;
    const { deps, calls } = fakeDeps({ getTemplates: async () => [current] });
    const { r } = await pickLooks(deps, ['a', 'c']);
    current = { ...TEMPLATE, looks: TEMPLATE.looks.filter((l) => l.id !== 'c') };
    const out = await handle(r.session, tap(r, 'generate'), CTX, deps);
    expect(texts(out.messages)[0]).toBe('Those poses changed. Please choose again.');
    expect(out.session).toMatchObject({ state: 'PICK_LOOKS', picked: ['a'] });
    expect(calls.createRun).toHaveLength(0);
  });

  it('a session saved with an older shape still generates at the bot shape', async () => {
    // Sessions live 24 h and every message extends them, so one created before the
    // switch to 3:4 / 2K must not keep its 1:1 / HD.
    const { deps, calls } = fakeDeps({
      getUserDefaults: async () => ({ aspectRatio: '3:4', resolution: '2K' }),
    });
    const { r } = await pickLooks(deps, ['a']);
    const stale = { ...r.session, aspectRatio: '1:1' as const, resolution: 'HD' as const };
    const out = await handle(stale, tap(r, 'generate'), CTX, deps);
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
  it('asks for the third photo before the cards and sends it', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [
        { ...GT_SHIRT, requiresThirdUpload: true, thirdUploadLabel: 'dupatta' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const ask = await handle(list.session, tap(list, 'gt', 'gt-shirt'), CTX, deps);
    expect(ask.session.state).toBe('ASK_EXTRA_PHOTO');
    expect(texts(ask.messages)[0]).toBe('Now send a photo of the dupatta.');
    const cards = await handle(ask.session, photo(3), CTX, deps);
    expect(cards.session.state).toBe('PICK_LOOKS');
    const one = await handle(cards.session, tap(cards, 'look', 'a'), CTX, deps);
    await handle(one.session, tap(one, 'generate'), CTX, deps);
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
    const cards = await handle(ask.session, photo(4), CTX, deps);
    const one = await handle(cards.session, tap(cards, 'look', 'b'), CTX, deps);
    await handle(one.session, tap(one, 'generate'), CTX, deps);
    expect(calls.createRun[0].inputs.lowerGarmentKey).toContain('000000000004');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
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

  it('one run finishing with no failures offers more poses and a new catalog', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const r = await handle(gen.session, finished('run-1', 2), CTX, deps);
    expect(r.session.state).toBe('DELIVERED');
    expect(buttonTitles(r.messages.at(-1))).toEqual(['More poses', 'New catalog']);
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
    expect(buttonTitles(last.messages.at(-1))).toEqual(['More poses', 'New catalog']);
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

  it('More poses returns to the cards with the garment, type and face kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({
      state: 'PICK_LOOKS',
      garmentType: { id: 'gt-shirt' },
      faceId: 'face-1',
      picked: [],
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
