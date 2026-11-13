import { hostname } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { ParsedInbound } from '../messaging/channels/whatsapp/parse.js';
import { channelClient, channelForMerchant } from './channel.js';
import { CRM_INBOUND_STREAM, processCrmInbound } from './inbound.js';

const GROUP = 'crm-inbound-cg';
type XReadGroupResult = Array<[string, Array<[string, string[]]>]> | null;

/** Handles one stream entry. Exported so a test can drive it without the loop. */
export async function handleCrmEntry(app: FastifyInstance, fields: string[]): Promise<void> {
  const get = (k: string) => fields[fields.indexOf(k) + 1];
  const merchantId = get('merchantId');
  const raw = get('msg');
  if (!merchantId || !raw) return;
  const channel = await channelForMerchant(app.db, merchantId);
  // Disconnected since the message arrived: nothing to reply from.
  if (!channel) return;
  await processCrmInbound(
    app,
    channelClient(app, channel),
    channel,
    JSON.parse(raw) as ParsedInbound,
  );
}

/**
 * Call once after `app.listen(...)`. Shopper traffic per brand is low, so one sequential
 * consumer per process; the consumer group spreads entries across replicas. A failed message
 * is logged and acked, never retried in a loop at a shopper.
 */
export function startCrmInboundConsumer(app: FastifyInstance): () => void {
  let stopped = false;
  const consumer = `${hostname()}-${process.pid}`;
  // Its own connection: XREADGROUP BLOCK parks a connection, and app.redisBlocking is already
  // parked by the seller lane's consumer. app.redis stays free for everything else.
  const blocking = app.redis.duplicate();
  const loop = async () => {
    try {
      await app.redis.xgroup('CREATE', CRM_INBOUND_STREAM, GROUP, '$', 'MKSTREAM');
    } catch (err) {
      if (!String(err).includes('BUSYGROUP'))
        app.log.error({ err }, 'crm inbound: group create failed');
    }
    // '0' first: entries this consumer took before a crash, then new ones ('>').
    let cursor = '0';
    while (!stopped) {
      try {
        const res = (await blocking.xreadgroup(
          'GROUP',
          GROUP,
          consumer,
          'COUNT',
          10,
          'BLOCK',
          5000,
          'STREAMS',
          CRM_INBOUND_STREAM,
          cursor,
        )) as XReadGroupResult;
        const entries = res?.[0]?.[1] ?? [];
        if (cursor === '0' && entries.length === 0) cursor = '>';
        for (const [id, fields] of entries) {
          try {
            await handleCrmEntry(app, fields);
          } catch (err) {
            app.log.error({ err }, 'crm inbound: message failed');
          }
          await app.redis.xack(CRM_INBOUND_STREAM, GROUP, id);
        }
      } catch (err) {
        app.log.error({ err }, 'crm inbound: read failed');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
    blocking.disconnect();
  };
}
