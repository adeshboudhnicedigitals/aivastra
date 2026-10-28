import type { FastifyInstance } from 'fastify';
import {
  META_ERROR_OUTSIDE_WINDOW,
  MetaApiError,
  type WhatsappClient,
} from './channels/whatsapp/client.js';
import { renderMessage } from './channels/whatsapp/render.js';
import type { OutboundMessage } from './engine/types.js';
import { traceOutbound } from './trace.js';

// D39: free-form sends stop 10 minutes before Meta's 24-hour line, so a send in
// flight never crosses it.
const WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

export function windowOpen(lastInboundAt: Date | null, now = new Date()): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

/**
 * Renders and sends in order. Stops at the first failure: later messages
 * usually depend on earlier ones (a "More" button after a carousel). A send
 * outside the window is logged, not thrown — the conversation is still saved,
 * and the seller's next message reopens the window.
 */
export async function sendMessages(
  app: FastifyInstance,
  wa: WhatsappClient,
  to: string,
  messages: OutboundMessage[],
): Promise<void> {
  for (const [i, m] of messages.entries()) {
    try {
      for (const payload of renderMessage(m)) await wa.send(to, payload);
    } catch (err) {
      if (err instanceof MetaApiError && err.code === META_ERROR_OUTSIDE_WINDOW) {
        app.log.warn({ code: err.code }, 'whatsapp send outside the 24h window — skipped');
        for (const rest of messages.slice(i)) await traceOutbound(app, to, rest, 'skipped');
        return;
      }
      await traceOutbound(app, to, m, 'failed', err instanceof Error ? err.message : String(err));
      throw err;
    }
    await traceOutbound(app, to, m, 'sent');
  }
}
