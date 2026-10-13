import { describe, expect, it } from 'vitest';
import { handle } from '../src/modules/messaging/engine/engine';
import { decodeReplyId } from '../src/modules/messaging/engine/reply-id';
import type {
  EngineDeps,
  EngineResult,
  InboundEvent,
  OutboundMessage,
} from '../src/modules/messaging/engine/types';
import { CTX, fakeDeps, GT_SHIRT } from './helpers/engine-fakes';

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
