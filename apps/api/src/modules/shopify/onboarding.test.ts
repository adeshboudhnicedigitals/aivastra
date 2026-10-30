import { describe, expect, it } from 'vitest';
import { buildAppBlockDeepLink, buildThemeEditorDeepLink } from './onboarding.routes.js';

describe('buildThemeEditorDeepLink', () => {
  it('opens the App embeds panel with the tryon embed switched on', () => {
    const url = buildThemeEditorDeepLink('s.myshopify.com', 'apikey123');
    expect(url).toBe(
      'https://s.myshopify.com/admin/themes/current/editor' +
        '?context=apps&template=product&activateAppId=apikey123/tryon-button',
    );
  });

  it('no longer stages an app block', () => {
    const url = buildThemeEditorDeepLink('s.myshopify.com', 'k');
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
