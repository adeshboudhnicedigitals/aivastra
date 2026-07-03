import { createLogger } from '@aivastra/logger';
import { makeProdModel } from './agent/bot.js';
import { loadEnv } from './env.js';
import { makeOpenAiEmbedder } from './ingest/embedder.js';
import { makeDb } from './lib/db.js';
import { makeRedis } from './lib/redis.js';
import { buildChatbotServer } from './server.js';

const log = createLogger('chatbot');

async function main(): Promise<void> {
  const env = loadEnv();
  const { db, close: closeDb } = makeDb(env);
  const { main: redis, pub, sub, close: closeRedis } = makeRedis(env);
  const embed = makeOpenAiEmbedder(env.OPENAI_API_KEY, env.CHATBOT_EMBED_MODEL);

  const app = await buildChatbotServer({
    env,
    db,
    redis,
    pub,
    sub,
    embed,
    makeModel: () => makeProdModel(env),
    log,
  });
  await app.listen({ port: env.CHATBOT_PORT, host: '0.0.0.0' });
  log.info({ port: env.CHATBOT_PORT }, 'chatbot ready');

  async function shutdown(signal: string) {
    log.info({ signal }, 'shutting down chatbot');
    await app.close();
    await closeRedis();
    await closeDb();
    process.exit(0);
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  log.error({ err }, 'chatbot crashed');
  process.exit(1);
});
