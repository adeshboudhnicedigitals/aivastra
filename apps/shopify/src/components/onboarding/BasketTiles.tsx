import { Icon, Text } from '@shopify/polaris';
import { ProductIcon } from '@shopify/polaris-icons';

export interface BasketTile {
  id: string;
  label: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * The baskets as a tile grid, one tile per basket: its icon (the image Aivastra
 * uploaded in the admin panel), name and short description. A single choice, so
 * each tile is a native radio input inside a label: the browser supplies the
 * arrow-key movement and the screen-reader announcement.
 */

// A visually hidden input can't show its own focus ring, so the tile draws it.
const TILE_CSS = `
.aivastra-basket-tile:has(input:focus-visible) {
  outline: 2px solid var(--p-color-border-focus);
  outline-offset: 2px;
}`;

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  border: 0,
} as const;
export function BasketTiles({
  baskets,
  value,
  disabled,
  onChange,
}: {
  baskets: BasketTile[];
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <style>{TILE_CSS}</style>
      <legend style={VISUALLY_HIDDEN}>Basket for all products</legend>
      <div
        style={{
          display: 'grid',
          // Portrait tiles: fixed-ish width so a wide window adds columns rather than
          // stretching each tile (and its 3:4 image) into a landscape.
          // auto-fit (not auto-fill) drops empty tracks, so with only a few
          // baskets the tiles themselves are centred instead of sitting to the
          // left of a centred set of invisible columns.
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 240px))',
          justifyContent: 'center',
          gap: 'var(--p-space-300)',
        }}
      >
        {baskets.map((basket) => {
          const selected = basket.id === value;
          return (
            <label
              key={basket.id}
              className="aivastra-basket-tile"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--p-space-300)',
                padding: 'var(--p-space-300)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                background: selected
                  ? 'var(--p-color-bg-surface-selected)'
                  : 'var(--p-color-bg-surface)',
                // 2px on both states so selecting a tile does not shift the layout.
                border: `2px solid ${
                  selected ? 'var(--p-color-border-emphasis)' : 'var(--p-color-border)'
                }`,
                borderRadius: 'var(--p-border-radius-300)',
              }}
            >
              <input
                type="radio"
                name="basket-for-all"
                value={basket.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(basket.id)}
                style={VISUALLY_HIDDEN}
              />
              <div
                style={{
                  width: '100%',
                  aspectRatio: '3 / 4',
                  borderRadius: 'var(--p-border-radius-200)',
                  overflow: 'hidden',
                  background: 'var(--p-color-bg-surface-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {basket.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: Polaris has no plain image component
                  <img
                    src={basket.imageUrl}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                ) : (
                  <Icon source={ProductIcon} tone="subdued" />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <Text as="span" fontWeight="semibold">
                  {basket.label}
                </Text>
                {basket.description && (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {basket.description}
                  </Text>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
