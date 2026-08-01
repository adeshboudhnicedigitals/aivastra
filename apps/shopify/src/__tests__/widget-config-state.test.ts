import { describe, expect, it } from 'vitest';
import { widgetConfigsEqual } from '../lib/widgetDefaults';

describe('widget config dirty comparison', () => {
  it('treats an edited field restored to blank as unchanged', () => {
    expect(
      widgetConfigsEqual(
        {},
        {
          theme: { accentColor: null },
          copy: { heading: '', subheading: '   ' },
          behavior: { addToCartLabel: null },
        },
      ),
    ).toBe(true);
  });

  it('ignores text whitespace and object insertion order', () => {
    expect(
      widgetConfigsEqual(
        { copy: { heading: 'Fit Check', subheading: 'Looks good' } },
        { copy: { subheading: ' Looks good ', heading: ' Fit Check ' } },
      ),
    ).toBe(true);
  });

  it('retains meaningful boolean changes', () => {
    expect(widgetConfigsEqual({}, { behavior: { share: false } })).toBe(false);
  });
});
