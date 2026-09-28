import { describe, expect, it } from 'vitest';
import { buildThemeEditorDeepLink } from './onboarding.routes.js';

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
