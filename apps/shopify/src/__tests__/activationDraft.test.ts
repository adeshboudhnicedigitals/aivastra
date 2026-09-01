import { describe, expect, it } from 'vitest';
import { type DraftList, diffActions, emptyDraftList, mergeById } from '../lib/activationDraft';

interface Item {
  id: number;
  title: string;
}

describe('mergeById', () => {
  it('returns the base list untouched when nothing is staged', () => {
    const base: Item[] = [{ id: 1, title: 'A' }];
    expect(mergeById(base, (i) => i.id, emptyDraftList<Item>())).toEqual(base);
  });

  it('drops a base item staged for removal', () => {
    const base: Item[] = [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ];
    const draft: DraftList<Item> = emptyDraftList();
    draft.actions.set(1, 'remove');

    expect(mergeById(base, (i) => i.id, draft)).toEqual([{ id: 2, title: 'B' }]);
  });

  it('synthesizes a row for a staged addition not yet on the base list', () => {
    const base: Item[] = [{ id: 1, title: 'A' }];
    const draft: DraftList<Item> = emptyDraftList();
    draft.actions.set(2, 'add');
    draft.meta.set(2, { id: 2, title: 'New' });

    expect(mergeById(base, (i) => i.id, draft)).toEqual([
      { id: 1, title: 'A' },
      { id: 2, title: 'New' },
    ]);
  });

  it('does not duplicate a row when an already-present item is re-staged as add', () => {
    // e.g. a merchant removes an item then re-picks it before saving — the
    // 'remove' action gets overwritten with 'add', not appended alongside it.
    const base: Item[] = [{ id: 1, title: 'A' }];
    const draft: DraftList<Item> = emptyDraftList();
    draft.actions.set(1, 'add');
    draft.meta.set(1, { id: 1, title: 'A' });

    expect(mergeById(base, (i) => i.id, draft)).toEqual(base);
  });

  it('cancels out an add-then-remove of an item never on the base list, with no row and no leftover state issue', () => {
    const base: Item[] = [];
    const draft: DraftList<Item> = emptyDraftList();
    draft.actions.set(9, 'add');
    draft.meta.set(9, { id: 9, title: 'Ghost' });
    // Merchant changes their mind before saving.
    draft.actions.set(9, 'remove');

    expect(mergeById(base, (i) => i.id, draft)).toEqual([]);
  });
});

describe('diffActions', () => {
  it('splits staged actions into add/remove id lists', () => {
    const actions = new Map<number, 'add' | 'remove'>([
      [1, 'add'],
      [2, 'remove'],
      [3, 'add'],
    ]);
    expect(diffActions(actions)).toEqual({ toAdd: [1, 3], toRemove: [2] });
  });

  it('returns empty lists for an untouched draft', () => {
    expect(diffActions(emptyDraftList().actions)).toEqual({ toAdd: [], toRemove: [] });
  });

  it('reflects only the latest action when an id was toggled back and forth', () => {
    const actions = new Map<number, 'add' | 'remove'>();
    actions.set(5, 'add');
    actions.set(5, 'remove');
    expect(diffActions(actions)).toEqual({ toAdd: [], toRemove: [5] });
  });
});
