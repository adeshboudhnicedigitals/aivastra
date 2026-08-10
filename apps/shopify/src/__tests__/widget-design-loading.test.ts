import { AppProvider } from '@shopify/polaris';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WidgetDesignPage from '../pages/WidgetDesignPage';

describe('widget design initialization', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disables the form while the stored config is loading', () => {
    vi.stubGlobal('window', {});

    const html = renderToStaticMarkup(
      createElement(AppProvider, { i18n: {} }, createElement(WidgetDesignPage)),
    );

    expect(html).toContain('<fieldset disabled=""');
  });
});
