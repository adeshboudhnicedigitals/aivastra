import { describe, expect, it } from 'vitest';
import {
  buildAppBlockDeepLink,
  buildThemeEditorDeepLink,
  findThemeBlockPresent,
} from './onboarding.routes.js';

describe('findThemeBlockPresent', () => {
  const wrap = (blocks: Record<string, unknown>) =>
    JSON.stringify({ sections: { main: { type: 'main-product', blocks } } });

  it('finds the button block in a product template section', () => {
    expect(
      findThemeBlockPresent(
        wrap({ b1: { type: 'shopify://apps/aivastra/blocks/tryon-button-block/uuid-1' } }),
      ),
    ).toBe(true);
  });
  it('ignores a disabled block', () => {
    expect(
      findThemeBlockPresent(
        wrap({
          b1: { type: 'shopify://apps/aivastra/blocks/tryon-button-block/u', disabled: true },
        }),
      ),
    ).toBe(false);
  });
  it('does not mistake the embed for the block', () => {
    expect(
      findThemeBlockPresent(
        wrap({ b1: { type: 'shopify://apps/aivastra/blocks/tryon-button/u' } }),
      ),
    ).toBe(false);
  });
  it('survives a leading comment, junk, null blocks and a missing sections key', () => {
    expect(
      findThemeBlockPresent(
        `/* auto */\n${wrap({ b1: { type: 'shopify://apps/x/blocks/tryon-button-block/u' } })}`,
      ),
    ).toBe(true);
    expect(findThemeBlockPresent('not json')).toBe(false);
    expect(findThemeBlockPresent('{}')).toBe(false);
    expect(findThemeBlockPresent(wrap({ b1: null }))).toBe(false);
  });
});

describe('buildThemeEditorDeepLink', () => {
  it('opens the App embeds panel without switching the tryon embed on', () => {
    const url = buildThemeEditorDeepLink('s.myshopify.com');
    expect(url).toBe(
      'https://s.myshopify.com/admin/themes/current/editor?context=apps&template=product',
    );
    expect(url).not.toContain('activateAppId');
  });

  it('no longer stages an app block', () => {
    const url = buildThemeEditorDeepLink('s.myshopify.com');
    expect(url).not.toContain('addAppBlockId');
    expect(url).not.toContain('target=');
  });
});

describe('buildAppBlockDeepLink', () => {
  it('stages the tryon app block on the product template', () => {
    expect(buildAppBlockDeepLink('s.myshopify.com', 'apikey123')).toBe(
      'https://s.myshopify.com/admin/themes/current/editor' +
        '?template=product&addAppBlockId=apikey123/tryon-button-block&target=mainSection',
    );
  });
});
