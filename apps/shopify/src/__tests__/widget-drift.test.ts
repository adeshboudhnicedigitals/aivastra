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
  return new Set(
    [...source.matchAll(/(?:^|[\s"'`])(aivastra-tryon__[^\s"'`]+)/g)].map((match) => match[1]),
  );
}

function hasLiquidDefault(
  source: string,
  section: 'copy' | 'behavior',
  key: string,
  value: string,
): boolean {
  const defaultsByKey = new Map<string, string[]>();
  const matches = source.matchAll(
    /\bcfg\.(copy|behavior)\.([A-Za-z][A-Za-z0-9]*)\s*\|\s*default:\s*'([^']*)'/g,
  );

  for (const [, matchedSection, matchedKey, matchedValue] of matches) {
    const configKey = `${matchedSection}.${matchedKey}`;
    const values = defaultsByKey.get(configKey) ?? [];
    values.push(matchedValue);
    defaultsByKey.set(configKey, values);
  }

  const defaults = defaultsByKey.get(`${section}.${key}`);
  return defaults?.every((candidate) => candidate === value) ?? false;
}

describe('drift guard parser regressions', () => {
  it('rejects copy defaults swapped between keys', () => {
    const swapped = `
      {{ cfg.copy.heading | default: 'Subheading copy' }}
      {{ cfg.copy.subheading | default: 'Heading copy' }}
    `;

    expect(hasLiquidDefault(swapped, 'copy', 'heading', 'Heading copy')).toBe(false);
    expect(hasLiquidDefault(swapped, 'copy', 'subheading', 'Subheading copy')).toBe(false);
  });

  it('rejects a correct default attached to the wrong config key', () => {
    const wrongKey = `{{ cfg.copy.subheading | default: 'Try It On' }}`;

    expect(hasLiquidDefault(wrongKey, 'copy', 'heading', 'Try It On')).toBe(false);
  });

  it.each([
    ['uppercase', 'aivastra-tryon__Heading'],
    ['underscore suffix', 'aivastra-tryon__heading_extra'],
    ['camel-case suffix', 'aivastra-tryon__headingTypo'],
  ])('extracts the full %s malformed class token', (_case, className) => {
    expect([...widgetClasses(`className="${className}"`)]).toEqual([className]);
  });

  it('requires a token boundary before the widget class prefix', () => {
    expect([...widgetClasses('className="prefixaivastra-tryon__heading"')]).toEqual([]);
  });
});

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
  it.each(
    Object.entries(WIDGET_COPY_DEFAULTS),
  )('copy default %s is the Liquid fallback', (key, value) => {
    expect(hasLiquidDefault(liquid, 'copy', key, value)).toBe(true);
  });

  it.each(
    Object.entries(WIDGET_BEHAVIOR_DEFAULTS),
  )('behavior default %s is the Liquid fallback', (key, value) => {
    expect(hasLiquidDefault(liquid, 'behavior', key, value)).toBe(true);
  });

  it('no default contains a single quote, which the Liquid parser cannot express', () => {
    const all = [
      ...Object.values(WIDGET_COPY_DEFAULTS),
      ...Object.values(WIDGET_BEHAVIOR_DEFAULTS),
    ];
    expect(all.filter((v) => v.includes("'"))).toEqual([]);
  });
});
