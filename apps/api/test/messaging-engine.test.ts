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
import { CTX, fakeDeps, GT_SHIRT, insufficient, look, POSES } from './helpers/engine-fakes';

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

  it('a tap with no session shows the menu without an expiry line', async () => {
    const { deps } = fakeDeps();
    const r = await handle(null, { type: 'reply', id: 'old|look|x' }, CTX, deps);
    expect(r.messages).toHaveLength(1);
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
      'You have 50 credits remaining. 💳\nBuy more on the website: https://app.test/pricing',
    );
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('a tap from an earlier step is ignored silently and the step is shown again', async () => {
    const { deps } = fakeDeps();
    const ask = await run(deps, [() => photo(1)]);
    const staleTap = tap(ask, 'gender', 'women');
    const next = await handle(ask.session, staleTap, CTX, deps);
    const again = await handle(next.session, staleTap, CTX, deps);
    expect(again.messages).toHaveLength(1);
    expect(again.messages.at(-1)?.kind).toBe('list');
    expect(again.session).toEqual(next.session);
  });

  it('a Menu-group button works from an old message and keeps the seller in place', async () => {
    const { deps } = fakeDeps();
    const menu = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    const prompt = await handle(menu.session, tap(menu, 'menu', 'new'), CTX, deps);
    const r = await handle(prompt.session, tap(menu, 'menu', 'credits'), CTX, deps);
    expect(r.messages).toHaveLength(1);
    expect(texts(r.messages)[0]).toContain('credits');
    expect(texts(r.messages)[0]).toContain('Send a garment photo to start.');
    expect(r.session).toEqual(prompt.session);
  });

  it('credits at the count step answer, then show the count list again with the draft kept', async () => {
    const { deps } = fakeDeps();
    const menu = await handle(null, { type: 'text', text: 'hi' }, CTX, deps);
    const at = await atCount(deps);
    const r = await handle(at.session, tap(menu, 'menu', 'credits'), CTX, deps);
    expect(texts(r.messages)[0]).toContain('credits');
    expect(r.messages.at(-1)?.kind).toBe('list');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentKey: at.session.garmentKey });
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

// Recognised as the "Tops" basket (Shirt is its representative), with a
// "Lowers" alternative behind "No, different item".
const ALL_BASKETS = [
  { key: 'b:tops', name: 'Tops' },
  { key: 'b:lowers', name: 'Lowers' },
];
const BASKETS = {
  recognizeBaskets: async () => [
    { key: 'b:tops', name: 'Tops' },
    { key: 'b:lowers', name: 'Lowers' },
  ],
  basketTypes: async (_g: Gender, key: string) =>
    key === 'b:tops'
      ? [{ id: 'gt-shirt', label: 'Shirt' }]
      : key === 'b:lowers'
        ? [{ id: 'gt-trouser', label: 'Trouser' }]
        : [],
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
    expect(list?.text).toBe('Who is this catalogue for?');
    expect(list?.rows.map((x) => x.title)).toEqual(['Women', 'Men', 'Boys', 'Girls']);
  });

  it('a photo sent from the main menu starts at the gender step', async () => {
    const { deps } = fakeDeps();
    const r = await run(deps, [() => photo(2)]);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.garmentKey).toContain('000000000002');
  });

  it('recognition waits for the gender, then asks the seller to confirm the basket', async () => {
    const { deps, calls } = fakeDeps(BASKETS);
    const ask = await run(deps, [() => photo(1)]);
    expect(ask.session.state).toBe('ASK_GENDER');
    expect(calls.recognize).toEqual([]);
    const r = await handle(ask.session, tap(ask, 'gender', 'women'), CTX, deps);
    expect(calls.recognize).toEqual([
      { garmentKey: 'inputs/00000000-0000-4000-8000-000000000001/garment.jpg', gender: 'women' },
    ]);
    expect(r.session).toMatchObject({ state: 'CONFIRM_BASKET', gender: 'women' });
    expect(r.messages[0]).toMatchObject({
      kind: 'buttons',
      text: 'This looks like tops. Is that right?',
    });
    expect(buttonTitles(r.messages[0])).toEqual(['Yes, continue', 'Choose garment type', 'Menu']);
  });

  it('Yes runs the basket as its representative type', async () => {
    const { deps, calls } = fakeDeps(BASKETS);
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'confirm'),
    ]);
    expect(calls.basketTypes).toEqual([{ gender: 'women', key: 'b:tops' }]);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      gender: 'women',
      garmentType: { id: 'gt-shirt' },
    });
    expect(r.session.baskets).toBeUndefined();
  });

  it('an unready representative falls through to the next member the bot can offer', async () => {
    const { deps } = fakeDeps({
      ...BASKETS,
      basketTypes: async () => [
        { id: 'gt-unready', label: 'Vest' },
        { id: 'gt-shirt', label: 'Shirt' },
      ],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'men'),
      (x) => tap(x, 'confirm'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-shirt' } });
  });

  it('No opens the full basket list and counts a correction', async () => {
    const { deps, calls } = fakeDeps({ ...BASKETS, listBaskets: async () => ALL_BASKETS });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'change'),
    ]);
    expect(calls.corrected).toBe(1);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
    // Every basket, the rejected guess included.
    expect(listOf(r)?.rows.map((x) => x.title)).toEqual(['Tops', 'Lowers']);
  });

  it('an alternative picked from the list runs as its own representative', async () => {
    const trouser = { ...GT_SHIRT, id: 'gt-trouser', label: 'Trouser' };
    const { deps } = fakeDeps({
      ...BASKETS,
      listBaskets: async () => ALL_BASKETS,
      listGarmentTypes: async () => [GT_SHIRT, trouser],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'change'),
      (x) => tap(x, 'basket', 'b:lowers'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-trouser' } });
  });

  it('No with no alternatives goes straight to the type list', async () => {
    const { deps } = fakeDeps({
      ...BASKETS,
      recognizeBaskets: async () => [{ key: 'b:tops', name: 'Tops' }],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'change'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
  });

  it('a basket that is gone by the time it is confirmed goes to the type list', async () => {
    const { deps } = fakeDeps({ ...BASKETS, basketTypes: async () => [] });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'confirm'),
    ]);
    expect(r.session).toMatchObject({ state: 'ASK_GARMENT_TYPE', gender: 'women' });
  });

  it('a recognised basket the bot cannot offer hands off to the studio, keeps the session and reports why', async () => {
    const { deps, calls } = fakeDeps({
      ...BASKETS,
      basketTypes: async () => [{ id: 'gt-saree', label: 'Saree' }],
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'confirm'),
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
      ...BASKETS,
      basketTypes: async () => [{ id: 'gt-saree', label: 'Saree' }],
      getReadiness: async () => ({ status: 'blocked', reasons: ['mannequin_flow'] }),
      listGarmentTypes: async () => [],
    });
    const r = await run(deps, [
      () => photo(1),
      (x) => tap(x, 'gender', 'women'),
      (x) => tap(x, 'confirm'),
    ]);
    const sent = texts(r.messages);
    expect(sent[0]).toMatch(/^Saree catalogs can't be made .*https:\/\/app\.test\/studio\?draft=/);
    expect(sent.join('\n')).not.toContain('Or choose another type.');
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('not recognised: the list shows baskets, and a basket row runs its representative', async () => {
    const { deps } = fakeDeps({
      ...BASKETS,
      recognizeBaskets: async () => null,
      listBaskets: async () => [
        { key: 'b:tops', name: 'Tops' },
        { key: 't:gt-kurta', name: 'Kurta' },
      ],
    });
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.rows.map((x) => x.title)).toEqual(['Tops', 'Kurta']);
    const r = await handle(list.session, tap(list, 'basket', 'b:tops'), CTX, deps);
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-shirt' } });
  });

  it('a type row from a list sent before baskets still works', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const r = await handle(
      list.session,
      { type: 'reply', id: encodeReplyId(list.session.nonce, 'gt', 'gt-shirt') },
      CTX,
      deps,
    );
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', garmentType: { id: 'gt-shirt' } });
  });

  it('not recognised: the garment-type list, then a pick goes to the pose count question', async () => {
    const { deps } = fakeDeps();
    const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(list.session.state).toBe('ASK_GARMENT_TYPE');
    expect(listOf(list)?.text).toBe('Which garment is it?');
    const r = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
  });

  it('no pose, face, background or eligible look hands off and the reason is reported', async () => {
    // The seller only sees the hand-off; the reason goes to the log and counter,
    // so an admin-data gap (no face, no pose, every look needing a missing
    // default lower/shoe under D49) is found without stepping through the engine.
    for (const [over, reason] of [
      [{ getLooks: async () => [] }, 'no_poses'],
      [{ listFaceIds: async () => [] }, 'no_face'],
      [{ listBackgroundIds: async () => [] }, 'no_background'],
      [{ getLooks: async () => [look('s', { hasShoes: true })] }, 'no_eligible_looks'],
    ] as const) {
      const { deps, calls } = fakeDeps(over);
      const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
      const r = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
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
    expect(r.messages).toHaveLength(1);
    expect(r.messages.at(-1)?.kind).toBe('list');
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
    // WhatsApp allows 10 rows: 9 types and More.
    expect(listOf(first)?.rows).toHaveLength(10);
    const second = await handle(first.session, tap(first, 'more'), CTX, deps);
    expect(listOf(second)?.rows.map((r) => r.title)).toEqual(['Type 9', 'Type 10', 'Type 11']);
  });
});

// A seller at the pose-count question for GT_SHIRT, through the garment-type list.
async function atCount(deps: EngineDeps) {
  const list = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
  return run(deps, [(x) => tap(x, 'basket', 't:gt-shirt')], list);
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
    expect(list?.text).toBe('How many poses would you like?\nEach pose uses 5 credits.');
    // Look 'd' needs shoes and GT_SHIRT has no default shoe (D49): a pool of 3, so no "5 poses".
    expect(list?.rows.map((x) => x.title)).toEqual([
      '1 pose · 5 credits',
      '2 poses · 10 credits',
      '3 poses · 15 credits',
    ]);
    // Priced with one look, through the real create-body builder.
    expect(calls.quote.at(-1)?.inputs.looks).toEqual([{ poseId: 'a', backgroundId: 'bg-1' }]);
  });

  it('offers only counts the balance can pay for', async () => {
    const { deps } = fakeDeps({
      getBalance: async () => 10,
      quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 10 }),
    });
    const r = await atCount(deps);
    expect(listOf(r)?.rows.map((x) => x.title)).toEqual([
      '1 pose · 5 credits',
      '2 poses · 10 credits',
    ]);
  });

  it('goes to NO_CREDITS when not even one pose is affordable', async () => {
    const { deps } = fakeDeps({
      quote: async () => ({ images: 1, perImage: 5, total: 5, balance: 3 }),
    });
    const r = await atCount(deps);
    expect(r.session.state).toBe('NO_CREDITS');
  });

  it('sizes the count list by the poses the type has', async () => {
    const { deps } = fakeDeps({
      getLooks: async () => ['a', 'b', 'c', 'e', 'f'].map((i) => look(i)),
    });
    const r = await atCount(deps);
    // 5 eligible poses: the 5-pose option appears.
    expect(listOf(r)?.rows.map((x) => x.title)).toContain('5 poses · 25 credits');
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
    expect(r.messages).toHaveLength(1);
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
        { poseId: 'b', backgroundId: 'bg-1' },
        { poseId: 'c', backgroundId: 'bg-1' },
      ],
    });
  });

  it('a look removed between the count and Generate is simply not drawn', async () => {
    let current = POSES;
    const { deps, calls } = fakeDeps({ getLooks: async () => current });
    const at = await atCount(deps);
    current = POSES.filter((l) => l.id !== 'a');
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
  it('one run with exactly the drawn looks, no template mapping', async () => {
    const { deps, calls } = fakeDeps();
    const r = await generated(deps, ['c', 'a']);
    expect(r.session).toMatchObject({
      state: 'GENERATING',
      runs: [{ runId: 'run-1', images: 2 }],
    });
    expect(calls.createRun).toHaveLength(1);
    expect(calls.createRun[0].inputs).toMatchObject({
      looks: [
        { poseId: 'c', backgroundId: 'bg-1' },
        { poseId: 'a', backgroundId: 'bg-1' },
      ],
      faceId: 'face-1',
    });
    expect(calls.createRun[0].inputs).not.toHaveProperty('catalogueTemplateMappingId');
    expect(calls.createRun[0].inputs).not.toHaveProperty('lowerCatalogId');
    expect(calls.createRunKeys).toEqual(['wamid.1']);
    expect(texts(r.messages)[0]).toBe('Creating your 2 poses now. ✨');
  });

  it('draws one face and one background at random for the whole catalogue', async () => {
    const { deps, calls } = fakeDeps({
      listFaceIds: async () => ['f1', 'f2', 'f3'],
      listBackgroundIds: async () => ['b1', 'b2'],
    });
    const at = await atCount(deps);
    // The draw reverses every list: the pose picks and the face and background.
    deps.shuffle = (ids) => [...ids].reverse();
    const r = await handle(at.session, tap(at, 'count', '2'), CTX, deps);
    expect(calls.createRun[0].inputs).toMatchObject({
      faceId: 'f3',
      looks: [
        { poseId: 'c', backgroundId: 'b2' },
        { poseId: 'b', backgroundId: 'b2' },
      ],
    });
    expect(r.session).toMatchObject({ faceId: 'f3', backgroundId: 'b2' });
  });

  it('a rejected quote creates nothing and returns to the count question', async () => {
    const { AppError } = await import('../src/lib/errors');
    const { deps, calls } = fakeDeps();
    const at = await atCount(deps);
    const quote = deps.quote;
    let rejected = false;
    deps.quote = async (u, body) => {
      // Only the pre-charge quote fails; the count prompt that follows prices normally.
      if (!rejected) {
        rejected = true;
        throw new AppError('BAD_CATALOG', 400, 'not configured');
      }
      return quote(u, body);
    };
    const r = await handle(at.session, tap(at, 'count', '1'), CTX, deps);
    expect(calls.createRun).toHaveLength(0);
    expect(texts(r.messages)[0]).toBe('Not available right now. Please pick again.');
    expect(r.session).toMatchObject({ state: 'ASK_POSE_COUNT', picked: [] });
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
    expect(texts(r.messages)[0]).toBe('Not available right now. Please pick again.');
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

  it('with no default lower or shoe, draws one of each at random for the whole run', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultLowerCatalogId: null }],
      listCatalogItemIds: async (type) => (type === 'lower' ? ['l1', 'l2'] : ['s1', 's2']),
    });
    const at = await atCount(deps);
    // 'b' has a lower slot and 'd' a shoe slot; both are offered now, so 4 poses.
    expect(listOf(at)?.rows.map((x) => x.title)).toContain('3 poses · 15 credits');
    deps.shuffle = (ids) => [...ids].reverse();
    const r = await handle(at.session, tap(at, 'count', '3'), CTX, deps);
    expect(r.session).toMatchObject({ lowerCatalogId: 'l2', shoeCatalogId: 's2' });
    expect(calls.createRun[0].inputs).toMatchObject({
      lowerCatalogId: 'l2',
      shoeCatalogId: 's2',
    });
  });

  it('with no default and no items to draw, the poses that need them are not offered', async () => {
    const { deps } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultLowerCatalogId: null }],
      listCatalogItemIds: async () => [],
    });
    const at = await atCount(deps);
    // Only 'a' and 'c' remain (no lower slot, no shoe slot).
    expect(listOf(at)?.rows.map((x) => x.title)).toEqual([
      '1 pose · 5 credits',
      '2 poses · 10 credits',
    ]);
  });

  it('a type with a default shoe offers the shoe look and sends the shoe', async () => {
    const { deps, calls } = fakeDeps({
      listGarmentTypes: async () => [{ ...GT_SHIRT, defaultShoeCatalogId: 'shoe-default' }],
    });
    await generated(deps, ['d']);
    expect(calls.createRun[0].inputs.shoeCatalogId).toBe('shoe-default');
  });

  it('a lower-only pool sends the photo as the lower garment', async () => {
    const { deps, calls } = fakeDeps({
      getLooks: async () => [look('j', { hasUpper: false, hasLower: true })],
    });
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
    const ask = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
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
    const ask = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
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
    const first = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
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
    const first = await handle(list.session, tap(list, 'basket', 't:gt-shirt'), CTX, deps);
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
      runProgress: async () => ({ finished: 1, total: 2 }),
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
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      text: 'Your 2 poses are ready! 🎉\nWhat would you like to do next?',
    });
    expect(buttonTitles(r.messages.at(-1))).toEqual(['More poses', 'New catalogue', 'Menu']);
  });

  it('with several runs the closing message waits for the last one', async () => {
    const { deps } = fakeDeps();
    const one = await generated(deps, ['a', 'c']);
    // A session left generating by an earlier build can hold more than one run.
    const gen = {
      ...one.session,
      runs: [
        { runId: 'run-1', images: 1 },
        { runId: 'run-2', images: 1 },
      ],
    };
    const first = await handle(gen, finished('run-1', 1), CTX, deps);
    expect(first.messages).toEqual([]);
    expect(first.session.state).toBe('GENERATING');
    const repeat = await handle(first.session, finished('run-1', 1), CTX, deps);
    expect(repeat.messages).toEqual([]);
    const last = await handle(first.session, finished('run-2', 1), CTX, deps);
    expect(last.session.state).toBe('DELIVERED');
    expect(buttonTitles(last.messages.at(-1))).toEqual(['More poses', 'New catalogue', 'Menu']);
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
    const r = await handle(gen.session, finished('run-1', 2, ['c']), CTX, deps);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      text: "Your 1 pose is ready! 🎉\n1 couldn't be made, so 5 credits were refunded.\nWhat would you like to do next?",
    });
    expect(buttonTitles(r.messages.at(-1))).toEqual(['Retry failed', 'More poses', 'Menu']);
    const retry = await handle(r.session, tap(r, 'retry'), CTX, deps);
    expect(retry.session.state).toBe('GENERATING');
    // Retried on the same background and face as the first attempt.
    expect(calls.createRun.at(-1)?.inputs).toMatchObject({
      faceId: 'face-1',
      looks: [{ poseId: 'c', backgroundId: 'bg-1' }],
    });
  });

  it('More poses returns to the count question with the garment, type and seen looks kept', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(gen.session, finished('run-1', 2), CTX, deps);
    const r = await handle(done.session, tap(done, 'more_poses'), CTX, deps);
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      garmentType: { id: 'gt-shirt' },
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
    expect(r.messages).toHaveLength(1);
    expect(r.session.state).toBe('MAIN_MENU');
  });
});

describe('engine: review fixes', () => {
  it('a session mapped from the old flow answers an old tap with the stale text and the count list', async () => {
    const { deps } = fakeDeps();
    const base = await atCount(deps);
    const mapped = { ...base.session, nonce: 'migrated' } as Session;
    const r = await handle(mapped, { type: 'reply', id: 'n1|look|a' }, CTX, deps);
    expect(r.messages).toHaveLength(1);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(r.messages.length).toBeGreaterThan(0);
  });

  it('a first photo with no session asks the gender before any recognition', async () => {
    const { deps, calls } = fakeDeps(BASKETS);
    const r = await handle(null, photo(1), CTX, deps);
    expect(calls.recognize).toHaveLength(0);
    expect(r.session.state).toBe('ASK_GENDER');
  });

  it('a session saved mid-confirm by the kind flow is asked the gender, photo kept', async () => {
    const { deps } = fakeDeps(BASKETS);
    const at = await run(deps, [() => photo(1)]);
    const old = {
      ...at.session,
      state: 'CONFIRM_KIND',
      kind: 'Shirt',
      kindGenders: ['men'],
    } as unknown as Session;
    const r = await handle(old, { type: 'text', text: 'ok' }, CTX, deps);
    expect(r.session.state).toBe('ASK_GENDER');
    expect(r.session.garmentKey).toBe(at.session.garmentKey);
    expect((r.session as unknown as { kind?: string }).kind).toBeUndefined();
  });

  it('an invalid reply at CONFIRM_BASKET reprompts and keeps the state', async () => {
    const { deps } = fakeDeps(BASKETS);
    const at = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    const r = await handle(
      at.session,
      { type: 'reply', id: encodeReplyId(at.session.nonce, 'bogus', '') },
      CTX,
      deps,
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages.at(-1)?.kind).toBe('buttons');
    expect(r.session.state).toBe('CONFIRM_BASKET');
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

describe('engine: generating lock', () => {
  const generating = { finished: 1, total: 3 };

  it('a photo while a catalogue generates is refused and the session is left alone', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    deps.activeRun = async () => generating;
    const r = await handle(gen.session, photo(2), CTX, deps);
    expect(texts(r.messages)).toEqual([
      'Your catalogue is still generating (1 of 3 done). Please wait for it to finish.',
    ]);
    expect(r.session).toEqual(gen.session);
  });

  it('typed exit words do not leave a generating catalogue, so its closing message survives', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    deps.activeRun = async () => generating;
    for (const word of ['menu', 'cancel', 'hi', 'anything']) {
      const r = await handle(gen.session, { type: 'text', text: word }, CTX, deps);
      expect(texts(r.messages)).toEqual(['Still generating: 1 of 3 done.']);
      expect(r.session.state).toBe('GENERATING');
      expect(r.session.runs).toEqual(gen.session.runs);
    }
  });

  it('a New catalogue tap is refused from any state while generating', async () => {
    const { deps } = fakeDeps();
    const menu = await run(deps, []);
    const newTap = tap(menu, 'menu', 'new');
    deps.activeRun = async () => generating;
    const r = await handle(menu.session, newTap, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/still generating \(1 of 3 done\)/);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('is enforced with no session at all (it was lost), not just from the saved one', async () => {
    const { deps } = fakeDeps();
    deps.activeRun = async () => generating;
    const r = await handle(null, photo(1), CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/still generating/);
    expect(r.session.state).toBe('MAIN_MENU');
  });

  it('credits and help still answer while generating', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    deps.activeRun = async () => generating;
    const credits = await handle(gen.session, { type: 'text', text: 'credits' }, CTX, deps);
    expect(texts(credits.messages)[0]).toMatch(/You have 50 credits/);
    const help = await handle(gen.session, { type: 'text', text: 'help' }, CTX, deps);
    expect(texts(help.messages)[0]).toMatch(/Send a garment photo to start/);
    expect(help.session.state).toBe('GENERATING');
  });

  it('asks the database about this chat only for messages that could start something', async () => {
    const seen: string[] = [];
    const { deps } = fakeDeps({
      activeRun: async (accountId) => {
        seen.push(accountId);
        return null;
      },
    });
    const menu = await run(deps, []);
    seen.length = 0;
    await handle(menu.session, { type: 'text', text: 'hello?' }, CTX, deps);
    await handle(menu.session, { type: 'unsupportedMedia' }, CTX, deps);
    await handle(menu.session, { type: 'creditsAdded', credits: 5 }, CTX, deps);
    expect(seen).toEqual([CTX.accountId]);
  });

  it('once nothing is generating (finished, or past the cutoff) the lock is gone', async () => {
    const { deps } = fakeDeps();
    const gen = await generated(deps, ['a', 'c']);
    const done = await handle(
      gen.session,
      { type: 'runFinished', runId: 'run-1', images: 2, failedPoseIds: [] },
      CTX,
      deps,
    );
    expect(done.session.state).toBe('DELIVERED');
    const r = await handle(done.session, photo(2), CTX, deps);
    expect(r.session.state).toBe('ASK_GENDER');
    // A GENERATING session whose run was written off can still be left.
    const stale = await handle(gen.session, { type: 'text', text: 'menu' }, CTX, deps);
    expect(stale.session.state).toBe('MAIN_MENU');
  });
});

describe('engine: step lock', () => {
  it('a photo at a question step is refused, keeping everything chosen', async () => {
    const { deps } = fakeDeps();
    const at = await atCount(deps);
    const r = await handle(at.session, photo(2), CTX, deps);
    expect(texts(r.messages)[0]).toBe(
      "You're in the middle of a catalogue. Type MENU to start over.",
    );
    expect(r.session).toMatchObject({
      state: 'ASK_POSE_COUNT',
      garmentKey: at.session.garmentKey,
      garmentType: { id: 'gt-shirt' },
    });
    // The question is asked again.
    expect(listOf(r)?.rows.map((x) => x.title)).toContain('1 pose · 5 credits');
  });

  it.each([
    ['ASK_GENDER', async (d: EngineDeps) => run(d, [() => photo(1)])],
    [
      'CONFIRM_BASKET',
      async (d: EngineDeps) => run(d, [() => photo(1), (x) => tap(x, 'gender', 'women')]),
    ],
  ])('%s refuses a photo and a New catalogue tap', async (state, reach) => {
    const { deps } = fakeDeps(BASKETS);
    const at = await reach(deps);
    expect(at.session.state).toBe(state);
    // A New catalogue button from an earlier message (the menu's), still tappable.
    const menuNew = await run(deps, []);
    const stale = { type: 'reply' as const, id: tap(menuNew, 'menu', 'new').id };
    for (const ev of [photo(2), stale]) {
      const r = await handle(at.session, ev, CTX, deps);
      expect(texts(r.messages)[0]).toMatch(/in the middle of a catalogue/);
      expect(r.session.state).toBe(state);
      expect(r.session.garmentKey).toBe(at.session.garmentKey);
    }
  });

  it('typed exit words leave every question step for the menu and clear the catalogue', async () => {
    const { deps } = fakeDeps(BASKETS);
    const steps: ((d: EngineDeps) => Promise<EngineResult>)[] = [
      (d) => run(d, [() => photo(1)]),
      (d) => run(d, [() => photo(1), (x) => tap(x, 'gender', 'women')]),
      (d) => run(d, [() => photo(1), (x) => tap(x, 'gender', 'women'), (x) => tap(x, 'change')]),
      // The pose count, reached by confirming the guess.
      async (d) => {
        const guess = await run(d, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
        return handle(guess.session, tap(guess, 'confirm'), CTX, d);
      },
    ];
    for (const reach of steps) {
      for (const word of ['menu', 'cancel']) {
        const at = await reach(deps);
        const r = await handle(at.session, { type: 'text', text: word }, CTX, deps);
        expect(r.session).toMatchObject({ state: 'MAIN_MENU', photos: {}, picked: [] });
        expect(r.session.garmentKey).toBeUndefined();
      }
    }
  });

  it('the guess has an Exit button, and it leaves for the menu', async () => {
    const { deps } = fakeDeps(BASKETS);
    const at = await run(deps, [() => photo(1), (x) => tap(x, 'gender', 'women')]);
    expect(at.session.state).toBe('CONFIRM_BASKET');
    const r = await handle(at.session, tap(at, 'menu', 'menu'), CTX, deps);
    expect(r.session.state).toBe('MAIN_MENU');
    expect(r.session.garmentKey).toBeUndefined();
  });

  it('the lists carry no Back or Exit rows', async () => {
    const { deps } = fakeDeps({ ...BASKETS, listBaskets: async () => ALL_BASKETS });
    const gender = await run(deps, [() => photo(1)]);
    const alt = await run(
      deps,
      [(x) => tap(x, 'gender', 'women'), (x) => tap(x, 'change')],
      gender,
    );
    const count = await run(deps, [(x) => tap(x, 'basket', 'b:lowers')], alt);
    for (const r of [gender, alt, count]) {
      const titles = listOf(r)?.rows.map((x) => x.title) ?? [];
      expect(titles).not.toContain('Back');
      expect(titles).not.toContain('Exit');
    }
  });

  it('credits and help answer in place without leaving the step', async () => {
    const { deps } = fakeDeps();
    const at = await atCount(deps);
    const r = await handle(at.session, { type: 'text', text: 'credits' }, CTX, deps);
    expect(texts(r.messages)[0]).toMatch(/You have 50 credits/);
    expect(r.session.state).toBe('ASK_POSE_COUNT');
    expect(r.session.garmentType?.id).toBe('gt-shirt');
  });

  it('the free steps still take a photo: the menu and the photo prompt', async () => {
    const { deps } = fakeDeps();
    const menu = await run(deps, []);
    expect((await handle(menu.session, photo(1), CTX, deps)).session.state).toBe('ASK_GENDER');
    const ask = await run(deps, [(x) => tap(x, 'menu', 'new')]);
    expect((await handle(ask.session, photo(1), CTX, deps)).session.state).toBe('ASK_GENDER');
  });
});
