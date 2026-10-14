import { COPY } from '../../engine/copy.js';
import type { OutboundMessage } from '../../engine/types.js';

// Limits from Meta's docs (spec section 9; carousel confirmed 2026-10-13, the
// rest re-checked by the plan 3 spike). Clipping here keeps a long admin label
// from turning a whole message into a 400.
const BODY_MAX = 1024;
const BUTTON_TITLE_MAX = 20;
const ROW_TITLE_MAX = 24;
const ROW_DESC_MAX = 72;
const CARD_BODY_MAX = 160;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function replyButtons(text: string, buttons: { id: string; title: string }[]) {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(text, BODY_MAX) },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_MAX) },
        })),
      },
    },
  };
}

export function renderMessage(m: OutboundMessage): Record<string, unknown>[] {
  switch (m.kind) {
    case 'text':
      return [{ type: 'text', text: { body: m.text, preview_url: true } }];

    case 'buttons':
      return [replyButtons(m.text, m.buttons)];

    case 'list':
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: clip(m.text, BODY_MAX) },
            action: {
              button: clip(m.buttonLabel, BUTTON_TITLE_MAX),
              sections: [
                {
                  title: 'Options',
                  rows: m.rows.slice(0, 10).map((r) => ({
                    id: r.id,
                    title: clip(r.title, ROW_TITLE_MAX),
                    ...(r.description ? { description: clip(r.description, ROW_DESC_MAX) } : {}),
                  })),
                },
              ],
            },
          },
        },
      ];

    case 'cards': {
      if (m.cards.length === 0) return [];
      // A carousel needs 2–10 cards; one option becomes a single button message
      // with the image as its header. Not an image followed by a button: those
      // are two messages, and WhatsApp delivered the button first (local run,
      // 2026-10-13), so the seller saw Select before the pose.
      if (m.cards.length === 1) {
        const [c] = m.cards;
        const msg = replyButtons(`${c.title}\n\n${m.text}`, [{ id: c.id, title: COPY.btnSelect }]);
        return [
          {
            ...msg,
            interactive: {
              header: { type: 'image', image: { link: c.imageUrl } },
              ...msg.interactive,
            },
          },
        ];
      }
      return [
        {
          type: 'interactive',
          interactive: {
            type: 'carousel',
            body: { text: clip(m.text, BODY_MAX) },
            action: {
              // Every card has exactly one quick reply: Meta requires the same
              // button types and counts on all cards. Every card also carries
              // type 'cta_url': Meta rejects the carousel without the
              // card-level type (HTTP 400 missing 'type'); 'cta_url' is the
              // accepted variant with quick_reply buttons (spike 2b, 2026-10-13).
              cards: m.cards.slice(0, 10).map((c, i) => ({
                card_index: i,
                type: 'cta_url',
                header: { type: 'image', image: { link: c.imageUrl } },
                body: { text: clip(c.title, CARD_BODY_MAX) },
                action: {
                  buttons: [
                    { type: 'quick_reply', quick_reply: { id: c.id, title: COPY.btnSelect } },
                  ],
                },
              })),
            },
          },
        },
      ];
    }
  }
}
