import { describe, expect, it } from 'vitest';
import {
  createWidgetConfigPatch,
  rebaseWidgetConfigAfterSave,
  widgetConfigsEqual,
} from '../lib/widgetDefaults';

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

describe('widget config PATCH state', () => {
  it('submits only edited fields so another browser tab is not overwritten', () => {
    const saved = {
      theme: { accentColor: '#123456' },
      copy: { heading: 'Original', subheading: 'Keep me' },
      behavior: { addToCart: false },
    };
    const draft = {
      ...saved,
      copy: { ...saved.copy, heading: 'Edited' },
    };

    expect(createWidgetConfigPatch(draft, saved)).toEqual({ copy: { heading: 'Edited' } });
  });

  it('sends null when blank text clears a saved override', () => {
    expect(
      createWidgetConfigPatch(
        { copy: { heading: '   ' } },
        { copy: { heading: 'Custom heading' } },
      ),
    ).toEqual({ copy: { heading: null } });
  });

  it('includes both boolean changes when both defaults are disabled', () => {
    expect(createWidgetConfigPatch({ behavior: { addToCart: false, share: false } }, {})).toEqual({
      behavior: { addToCart: false, share: false },
    });
  });

  it('rebases edits made during a save onto the response without losing remote fields', () => {
    const submitted = { copy: { heading: 'Submitted', subheading: 'Before' } };
    const current = { copy: { heading: 'Submitted', subheading: 'Edited while saving' } };
    const response = {
      theme: { accentColor: '#abcdef' },
      copy: { heading: 'Submitted', subheading: 'Before' },
    };

    expect(rebaseWidgetConfigAfterSave(current, submitted, response)).toEqual({
      theme: { accentColor: '#abcdef' },
      copy: { heading: 'Submitted', subheading: 'Edited while saving' },
    });
  });

  it('does not overwrite a discard made while a save is pending', () => {
    const submitted = {
      copy: { heading: 'Submitted' },
      behavior: { share: false },
    };
    const discarded = {
      copy: { heading: 'Original' },
      behavior: { share: true },
    };

    expect(rebaseWidgetConfigAfterSave(discarded, submitted, submitted)).toEqual(discarded);
  });
});
