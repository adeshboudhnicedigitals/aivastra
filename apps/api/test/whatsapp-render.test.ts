import { describe, expect, it } from 'vitest';
import { renderMessage } from '../src/modules/messaging/channels/whatsapp/render';

describe('renderMessage', () => {
  it('text → text with link previews', () => {
    expect(renderMessage({ kind: 'text', text: 'hi https://x' })).toEqual([
      { type: 'text', text: { body: 'hi https://x', preview_url: true } },
    ]);
  });

  it('buttons → reply buttons, max 3, titles clipped to 20', () => {
    const [p] = renderMessage({
      kind: 'buttons',
      text: 'Pick',
      buttons: [
        { id: 'a', title: 'A very long button title indeed' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' },
        { id: 'd', title: 'D' },
      ],
    });
    expect(p).toEqual({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Pick' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'a', title: 'A very long button t' } },
            { type: 'reply', reply: { id: 'b', title: 'B' } },
            { type: 'reply', reply: { id: 'c', title: 'C' } },
          ],
        },
      },
    });
  });

  it('list → one section, max 10 rows, titles clipped to 24', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      title: `Row number ${i} with a long tail`,
    }));
    const [p] = renderMessage({ kind: 'list', text: 'Choose one', buttonLabel: 'Choose', rows });
    const action = (
      p as { interactive: { action: { button: string; sections: { rows: unknown[] }[] } } }
    ).interactive.action;
    expect(action.button).toBe('Choose');
    expect(action.sections[0].rows).toHaveLength(10);
    expect(action.sections[0].rows[0]).toEqual({ id: 'r0', title: 'Row number 0 with a long' });
  });

  it('2+ cards → one carousel with a Select quick reply per card', () => {
    const [p] = renderMessage({
      kind: 'cards',
      text: 'Tap 2 poses. Generation starts after the last one.',
      cards: [
        { id: 'n|look|1', imageUrl: 'https://i/1.jpg', title: 'Pose 1' },
        { id: 'n|look|2', imageUrl: 'https://i/2.jpg', title: 'Pose 2' },
      ],
    });
    expect(p).toEqual({
      type: 'interactive',
      interactive: {
        type: 'carousel',
        body: { text: 'Tap 2 poses. Generation starts after the last one.' },
        action: {
          cards: [
            {
              card_index: 0,
              type: 'cta_url',
              header: { type: 'image', image: { link: 'https://i/1.jpg' } },
              body: { text: 'Pose 1' },
              action: {
                buttons: [
                  { type: 'quick_reply', quick_reply: { id: 'n|look|1', title: 'Select' } },
                ],
              },
            },
            {
              card_index: 1,
              type: 'cta_url',
              header: { type: 'image', image: { link: 'https://i/2.jpg' } },
              body: { text: 'Pose 2' },
              action: {
                buttons: [
                  { type: 'quick_reply', quick_reply: { id: 'n|look|2', title: 'Select' } },
                ],
              },
            },
          ],
        },
      },
    });
  });

  it('1 card → an image then a Select button (carousels need at least 2)', () => {
    const out = renderMessage({
      kind: 'cards',
      text: 'Tap 2 poses. Generation starts after the last one.',
      cards: [{ id: 'n|look|1', imageUrl: 'https://i/1.jpg', title: 'Pose 1' }],
    });
    expect(out).toEqual([
      { type: 'image', image: { link: 'https://i/1.jpg', caption: 'Pose 1' } },
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: 'Tap 2 poses. Generation starts after the last one.' },
          action: { buttons: [{ type: 'reply', reply: { id: 'n|look|1', title: 'Select' } }] },
        },
      },
    ]);
  });

  it('0 cards renders nothing', () => {
    expect(renderMessage({ kind: 'cards', text: 'x', cards: [] })).toEqual([]);
  });
});
