import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { createWhatsappClient, type WhatsappClient } from './channels/whatsapp/client.js';
import type { ParsedInbound } from './channels/whatsapp/parse.js';
import { deliverPendingForAccount, deliveryTick } from './delivery.js';
import { processInbound } from './inbound.js';
import { INBOUND_STREAM } from './webhook.routes.js';

const GROUP = 'messaging-inbound-cg';
const DELIVERY_INTERVAL_MS = 5_000;
// D50: different senders run in parallel, up to this many messages in flight.
const MAX_IN_FLIGHT = 20;
type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

export function createAppWhatsappClient(app: FastifyInstance): WhatsappClient | null {
  const { WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_VERSION } = app.env;
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) return null;
  return createWhatsappClient({
    phoneNumberId: WHATSAPP_PHONE_NUMBER_ID,
    accessToken: WHATSAPP_ACCESS_TOKEN,
    graphVersion: WHATSAPP_GRAPH_VERSION,
  });
}

/**
 * One sender at a time across replicas: a per-sender lock, waited on briefly.
 * Two of one seller's messages handled at once would overwrite each other's
 * session (plan 2, conversation.ts). Within one process the per-sender chain
 * below already orders them; the lock covers a second api replica. The wait
 * budget (15 s) outlasts the photo step's recognition wait (RECOGNITION_BUDGET_MS, 12 s):
 * the seller's next message queues behind it instead of failing.
 */
async function withSenderLock(app: FastifyInstance, from: string, fn: () => Promise<void>) {
  const key = `msg:lock:whatsapp:${from}`;
  for (let i = 0; i < 75; i++) {
    if ((await app.redis.set(key, '1', 'EX', 60, 'NX')) === 'OK') {
      try {
        return await fn();
      } finally {
        await app.redis.del(key);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('sender lock timeout');
}

/**
 * Same consumer-group idiom as shopify/sync-consumer.ts, but not one message at
 * a time (D50): each sender's messages are chained in arrival order, and
 * different senders run in parallel. The photo step can wait up to 12 s for
 * garment recognition; with a single sequential loop every other seller would
 * wait behind it.
 */
export function startWhatsappInboundConsumer(app: FastifyInstance, wa: WhatsappClient): () => void {
  const consumer = `${hostname()}-${process.pid}`;
  let running = true;
  let inFlight = 0;
  // Tail of each sender's chain; removed once it is the last link and settles.
  const chains = new Map<string, Promise<void>>();

  async function handleOne(id: string, raw: string | undefined): Promise<void> {
    try {
      const m = JSON.parse(raw ?? '') as ParsedInbound;
      await withSenderLock(app, m.from, () => processInbound(app, wa, m, deliverPendingForAccount));
    } catch (err) {
      // Acked anyway: retrying a message that throws would loop forever.
      // The seller can simply send it again.
      app.log.error({ err, streamId: id }, 'whatsapp inbound message failed');
    }
    // app.redis, not redisBlocking: that connection is parked in XREADGROUP BLOCK.
    await app.redis.xack(INBOUND_STREAM, GROUP, id);
  }

  function enqueue(id: string, raw: string | undefined) {
    let from = id; // unparseable: its own chain, so it cannot hold anyone up
    try {
      from = (JSON.parse(raw ?? '') as ParsedInbound).from ?? id;
    } catch {
      /* handled (logged and acked) in handleOne */
    }
    inFlight++;
    const next = (chains.get(from) ?? Promise.resolve())
      .then(() => handleOne(id, raw))
      .catch((err) => app.log.error({ err, streamId: id }, 'whatsapp inbound chain error'))
      .finally(() => {
        inFlight--;
        if (chains.get(from) === next) chains.delete(from);
      });
    chains.set(from, next);
  }

  async function loop() {
    try {
      await app.redisBlocking.xgroup('CREATE', INBOUND_STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
    }
    while (running) {
      try {
        const room = MAX_IN_FLIGHT - inFlight;
        if (room <= 0) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const result = (await app.redisBlocking.xreadgroup(
          'GROUP',
          GROUP,
          consumer,
          'COUNT',
          String(room),
          'BLOCK',
          '5000',
          'STREAMS',
          INBOUND_STREAM,
          '>',
        )) as XReadGroupResult;
        for (const [id, fields] of result?.[0]?.[1] ?? []) {
          enqueue(id, fields[fields.indexOf('msg') + 1]);
        }
      } catch (err) {
        app.log.error({ err }, 'whatsapp inbound loop error — resuming');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  loop().catch((err) => app.log.error({ err }, 'whatsapp inbound loop crashed'));
  return () => {
    running = false;
  };
}

/** setInterval + re-entrancy guard, like every other api background loop. */
export function startWhatsappDelivery(app: FastifyInstance, wa: WhatsappClient): () => void {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await deliveryTick(app, wa);
    } catch (err) {
      app.log.error({ err }, 'whatsapp delivery tick failed');
    } finally {
      busy = false;
    }
  }, DELIVERY_INTERVAL_MS);
  return () => clearInterval(timer);
}
