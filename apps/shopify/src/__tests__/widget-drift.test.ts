import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WIDGET_BEHAVIOR_DEFAULTS, WIDGET_COPY_DEFAULTS } from '../lib/widgetDefaults';

const here = dirname(fileURLToPath(import.meta.url));

const liquid = readFileSync(
  resolve(
    here,
    '../../../shopify-extension/extensions/tryon-theme-extension/blocks/tryon-button.liquid',
  ),
  'utf8',
);
const preview = readFileSync(resolve(here, '../components/WidgetPreview.tsx'), 'utf8');

function widgetClasses(source: string): Set<string> {
  return new Set(source.match(/aivastra-tryon__[a-z0-9-]+/g) ?? []);
}

describe('WidgetPreview mirrors the Liquid markup', () => {
  it('uses only classes that exist in tryon-button.liquid', () => {
    const inLiquid = widgetClasses(liquid);
    const missing = [...widgetClasses(preview)].filter((c) => !inLiquid.has(c));
    // A one-directional check on purpose: adding a class to the Liquid is fine
    // (the preview does not show every state), but a class the preview uses and
    // the Liquid does not means the preview has drifted or the Liquid renamed
    // something out from under it.
    expect(missing).toEqual([]);
  });
});

describe('default copy matches the Liquid fallbacks', () => {
  const liquidDefaults = new Set(
    [...liquid.matchAll(/\|\s*default:\s*'([^']*)'/g)].map((m) => m[1]),
  );

  it.each(
    Object.entries(WIDGET_COPY_DEFAULTS),
  )('copy default %s is the Liquid fallback', (_key, value) => {
    expect([...liquidDefaults]).toContain(value);
  });

  it.each(
    Object.entries(WIDGET_BEHAVIOR_DEFAULTS),
  )('behavior default %s is the Liquid fallback', (_key, value) => {
    expect([...liquidDefaults]).toContain(value);
  });

  it('no default contains a single quote, which the Liquid parser cannot express', () => {
    const all = [
      ...Object.values(WIDGET_COPY_DEFAULTS),
      ...Object.values(WIDGET_BEHAVIOR_DEFAULTS),
    ];
    expect(all.filter((v) => v.includes("'"))).toEqual([]);
  });
});
