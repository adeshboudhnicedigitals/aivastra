/**
 * Draft staging for the Manage page's Save-on-demand model. Nothing here
 * calls the API — every Add/Remove click just records intent via these
 * helpers, and the actual PATCH/POST/DELETE calls only fire from
 * ManagePage's saveChanges, when the merchant clicks Save.
 */

export type PendingAction = 'add' | 'remove';

/**
 * Staged, unsaved changes to one set (enabled collections, excluded products,
 * etc). `actions` holds only ids the merchant has touched this session — the
 * value is always the LATEST action clicked for that id, so clicking Add then
 * Remove on the same id before saving just overwrites the entry rather than
 * queuing two calls. `meta` caches enough of the item to render a synthesized
 * row for a pending addition that isn't on the currently-loaded page of the
 * real (server) list.
 *
 * Deliberately doesn't track "was this id originally present" — mergeById and
 * diffActions both derive that from the base list already, and inferring it
 * once here would need to survive pagination too (individual products load
 * one page at a time), which a plain action-per-id map avoids entirely.
 */
export interface DraftList<T> {
  actions: Map<number, PendingAction>;
  meta: Map<number, T>;
}

export function emptyDraftList<T>(): DraftList<T> {
  return { actions: new Map(), meta: new Map() };
}

/** Displayed list = base rows minus anything staged for removal, plus a
 *  synthesized row for anything staged for addition that isn't already in
 *  base (avoids a duplicate row if an item is added, removed, then re-added
 *  before ever being saved). */
export function mergeById<T>(base: T[], idOf: (item: T) => number, draft: DraftList<T>): T[] {
  const baseIds = new Set(base.map(idOf));
  const kept = base.filter((item) => draft.actions.get(idOf(item)) !== 'remove');
  const added: T[] = [];
  for (const [id, action] of draft.actions) {
    if (action === 'add' && !baseIds.has(id)) {
      const meta = draft.meta.get(id);
      if (meta) added.push(meta);
    }
  }
  return [...kept, ...added];
}

/** ids to actually POST/PATCH/DELETE for. Safe to call even for an id whose
 *  staged action nets to nothing real (e.g. added then removed before ever
 *  being saved) — the API calls this drives (POST with onConflictDoNothing,
 *  a DELETE matching zero rows, a PATCH toggling a boolean back to what it
 *  already was) are all no-ops in that case, so no base-membership check is
 *  needed here. */
export function diffActions(actions: Map<number, PendingAction>): {
  toAdd: number[];
  toRemove: number[];
} {
  const toAdd: number[] = [];
  const toRemove: number[] = [];
  for (const [id, action] of actions) {
    (action === 'add' ? toAdd : toRemove).push(id);
  }
  return { toAdd, toRemove };
}
