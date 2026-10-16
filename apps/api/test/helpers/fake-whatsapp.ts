import type { WhatsappClient } from '../../src/modules/messaging/channels/whatsapp/client';

export function fakeWhatsapp(media: Record<string, { bytes: Buffer; mimeType: string }> = {}) {
  const sent: { to: string; payload: Record<string, unknown> }[] = [];
  const uploads: { bytes: Buffer; mimeType: string }[] = [];
  const client: WhatsappClient = {
    async send(to, payload) {
      sent.push({ to, payload });
      return { messageId: `out.${sent.length}` };
    },
    async uploadMedia(bytes, mimeType) {
      uploads.push({ bytes, mimeType });
      return `media.${uploads.length}`;
    },
    // maxBytes is part of the real signature; the fake's media is fixed, so it
    // accepts and ignores it.
    async downloadMedia(id, _maxBytes) {
      const m = media[id];
      if (!m) throw new Error(`no fake media ${id}`);
      return m;
    },
  };
  // Every text body sent, in order — the easiest thing to assert on.
  const texts = () =>
    sent.map((s) => {
      const p = s.payload as { text?: { body: string }; interactive?: { body?: { text: string } } };
      return p.text?.body ?? p.interactive?.body?.text ?? '';
    });
  return { client, sent, uploads, texts };
}
