import type { ShopifyMe } from '../types';

/**
 * A store that passed onboarding while the storefront entry point was the app
 * embed's button: it has `themeBlockConfirmed` but no storefront has ever
 * rendered the button *block*. Since the embed became a corner icon, such a
 * store has no Try It On button until the merchant adds the block, so the
 * Dashboard says so. Clears on its own the first time the block renders (the
 * widget's signed ping sets `themeButtonBlockSeen`).
 */
export function needsButtonBlock(me: ShopifyMe): boolean {
  const { themeBlockConfirmed, themeButtonBlockSeen } = me.store.settings;
  return (themeBlockConfirmed ?? false) && !(themeButtonBlockSeen ?? false);
}
